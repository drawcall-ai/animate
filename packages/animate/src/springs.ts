import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import type { AnySpecies, Vec3 } from './species/define';
import type { Binding } from './body/model';
import type { Proportions } from './species/humanoid/proportions';
import { INDEX } from './species/humanoid/bones';
import { BODY_RADIUS } from './hands/person/clearance';
import { nearestBetween } from './kernel/math';

/** A spring's restoring strength when it gives none (s⁻²) */
export const STIFFNESS = 40;

/** Spring motion for the bone hierarchy below one root. Lengths and rest directions come from the rig. */
export interface Spring {
  /** Restoring strength per unit mass (s⁻²; default 40). Higher values hold the input pose more firmly. */
  readonly stiffness?: number;
  /** Damping ratio (default 0.7) of each link's swing, under its stiffness and gravity's pull together: 0 oscillates, 1 is critically damped, above 1 settles more slowly. */
  readonly damping?: number;
  /** World acceleration (m/s²; default [0, -9.81, 0]). [0, 0, 0] disables gravity. */
  readonly gravity?: Vec3;
  /**
   * The root's rotation the chain hangs from (XYZ Euler angles in radians, in its parent's frame), in place of the model's or the
   * animation's: hair skinned standing clear of the body hangs from here. Absent, the root keeps its input rotation.
   */
  readonly hang?: Vec3;
}

/**
 * Body-owned spring state. Only rotations are written; the rig keeps every joint and segment length. A person's links keep out of its
 * trunk as a carried load does, the capsule from its hips up its neck to its skull (swung through it, a braid hung in front of the chest
 * or inside the torso for a second after each hard stop), but for a chain that rests in its coarse girth as rigged, as hair at the nape
 * does: that swings free of it. Other species' links collide with nothing.
 */
export class Springs {
  private readonly links: Link[] = [];
  private readonly trunk: Trunk | null;
  /** each root given a `hang`, and that turn: set again every step, after the body has written its pose over it */
  private readonly hangs: [Object3D, Quaternion][] = [];

  constructor(species: AnySpecies, private readonly binding: Binding) {
    const children = new Map<string, string[]>();
    for (const bone of species.bones) {
      if (bone.parent === undefined) continue;
      const names = children.get(bone.parent) ?? [];
      names.push(bone.name);
      children.set(bone.parent, names);
    }
    this.trunk = species.person ? trunkOf(species.person, binding) : null;
    const owned = new Set<string>(), posed = posedBones(species);
    binding.object.updateWorldMatrix(true, true);
    for (const [root, settings] of Object.entries(species.springs ?? {})) {
      if (!settings) continue;
      const node = binding.bones[root];
      if (!node) throw new Error(`springs: no bone "${root}"`);
      if (settings.hang) {
        if (!settings.hang.every(Number.isFinite)) throw new Error(`springs.${root}.hang: give finite angles`);
        node.quaternion.setFromEuler(new Euler(...settings.hang));
        node.updateWorldMatrix(false, true);
        this.hangs.push([node, node.quaternion.clone()]);
      }
      const stiffness = settings.stiffness ?? STIFFNESS, damping = settings.damping ?? 0.7;
      for (const [name, value] of Object.entries({ stiffness, damping })) {
        if (!(value >= 0 && Number.isFinite(value))) throw new Error(`springs.${root}.${name}: give a finite nonnegative number`);
      }
      const gravity = new Vector3(...settings.gravity ?? [0, -9.81, 0]);
      if (!gravity.toArray().every(Number.isFinite)) throw new Error(`springs.${root}.gravity: give a finite acceleration`);
      const before = this.links.length, names = [root];
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (owned.has(name)) throw new Error(`springs: "${name}" belongs to overlapping spring roots`);
        // (swung, a bone the body poses would leave what it holds, looks with or stands on where the pose put it)
        if (posed.has(name)) throw new Error(`springs: "${name}" is posed by the body (a person's skeleton or fingers, its neck, hands, legs or carriage); spring only bones nothing else turns`);
        owned.add(name);
        const below = children.get(name) ?? [];
        names.push(...below);
        // A branch keeps its input pose; each child chain swings independently. Leaves are the endpoints.
        if (below.length !== 1) continue;
        this.links.push(new Link(binding.bones[name], binding.bones[below[0]], stiffness, damping, gravity));
      }
      if (this.links.length === before) throw new Error(`springs.${root}: the hierarchy has no bone with one child to swing toward`);
      if (this.trunk) {
        const chain = this.links.slice(before), trunk = this.trunk;
        place(trunk, binding);
        // (as rigged: a chain resting in a capsule's coarse girth, as hair at the nape does, would be thrown out of its own rest)
        const keeps = trunk.capsules.filter(([a, b]) => chain.every((link) => link.clearOf(a, b, trunk.radius)));
        for (const link of chain) link.keeps = keeps;
      }
    }
  }

  /** Remove the preceding output before the animation writes the next input pose. */
  restore(): void { for (const link of this.links) link.node.quaternion.copy(link.rest); }

  /** Advance once, after the body's pose and world-oriented bones have been written. */
  step(dt: number): void {
    for (const [node, hang] of this.hangs) node.quaternion.copy(hang);
    if (this.trunk) place(this.trunk, this.binding);
    for (const link of this.links) link.step(dt, this.trunk);
  }

  /** Keep the last simulated pose, including render frames that contain no whole simulation step. */
  write(): void {
    for (const [node, hang] of this.hangs) node.quaternion.copy(hang);
    for (const link of this.links) link.node.quaternion.copy(link.rotation);
  }
}

