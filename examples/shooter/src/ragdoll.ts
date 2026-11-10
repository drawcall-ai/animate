import { BoxCollider, GenericJoint, JointDrive, RevoluteJoint, RigidBody } from '@drawcall/physics';
import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { anglesOf, lookDirection, wrapAngle } from './angles';
import type { Avatar } from './avatar';
import type { Look } from './playback';
import { RIFLE } from './weapon/index';

type Bone = keyof Avatar['body']['bones'];
type Side = 'left' | 'right';

/**
 * A box along the bones from `from` to `to`, or on as far as `past` lies along that line, and `reach` beyond; `width` across the body and
 * `depth` through it (m at scale 1).
 */
interface Box { from: Bone; to: Bone; past?: Bone; width: number; depth: number; reach?: number }

/** A ball joint to `parent`, turning from the pose the soldier fell in (rad) about the body's side axis, along its segment and about the third. */
interface Ball { parent: Bone; flex: number; twist: number; side: number }

/** A hinge to `parent` with its full bend (rad) from straight; a knee bends about the hips' side axis, an elbow the way it already bends. */
interface Hinge { parent: Bone; bend: number; knee: boolean }

interface Part {
  /** the bone its body moves; the bones below it that no part moves ride along */
  bone: Bone;
  /** kg at scale 1 */
  mass: number;
  boxes: Box[];
  /** how it hangs from its parent part, jointed at `bone`; none for the root */
  joint?: Ball | Hinge;
}

const limbs = (side: Side): Part[] => [
  {
    bone: `${side}UpperArm`, mass: 2.5, joint: { parent: 'spine', flex: 1.5, twist: 0.8, side: 1.5 },
    boxes: [{ from: `${side}UpperArm`, to: `${side}LowerArm`, width: 0.1, depth: 0.1 }],
  },
  {
    bone: `${side}LowerArm`, mass: 2, joint: { parent: `${side}UpperArm`, bend: 2.6, knee: false },
    // The forearm reaches on along itself past the wrist a hand's length, not to the middle fingertip: boxed to where the fingers were,
    // closed round a grip they point back across the wrist, and the box lay across the chest, the corpse jittering until it flew apart.
    boxes: [{ from: `${side}LowerArm`, to: `${side}Hand`, width: 0.08, depth: 0.08, reach: 0.17 }],
  },
  {
    bone: `${side}UpperLeg`, mass: 9, joint: { parent: 'hips', flex: 1, twist: 0.5, side: 0.6 },
    boxes: [{ from: `${side}UpperLeg`, to: `${side}LowerLeg`, width: 0.15, depth: 0.15 }],
  },
  {
    bone: `${side}LowerLeg`, mass: 5, joint: { parent: `${side}UpperLeg`, bend: 2.4, knee: true },
    // The shin reaches below the ankle as far as the foot's sole, standing for the heel: a foot on its toes alone would tip the body back.
    boxes: [
      { from: `${side}LowerLeg`, to: `${side}Foot`, past: `${side}Toes_end`, width: 0.11, depth: 0.11, reach: 0.04 },
      { from: `${side}Foot`, to: `${side}Toes_end`, width: 0.09, depth: 0.05 },
    ],
  },
];

/** The soldier as eleven boxes, about 76 kg at scale 1, parents first. */
const PARTS: Part[] = [
  { bone: 'hips', mass: 11, boxes: [{ from: 'spine', to: 'hips', width: 0.32, depth: 0.2, reach: 0.08 }] },
  { bone: 'spine', mass: 22, joint: { parent: 'hips', flex: 0.35, twist: 0.35, side: 0.3 }, boxes: [{ from: 'spine', to: 'neck', width: 0.34, depth: 0.22 }] },
  { bone: 'neck', mass: 6, joint: { parent: 'spine', flex: 0.6, twist: 0.8, side: 0.4 }, boxes: [{ from: 'neck', to: 'head_end', width: 0.18, depth: 0.21 }] },
  ...limbs('left'), ...limbs('right'),
];