class Link {
  readonly rest: Quaternion;
  readonly rotation: Quaternion;
  private readonly offset: Vector3;
  private readonly tip: Vector3;
  private readonly anchor: Vector3;
  private readonly velocity = new Vector3();
  private readonly drag: number;
  /** the trunk's capsules it keeps out of: those its chain hangs clear of as rigged */
  keeps: readonly Capsule[] = [];

  constructor(readonly node: Object3D, child: Object3D, private readonly stiffness: number, damping: number, private readonly gravity: Vector3) {
    this.rest = node.quaternion.clone();
    this.rotation = node.quaternion.clone();
    this.tip = child.getWorldPosition(new Vector3());
    this.anchor = node.getWorldPosition(new Vector3());
    this.offset = node.worldToLocal(this.tip.clone());
    if (this.offset.lengthSq() < 1e-12) throw new Error(`springs: "${node.name}" and "${child.name}" have no length between them`);
    // (gravity pulls a link of length L back toward hanging as a spring of g/L would: a ratio of the stiffness alone damped a light hair
    // chain to a quarter of the ratio asked, and a chain of no stiffness not at all)
    this.drag = 2 * damping * Math.sqrt(stiffness + gravity.length() / this.tip.distanceTo(this.anchor));
  }

  /** whether it stands clear of capsule `a`–`b`, `radius` round */
  clearOf(a: Readonly<Vector3>, b: Readonly<Vector3>, radius: number): boolean {
    return nearestBetween(this.anchor, this.tip, a, b, _onLink, _onAxis) > radius;
  }

  step(dt: number, trunk: Trunk | null): void {
    const node = this.node;
    node.updateWorldMatrix(true, false);
    const origin = _origin.setFromMatrixPosition(node.matrixWorld);
    const target = _target.copy(this.offset).applyMatrix4(node.matrixWorld);
    const axis = _axis.subVectors(target, origin), length = axis.length();
    if (!(length > 0)) throw new Error(`springs: "${node.name}" has zero world length`);
    axis.divideScalar(length);
    // Implicit spring integration stays bounded even for a very stiff spring. The length constraint then removes stretch.
    // Damping is relative to the moving joint: a steady walk does not create artificial wind drag.
    this.velocity.addScaledVector(_force.subVectors(origin, this.anchor), this.drag)
      .addScaledVector(_force.subVectors(target, this.tip), this.stiffness * dt).addScaledVector(this.gravity, dt)
      .divideScalar(1 + this.drag * dt + this.stiffness * dt * dt);
    this.anchor.copy(origin);
    const next = _next.copy(this.tip).addScaledVector(this.velocity, dt);
    const direction = _direction.subVectors(next, origin);
    if (direction.lengthSq() < 1e-12) direction.copy(axis);
    direction.normalize();
    next.copy(origin).addScaledVector(direction, length);
    if (trunk && keepOut(next, origin, length, this.keeps, trunk.radius)) direction.subVectors(next, origin).divideScalar(length);
    this.velocity.subVectors(next, this.tip).divideScalar(dt);
    this.tip.copy(next);
    const world = node.getWorldQuaternion(_world);
    const turn = _turn.setFromUnitVectors(axis, direction).multiply(world);
    if (node.parent) turn.premultiply(node.parent.getWorldQuaternion(_parent).invert());
    node.quaternion.copy(turn);
    this.rotation.copy(turn);
  }
}

/** the names of the bones the body poses: a person's whole skeleton and fingers; else the gaze's neck and head, each hand's chain, the
 * legs' joints and what their carriage turns */
function posedBones(species: AnySpecies): Set<string> {
  const skeleton = species.skeleton, name = (i: number) => skeleton.bones[i].name;
  // (a person's fingers are not in its skeleton: they are closed after it is posed)
  if (species.person) return new Set([...skeleton.bones.map((bone) => bone.name), ...Object.values({ ...species.fingers?.left }).flat(), ...Object.values({ ...species.fingers?.right }).flat()]);
  const posed = new Set<string>([name(0)]);
  const add = (indices: readonly number[]) => indices.forEach((i) => posed.add(name(i)));
  if (species.gaze) {
    if (species.gaze.neck !== undefined) add(skeleton.chain(species.gaze.neck));
    add([species.gaze.head]);
  }
  for (const chain of species.hands?.values() ?? []) add(skeleton.chain(chain));
  for (const leg of species.legs?.chains ?? []) add([...leg.joints.map((joint) => joint.bone), ...leg.toes ? [leg.toes.bone] : []]);
  const carriage = species.legs?.carriage;
  if (carriage) for (const bone of [carriage.spine, carriage.pelvis, carriage.neck, carriage.head, carriage.tail]) if (bone) posed.add(bone);
  return posed;
}

/** a capsule's axis, from end to end (its radius the trunk's) */
type Capsule = readonly [Vector3, Vector3];

/**
 * a person's trunk as its springs keep out of it: the capsule `clearBody` keeps a load from, from the hips up the neck to the skull, but
 * as wide as the hip joints stand below the neck, two more beside it (a trunk is wider than it is deep: in a round one alone, a braid
 * slid round inside the flank and out at the side of the waist after a hard stop)
 */
interface Trunk {
  readonly proportions: Proportions;
  /** its hips, neck, head and hip joints, as bound */
  readonly bones: readonly [Object3D, Object3D, Object3D, Object3D, Object3D];
  /** hips, neck and skull centre, and hips and neck to its left and right (world), as this step's pose has them */
  readonly points: readonly [Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3];
  /** hips to neck in the middle, to the left and to the right, and neck to skull */
  readonly capsules: readonly Capsule[];
  /** (m, world) */
  radius: number;
}

function trunkOf(proportions: Proportions, binding: Binding): Trunk {
  const points = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()] as const;
  const { hips, neck, head, leftUpperLeg, rightUpperLeg } = binding.bones;
  const capsules = [[points[0], points[1]], [points[3], points[4]], [points[5], points[6]], [points[1], points[2]]] as const;
  return { proportions, bones: [hips, neck, head, leftUpperLeg, rightUpperLeg], points, capsules, radius: 0 };
}