/**
 * The collision group of what a dead soldier leaves: its parts and dropped rifle. The rifle, which starts inside the hands, ignores it; the
 * parts collide with each other and the world, and shots hit both.
 */
const REMAINS = 1 << 15;
const ALL = 0xffff;
/** N·m·s/rad each joint resists turning with, as a dead body's slack muscles and tissue do; without it the body folds like a chain. */
const SLACK = 4;
/** 1/s by which a part's spin decays besides its joints' slack: the drag of air and clothing, so a flung limb does not keep tumbling. */
const SPIN_DRAG = 1;
/** The sine of the bend below which an elbow counts as straight (about 11°), its hinge then taken so the forearm comes forward. */
const STRAIGHT = 0.2;
/** The dropped rifle's box across and through, about its receiver and magazine (m); its length runs from the stock to the muzzle. */
const RIFLE_BOX = { width: 0.06, height: 0.2 };
/**
 * Below these the remains are at rest (m/s, rad/s); once they stay so for `time` seconds they sleep. Still trembling `most` seconds after
 * they last woke — limbs piled on one another — they are slowed by `damping` (1/s, linear and angular) until they come to rest, so a
 * corpse lies still. (Put to sleep while still moving, Rapier woke the pile a moment later without its contacts with the ground, and it
 * fell through the floor, flying apart.)
 */
const REST = { speed: 0.12, spin: 0.4, time: 0.5, most: 5, damping: 20 };
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);

/** Where the bones a ragdoll moves stood over the last two animated steps, for the velocity each part falls with. */
export class Trail {
  private previous = new Map<Object3D, Vector3>();
  private current = new Map<Object3D, Vector3>();
  private dt = 0;

  /** Called after each animated step of `dt` seconds. */
  record(avatar: Avatar, dt: number) {
    [this.previous, this.current] = [this.current, this.previous];
    this.dt = dt;
    for (const { bone } of PARTS) {
      const node = avatar.body.bones[bone];
      this.current.set(node, node.getWorldPosition(this.current.get(node) ?? new Vector3()));
    }
  }

  /** The bone's velocity over the last step (m/s); still when it has not been animated twice since `clear`. */
  velocity(bone: Object3D): Vector3 {
    const from = this.previous.get(bone), to = this.current.get(bone);
    return from && to ? to.clone().sub(from).divideScalar(this.dt) : new Vector3();
  }

  clear() {
    this.previous.clear();
    this.current.clear();
  }
}

/**
 * A dead soldier's body gone limp: one dynamic box per segment, jointed at its bones, starting from the pose it died in with each part's own
 * velocity, and the rifle dropped as a body of its own. `pose` writes the segments back to the bones, which the procedural body no longer
 * updates, and lays the remains to rest once they settle.
 */
export class Ragdoll {
  private readonly root = new Group();
  private readonly parts: { bone: Object3D; body: RigidBody; offset: Matrix4 }[] = [];
  private readonly bodies: RigidBody[] = [];
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  /** The eye and the view's direction at death in the head's frame, and the yaw last seen: the dead see as the head turns. */
  private readonly sight: { head: Object3D; eye: Vector3; forward: Vector3; yaw: number };
  /** seconds the remains have been at rest, and awake */
  private still = 0;
  private awake = 0;
  private asleep = false;