/** `trunk` where its bones stand now */
function place(trunk: Trunk, binding: Binding): void {
  const [hips, neck, head, leftHip, rightHip] = trunk.bones, [atHips, atNeck, skull, leftHips, leftNeck, rightHips, rightNeck] = trunk.points;
  head.updateWorldMatrix(true, false);
  hips.getWorldPosition(atHips);
  neck.getWorldPosition(atNeck);
  const aside = leftHip.getWorldPosition(_aside).sub(rightHip.getWorldPosition(_out)).multiplyScalar(0.5);
  leftHips.addVectors(atHips, aside);
  leftNeck.addVectors(atNeck, aside);
  rightHips.subVectors(atHips, aside);
  rightNeck.subVectors(atNeck, aside);
  // (the skull centre is in the solver's head frame: the bone is turned from it by its rest turn)
  const scale = head.getWorldScale(_scale).x / binding.scaleOf(INDEX.head);
  const turn = head.getWorldQuaternion(_head).multiply(_rest.copy(binding.restOf(INDEX.head)).invert());
  skull.copy(trunk.proportions.headCenter).multiplyScalar(scale).applyQuaternion(turn).add(head.getWorldPosition(_out));
  trunk.radius = BODY_RADIUS * trunk.proportions.height * scale;
}

/**
 * swing `tip`, `length` from `origin`, until the link between them is out of `capsules`, `radius` round, but those the trunk has moved
 * onto its origin (no swing clears those); whether it moved (a few passes: one capsule's push can lean it into the other)
 */
function keepOut(tip: Vector3, origin: Readonly<Vector3>, length: number, capsules: readonly Capsule[], radius: number): boolean {
  let pushed = false;
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const [a, b] of capsules) {
      // (the way out is the origin's side: a link past the axis, swung through in one step, is brought back, not pushed on through)
      const side = _side.subVectors(origin, nearestOn(a, b, origin, _onAxis));
      if (side.length() <= radius) continue;
      const depth = radius - nearestBetween(origin, tip, a, b, _onLink, _onAxis);
      if (depth <= 0) continue;
      const out = _out.subVectors(_onLink, _onAxis);
      if (out.dot(side) <= 0) out.copy(side);
      out.normalize();
      // (along the sphere the tip swings on, as far as clears the link's nearest point to first order: that point moves `lever` of
      // the tip's way; straight out and back onto the sphere gave a little back each time)
      const lever = Math.max(0.2, _onLink.distanceTo(origin) / length);
      const swing = _swing.subVectors(tip, origin).divideScalar(length), slide = out.addScaledVector(swing, -out.dot(swing));
      const reach = slide.lengthSq();
      if (reach < 1e-4) continue; // (out along the link itself: no swing clears it)
      tip.addScaledVector(slide, depth / (lever * reach)).sub(origin).setLength(length).add(origin);
      moved = pushed = true;
    }
    if (!moved) break;
  }
  return pushed;
}

/** the point of segment `a`–`b` nearest `point`, in `out` */
function nearestOn(a: Readonly<Vector3>, b: Readonly<Vector3>, point: Readonly<Vector3>, out: Vector3): Vector3 {
  const ab = _ab.subVectors(b, a), span = ab.lengthSq();
  return out.copy(a).addScaledVector(ab, span > 0 ? Math.min(1, Math.max(0, _out.subVectors(point, a).dot(ab) / span)) : 0);
}

const _side = new Vector3(), _onAxis = new Vector3(), _onLink = new Vector3(), _out = new Vector3(), _swing = new Vector3(), _ab = new Vector3();
const _scale = new Vector3(), _aside = new Vector3(), _head = new Quaternion(), _rest = new Quaternion();
const _origin = new Vector3(), _target = new Vector3(), _axis = new Vector3(), _force = new Vector3(), _next = new Vector3(), _direction = new Vector3();
const _world = new Quaternion(), _turn = new Quaternion(), _parent = new Quaternion();