  /** Added under `parent`; `impulse` (N·s), the killing shot's, strikes the part nearest `point`. */
  constructor(parent: Object3D, avatar: Avatar, trail: Trail, impulse: Vector3, point: Vector3) {
    const { bones, species } = avatar.body;
    if (!species.person) throw new Error('A ragdoll requires a humanoid');
    const size = species.person.scale;
    avatar.group.updateMatrixWorld(true);
    const head = bones.head, look = avatar.look();
    const forward = lookDirection(look.yaw, look.pitch).applyQuaternion(head.getWorldQuaternion(new Quaternion()).invert());
    this.sight = { head, eye: head.worldToLocal(look.eye.clone()), forward, yaw: look.yaw };
    const at = (bone: Bone) => bones[bone].getWorldPosition(new Vector3());
    const side = at('leftUpperLeg').sub(at('rightUpperLeg')).normalize();
    const byBone = new Map<Bone, RigidBody>();
    let struck: { body: RigidBody; distance: number } | undefined;
    for (const part of PARTS) {
      const bone = bones[part.bone];
      const body = new RigidBody({ mass: part.mass * size ** 3, velocity: { linear: trail.velocity(bone).toArray() } });
      bone.matrixWorld.decompose(body.position, body.quaternion, this.scale);
      body.setAngularDamping(SPIN_DRAG).setCollisionGroups({ membership: REMAINS, filter: ALL });
      body.updateMatrix();
      const inverse = body.quaternion.clone().invert();
      for (const { from, to, past = to, width, depth, reach = 0 } of part.boxes) {
        const start = at(from), direction = at(to).sub(start).normalize();
        const length = at(past).sub(start).dot(direction) + reach * size, end = start.clone().addScaledVector(direction, length);
        const box = new BoxCollider({ size: [width * size, length, depth * size] });
        box.position.copy(start).add(end).multiplyScalar(0.5).sub(body.position).applyQuaternion(inverse);
        box.quaternion.copy(inverse).multiply(frame(direction, side));
        body.add(box);
        const distance = segmentDistance(point, start, end);
        if (!struck || distance < struck.distance) struck = { body, distance };
      }
      this.root.add(body);
      this.bodies.push(body);
      byBone.set(part.bone, body);
      this.parts.push({ bone, body, offset: body.matrix.clone().invert().multiply(bone.matrixWorld) });
      if (!part.joint) continue;
      const above = byBone.get(part.joint.parent);
      if (!above) throw new Error(`The ragdoll part ${part.bone} comes before its parent ${part.joint.parent}`);
      this.root.add(joint(above, body, part.joint, at(part.bone), at(part.joint.parent), at(part.boxes[0].to), side));
    }
    // (a rifle the soldier has put down, in a rack, stays there)
    if (onBody(avatar)) {
      const rifle = dropped(avatar, trail);
      this.root.add(rifle);
      this.bodies.push(rifle);
    }
    parent.add(this.root);
    this.root.updateMatrixWorld(true);
    struck?.body.applyImpulse(impulse, point);
  }

  /** After each physics step of `dt` seconds: writes each part's body back to its bone, parents first, and lays settled remains to rest. */
  pose(dt: number) {
    const moving = this.bodies.some((body) => {
      const { linear, angular } = body.getVelocity();
      return linear.length() > REST.speed || angular.length() > REST.spin;
    });
    // A shot wakes sleeping remains.
    if (this.asleep) {
      if (!moving) return;
      this.asleep = false;
      this.awake = 0;
    }
    this.still = moving ? 0 : this.still + dt;
    this.awake += dt;
    const damping = this.awake < REST.most ? 0 : REST.damping;
    for (const body of this.bodies) body.setLinearDamping(damping).setAngularDamping(Math.max(SPIN_DRAG, damping));
    for (const { bone, body, offset } of this.parts) {
      const parent = bone.parent;
      if (!parent) throw new Error(`Bone ${bone.name} has no parent`);
      parent.updateWorldMatrix(true, false);
      body.updateWorldMatrix(true, false);
      this.matrix.copy(parent.matrixWorld).invert().multiply(body.matrixWorld).multiply(offset)
        .decompose(bone.position, bone.quaternion, this.scale);
    }
    if (this.still < REST.time) return;
    for (const body of this.bodies) body.sleep();
    this.asleep = true;
  }

  /** What the dead soldier sees: from its eye on the ragdoll's head, turned as the head has turned since the fall. */
  look(): Look {
    const { head, eye, forward } = this.sight;
    const { yaw, pitch } = anglesOf(forward.clone().applyQuaternion(head.getWorldQuaternion(new Quaternion())));
    // Kept continuous with the last view, so the display's blend between steps never turns the long way round.
    this.sight.yaw += wrapAngle(yaw - this.sight.yaw);
    return { eye: head.localToWorld(eye.clone()), yaw: this.sight.yaw, pitch, intent: { yaw: this.sight.yaw, pitch } };
  }

  dispose() { this.root.removeFromParent(); }
}

/** The joint at `pivot`, from `above` to `body`, whose segment runs from `pivot` toward `toward`. */
function joint(above: RigidBody, body: RigidBody, shape: Ball | Hinge, pivot: Vector3, parent: Vector3, toward: Vector3, side: Vector3) {
  const child = toward.sub(pivot).normalize();
  if ('flex' in shape) {
    const { flex, twist, side: lean } = shape;
    const ball = new GenericJoint({ body0: above, body1: body, dofs: { rotX: [-flex, flex], rotY: [-twist, twist], rotZ: [-lean, lean] } });
    for (const axis of ['rotX', 'rotY', 'rotZ'] as const) ball.setDrive(axis, slack());
    ball.position.copy(pivot);
    ball.quaternion.copy(frame(child, side));
    return ball;
  }
  const upper = pivot.clone().sub(parent).normalize();
  const bent = upper.clone().cross(child);
  const axis = shape.knee ? side.clone() : bent.length() > STRAIGHT ? bent.clone().normalize() : orthogonal(side.clone().negate(), upper);
  const angle = Math.atan2(axis.dot(bent), upper.dot(child));
  const hinge = new RevoluteJoint({ body0: above, body1: body, axis: 'X', limits: [Math.min(0, -angle), Math.max(0, shape.bend - angle)] }).setDrive(slack());
  hinge.position.copy(pivot);
  hinge.quaternion.setFromUnitVectors(X, axis);
  return hinge;
}

const slack = () => new JointDrive({ damping: SLACK }).setTarget({ velocity: 0 });

/** Whether the rifle is on the soldier: in its hands or on its shoulder. */
function onBody(avatar: Avatar) {
  let on = false;
  avatar.rifle.traverseAncestors((node) => { on ||= node === avatar.group; });
  return on;
}

/** The rifle, taken from the hands as a body of its own, moving as the hand on its grip did. */
function dropped(avatar: Avatar, trail: Trail) {
  const rifle = avatar.muzzle.parent, stock = rifle?.getObjectByName('stock');
  if (!rifle || !stock) throw new Error('The ragdoll could not find the rifle');
  const body = new RigidBody({ mass: RIFLE.mass, velocity: { linear: trail.velocity(avatar.body.bones.rightLowerArm).toArray() } });
  rifle.matrixWorld.decompose(body.position, body.quaternion, new Vector3());
  body.setCollisionGroups({ membership: REMAINS, filter: ALL & ~REMAINS });
  body.updateMatrixWorld();
  body.attach(rifle);
  const box = new BoxCollider({ size: [RIFLE_BOX.width, RIFLE_BOX.height, RIFLE.muzzle.z - stock.position.z] });
  box.position.set(0, 0, (RIFLE.muzzle.z + stock.position.z) / 2).applyMatrix4(rifle.matrix);
  box.quaternion.copy(rifle.quaternion);
  body.add(box);
  return body;
}

/** A rotation taking Y along `along` and X as near `side` as it allows. */
function frame(along: Vector3, side: Vector3) {
  const y = along.clone().normalize(), x = orthogonal(side.clone(), y), z = x.clone().cross(y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** `vector` without its part along unit `axis`, normalized; any perpendicular when it lies along `axis`. */
function orthogonal(vector: Vector3, axis: Vector3) {
  vector.addScaledVector(axis, -vector.dot(axis));
  if (vector.lengthSq() > 1e-6) return vector.normalize();
  return new Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? Y : X).normalize();
}

function segmentDistance(point: Vector3, start: Vector3, end: Vector3) {
  const along = end.clone().sub(start), t = Math.max(0, Math.min(1, point.clone().sub(start).dot(along) / along.lengthSq()));
  return start.clone().addScaledVector(along, t).distanceTo(point);
}
