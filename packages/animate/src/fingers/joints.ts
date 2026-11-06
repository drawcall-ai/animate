import type { HandPoint } from './point';
import { Matrix4, Quaternion, Ray, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { palmFacing, type DigitBones } from './bones';
import { Triangles } from '../kernel/triangles';
import { DIGITS, type Digit, type DigitName, type Shape } from './shape';

/** One finger joint: its node and rest rotation, where it stands at rest from the joint before it (the hand, for the first), the axis it
 * bends toward the palm about, how far it is bent about it at rest, and its segment out to the next joint, with how far its palm side lies
 * from it (all its own frame). */
interface Joint {
  node: Object3D;
  rest: Quaternion;
  offset: Matrix4;
  flex: Vector3;
  /** how far a finger's knuckle is bent toward the palm at rest, its first segment off the palm's plane (rad; 0 for its other joints and
   * the thumb's): a skin modelled with its fingers relaxed has them some 30° in — undone, so a finger with no curl lies along the palm */
  flexed: number;
  along: Vector3;
  palmar: Vector3;
  length: number;
  /** how far the segment's palm side is from its bone: the skin's, measured at rest; else a share of the digit's length */
  depth: number;
  /** a fingertip's: how far along it from its joint its rounded end (`depth` round) is centred, so that it ends where the skin does
   * (measured at rest; else at the bone's end): on the bone's end, a pad pressed onto a button stood off it by the skin 8 mm, its contact
   * 1.4 cm off the button's middle */
  end: number;
}

type Three = readonly [Joint, Joint, Joint];

/** A finger's joints from the palm out, and the axis its knuckle fans it about away from the middle finger (none: the middle finger). */
interface FingerJoints {
  joints: Three;
  spread: Vector3 | null;
}

/** The thumb's joints from the wrist out, the axes its metacarpal swings about out in front of the palm (`spread`), then across it
 * (`oppose`), and the way from its base to the palm's middle, where a lifted thumb turns its pad (`PRONATE`), all its metacarpal's frame
 * at rest. */
interface Opposing {
  joints: Three;
  palmward: Vector3;
  ulnar: Vector3;
  inward: Vector3;
}

/**
 * How far each joint bends at a full curl (rad): a finger's knuckle 90°, its middle joint 100° and its end joint `DIP` of that, as the
 * tendons couple it (Rijpkema & Girard 1991: ~2/3; Lin et al. 2000); the thumb's two outer joints 55° and 75° (Hume et al. 1990)
 */
const BEND = { knuckle: Math.PI / 2, middle: (100 * Math.PI) / 180, thumb: [(55 * Math.PI) / 180, (75 * Math.PI) / 180] } as const;
const DIP = 0.7;
/**
 * how far a full spread fans each finger (rad); and the thumb's base, its saddle joint's two ways: how far it swings out in front of the
 * palm (its `spread`: palmar abduction 0–70°, Greene & Heckman 1994) and across it toward the little finger (its `oppose`: ~50°, the
 * flexion–extension arc of 53°, Cooney et al. 1981) — at 60°, the thumb's pad came short of a magazine's far face by 2–3 cm
 */
const SPREAD = { index: 0.3, middle: 0, ring: 0.22, little: 0.4, thumb: (70 * Math.PI) / 180 } as const;
const OPPOSE = 0.9;
/**
 * A thumb lifted out in front of the palm or swung across it turns about its own length to face its pad onto the palm's middle, as the
 * saddle joint at its base couples the two (Cooney et al. 1981; Kapandji's conjunct rotation): fully once it is lifted or swung this far
 * (`Thumb.spread`, `oppose`, whichever further), by at most `most` (rad). Swung out alone, its pad kept facing the way it did along the
 * palm, and its outer joints folded it back toward the hand's back instead of round a handle; swung across alone, its pad lay flat on
 * the palm's side instead of facing the fingers.
 */
const PRONATE = { lifted: 0.4, most: (70 * Math.PI) / 180 } as const;
/** how far off its length toward its palm side a fingertip presses a button, and a pad presses on what the hand holds (rad) */
export const PRESS = (25 * Math.PI) / 180, PINCH = (70 * Math.PI) / 180;
/** without a skin to measure: a digit's palm side from its bone as a share of its first segment's length, and the palm's from the
 * knuckles' bones as a share of the wrist-to-knuckle length */
const THICK = { finger: 0.2, thumb: 0.24, palm: 0.3 } as const;
/**
 * Where a handle lies in a power grasp: across the palm just short of the knuckles (this share of a proximal phalanx back from them), its
 * index end a little further out than its little-finger end — the palm's distal crease runs ~15° off square to the hand (Napier 1956) —
 * and as far out from the palm's skin as its radius
 */
const HANDLE = { back: 0.25, slant: Math.tan((15 * Math.PI) / 180) } as const;

/**
 * One hand's finger bones and how a `Shape` turns them: each joint bends about the axis square to its segment and to the palm's facing,
 * worked out once from where the bones stand at rest under the hand — so it fits any rig named so, whatever its bones' own axes — and is
 * written as a turn on top of its rest rotation. Given the skin they are rigged in, it measures how far each segment's palm side and the
 * palm lie from the bones, so the fingers close onto a thing with their skin rather than their bones, and a handle sits against the palm.
 */
export class Joints {
  private readonly fingers: Record<DigitName, FingerJoints>;
  private readonly thumb: Opposing;
  /** the palm's facing, the knuckles' middle, the hand's long axis and the line across the knuckles toward the index (the hand's frame) */
  private readonly palm: Vector3;
  private readonly knuckles: Vector3;
  private readonly along: Vector3;
  private readonly across: Vector3;
  /** how far the palm's skin lies out from the knuckles' bones toward the palm */
  private readonly palmDepth: number;
  /** how far from the wrist the hand reaches at most, every digit straight out (m, the hand's frame) */
  readonly span: number;

  constructor(readonly hand: Object3D, bones: DigitBones, nodes: Readonly<Record<string, Object3D>>, side: 'left' | 'right', skins: readonly SkinnedMesh[]) {
    const node = (name: string) => {
      const found = nodes[name];
      if (!found) throw new Error(`fingers: no bone "${name}"`);
      return found;
    };
    // (each bone where it stands at rest in the hand's frame)
    const rest = new Map<string, Matrix4>([[hand.name, new Matrix4()]]);
    const named = Object.values(bones).flat();
    for (const name of named) {
      const matrix = new Matrix4();
      for (let at: Object3D | null = node(name); at !== hand; at = at.parent) {
        if (!at) throw new Error(`fingers: "${name}" does not hang from "${hand.name}"`);
        at.updateMatrix();
        matrix.premultiply(at.matrix);
      }
      rest.set(name, matrix);
    }
    const at = (name: string) => {
      const found = rest.get(name);
      if (!found) throw new Error(`fingers: no bone "${name}"`);
      return found;
    };
    const point = (name: string) => new Vector3().setFromMatrixPosition(at(name));
    const turnOf = (name: string) => new Quaternion().setFromRotationMatrix(at(name));
    const palm = palmFacing(point, hand.name, bones, side, new Vector3());
    const across = point(bones.index[0]).sub(point(bones.little[0])).normalize();
    const knuckles = DIGITS.reduce((sum, digit) => sum.add(point(bones[digit][0])), new Vector3()).divideScalar(DIGITS.length);
    const along = knuckles.clone().normalize();
    const measure = skins.length ? measuring(skins, hand) : undefined;
    // (`straight`: the way a digit's first segment points straight, from its rest one; none: straight as it rests, as a thumb)
    const chain = (names: readonly [string, string, string], thick: number, bending: (segment: Vector3) => Vector3, straight?: (segment: Vector3) => Vector3): Three => {
      const segments = names.map((name, k) => {
        const next = names[k + 1];
        // (the last segment out to the bone's own child, if it has one, else as long as four fifths of the one before)
        if (next) return point(next).sub(point(name));
        const tip = node(name).children.find((child) => !named.includes(child.name));
        if (tip) return tip.position.clone().applyQuaternion(turnOf(name));
        return point(name).sub(point(names[k - 1])).multiplyScalar(0.8);
      });
      const [a, b, c] = names.map((name, k): Joint => {
        const back = turnOf(name).invert(), segment = segments[k], unit = segment.clone().normalize();
        const flex = bending(unit).normalize(), palmar = new Vector3().crossVectors(flex, unit).normalize();
        const middle = point(name).addScaledVector(segment, 0.5);
        const before = straight && k === 0 ? straight(unit) : unit;
        return {
          node: node(name), rest: node(name).quaternion.clone(),
          offset: k === 0 ? at(name).clone() : at(names[k - 1]).clone().invert().multiply(at(name)),
          flexed: Math.atan2(_cross.crossVectors(before, unit).dot(flex), before.dot(unit)), flex: flex.applyQuaternion(back), along: unit.applyQuaternion(back), palmar: palmar.clone().applyQuaternion(back),
          length: segment.length(), depth: measure ? measure(middle, palmar) : thick * segments[0].length(), end: segment.length(),
        };
      });
      // (the tip's rounded end where the skin ends, from the middle of its segment out along it)
      if (measure) c.end = c.length / 2 + measure(point(names[2]).addScaledVector(segments[2], 0.5), segments[2]) - c.depth;
      return [a, b, c];
    };
    // (a finger fans away from the middle finger, square to itself)
    const finger = (digit: DigitName): FingerJoints => {
      const joints = chain(bones[digit], THICK.finger, (unit) => new Vector3().crossVectors(unit, palm), (unit) => unit.clone().addScaledVector(palm, -unit.dot(palm)).normalize());
      if (digit === 'middle') return { joints, spread: null };
      const first = turnOf(bones[digit][0]), unit = joints[0].along.clone().applyQuaternion(first);
      const away = point(bones[digit][0]).sub(point(bones.middle[0]));
      away.addScaledVector(unit, -away.dot(unit)).normalize();
      return { joints, spread: new Vector3().crossVectors(unit, away).normalize().applyQuaternion(first.clone().invert()) };
    };
    this.fingers = { index: finger('index'), middle: finger('middle'), ring: finger('ring'), little: finger('little') };
    // (a thumb bends toward the palm's far side, the little finger's, and a little into the palm; it swings out in front of the palm
    // square to itself, then across toward the little finger — swung about the hand's length instead, a metacarpal lying along the hand,
    // as a rig's often does, only twisted about itself, and the thumb never came off the palm's side)
    const ulnar = across.clone().negate(), toward = ulnar.clone().addScaledVector(palm, 0.4).normalize();
    const joints = chain(bones.thumb, THICK.thumb, (unit) => new Vector3().crossVectors(unit, toward));
    const metacarpal = turnOf(bones.thumb[0]), back = metacarpal.clone().invert(), unit = joints[0].along.clone().applyQuaternion(metacarpal);
    this.palm = palm;
    this.knuckles = knuckles;
    this.along = along;
    this.across = across;
    // (the palm's skin, measured a third of the way back from the knuckles to the wrist)
    this.palmDepth = measure ? measure(knuckles.clone().multiplyScalar(2 / 3), palm) : THICK.palm * knuckles.length();
    this.thumb = {
      joints,
      palmward: new Vector3().crossVectors(unit, palm).normalize().applyQuaternion(back),
      ulnar: new Vector3().crossVectors(unit, ulnar).normalize().applyQuaternion(back),
      inward: this.handle(0).at.sub(point(bones.thumb[0])).normalize().applyQuaternion(back),
    };
    this.span = Math.max(...(['thumb', ...DIGITS] as const).map((digit) => {
      const chain = this.chain(digit);
      return point(bones[digit][0]).length() + chain.reduce((sum, joint) => sum + joint.length, chain[2].depth);
    }));
  }

  /** the bones turned as `shape` has them */
  write(shape: Shape): void {
    for (const digit of [...DIGITS, 'thumb'] as const) this.turns(digit, shape).forEach((turn, k) => this.chain(digit)[k].node.quaternion.copy(turn));
  }

  /**
   * Each segment of `digit` as `shape` would have it, along its palm side (`side` 1; 0 its bone, −1 its back as far out), in the world as
   * the hand stands now (its matrix up to date): from its joint to the next, the last out to its tip
   */
  segments(digit: Digit, shape: Shape, side = 1): [Vector3, Vector3][] {
    const frames = this.frames(digit, shape);
    return this.chain(digit).map((joint, k) => {
      const start = joint.palmar.clone().multiplyScalar(side * joint.depth), end = start.clone().addScaledVector(joint.along, joint.length + (k === 2 ? joint.depth : 0));
      return [start.applyMatrix4(frames[k]).applyMatrix4(this.hand.matrixWorld), end.applyMatrix4(frames[k]).applyMatrix4(this.hand.matrixWorld)];
    });
  }

  /**
   * where `digit`'s pad is as `shape` would have it, in the hand's frame, and the way it faces (into `out`, `facing`): the point of its
   * rounded end that faces `round` off its length toward its palm side — `PRESS`, nearly end on, as a fingertip presses a button (faced
   * halfway to the palm side, a pointing finger, its joints a little bent, came onto a button with the hand flat along the panel), or
   * `PINCH`, the flat of the pad, as it presses on what a hand holds
   */
  pad(digit: Digit, shape: Shape, out: Vector3, facing = new Vector3(), round = PRESS): Vector3 {
    const last = this.chain(digit)[2], frame = this.frames(digit, shape)[2];
    facing.copy(last.along).multiplyScalar(Math.cos(round)).addScaledVector(last.palmar, Math.sin(round));
    out.copy(last.along).multiplyScalar(last.end).addScaledVector(facing, last.depth).applyMatrix4(frame);
    facing.transformDirection(frame);
    return out;
  }

  /**
   * Balls along `digit`'s bones as `shape` would have them, each as thick as its skin is there — at each joint, halfway along each
   * segment and at the tip — or, for none, across the palm (the wrist, and halfway from it to each knuckle): what of the hand must stay out
   * of what it touches (the hand's frame)
   */
  flesh(digit: Digit | null, shape: Shape): { at: Vector3; radius: number }[] {
    if (!digit) return [new Vector3(), ...DIGITS.map((name) => new Vector3().setFromMatrixPosition(this.fingers[name].joints[0].offset).multiplyScalar(0.5))]
      .map((at) => ({ at, radius: this.palmDepth }));
    const frames = this.frames(digit, shape);
    return this.chain(digit).flatMap((joint, k) => [0, 0.5, ...(k === 2 ? [1] : [])]
      .map((t) => ({ at: joint.along.clone().multiplyScalar(t * joint.length).applyMatrix4(frames[k]), radius: joint.depth })));
  }

  /** where this hand holds a handle of `radius` in its power grasp (see `HandPoint`) */
  handle(radius: number): HandPoint {
    const proximal = this.fingers.middle.joints[0].length;
    const at = this.knuckles.clone().addScaledVector(this.along, -HANDLE.back * proximal).addScaledVector(this.palm, this.palmDepth + radius);
    return { at, axis: this.across.clone().addScaledVector(this.along, HANDLE.slant).normalize(), facing: this.palm.clone(), palmFacing: this.palm.clone() };
  }

  /** where this hand holds a grip with its palm's middle, on its skin, or presses with `digit`'s pad as `shape` has it, `round` off its
   * length (see `pad`, `HandPoint`) */
  touch(digit: Digit | null, shape: Shape, round = PRESS): HandPoint {
    if (!digit) return { at: this.handle(0).at, axis: this.across.clone(), facing: this.palm.clone(), palmFacing: this.palm.clone() };
    const facing = new Vector3();
    return { at: this.pad(digit, shape, new Vector3(), facing, round), axis: this.across.clone(), facing, palmFacing: this.palm.clone() };
  }

  private chain(digit: Digit): Three {
    return digit === 'thumb' ? this.thumb.joints : this.fingers[digit].joints;
  }

  /** each joint of `digit` turned as `shape` has it, from its rest */
  private turns(digit: Digit, shape: Shape): Quaternion[] {
    const joints = this.chain(digit);
    if (digit === 'thumb') {
      const { curl, oppose, spread } = shape.thumb, { palmward, ulnar } = this.thumb;
      const swing = new Quaternion().setFromAxisAngle(palmward, spread * SPREAD.thumb).multiply(_q.setFromAxisAngle(ulnar, oppose * OPPOSE));
      return [
        joints[0].rest.clone().multiply(swing).multiply(_q.setFromAxisAngle(joints[0].along, this.pronation(swing, spread, oppose))),
        bent(joints[1], curl * BEND.thumb[0], null, 0),
        bent(joints[2], curl * BEND.thumb[1], null, 0),
      ];
    }
    // (a curl below 0 lifts the knuckle alone)
    const { curl, hook, spread } = shape[digit], folded = Math.max(0, curl), middle = Math.min(1, folded + hook) * BEND.middle;
    return [
      bent(joints[0], curl * BEND.knuckle, this.fingers[digit].spread, spread * SPREAD[digit] * (1 - folded)),
      bent(joints[1], middle, null, 0),
      bent(joints[2], DIP * middle, null, 0),
    ];
  }

  /** how far the thumb's metacarpal, swung `swing` off its rest, lifted `spread` and swung across `oppose`, turns about its length
   * (`PRONATE`): the turn that brings its palm side, the way its outer joints fold it, square to it toward the palm's middle */
  private pronation(swing: Quaternion, spread: number, oppose: number): number {
    const { joints: [metacarpal], inward } = this.thumb;
    const length = _u.copy(metacarpal.along).applyQuaternion(swing), folds = _c.copy(metacarpal.palmar).applyQuaternion(swing);
    const toward = _d.copy(inward).addScaledVector(length, -inward.dot(length));
    const angle = Math.atan2(_cross.crossVectors(folds, toward).dot(length), folds.dot(toward));
    return Math.min(1, Math.max(0, spread, oppose) / PRONATE.lifted) * Math.max(-PRONATE.most, Math.min(PRONATE.most, angle));
  }

  /** each joint's frame in the hand's, as `shape` turns them: its offset at rest, its rest turn swapped for the shape's */
  private frames(digit: Digit, shape: Shape): Matrix4[] {
    const turns = this.turns(digit, shape), frames: Matrix4[] = [];
    this.chain(digit).forEach((joint, k) => {
      const turned = new Quaternion().setFromRotationMatrix(joint.offset).multiply(_back.copy(joint.rest).invert()).multiply(turns[k]);
      const local = new Matrix4().compose(new Vector3().setFromMatrixPosition(joint.offset), turned, _one);
      frames.push(k === 0 ? local : frames[k - 1].clone().multiply(local));
    });
    return frames;
  }
}

/** `joint` turned from its rest: fanned `fanned` rad about `fan`, then bent `bend` rad from straight */
function bent(joint: Joint, bend: number, fan: Vector3 | null, fanned: number): Quaternion {
  const turn = joint.rest.clone();
  if (fan && fanned) turn.multiply(_q.setFromAxisAngle(fan, fanned));
  return turn.multiply(_q.setFromAxisAngle(joint.flex, bend - joint.flexed));
}

/**
 * How far the surface of `skins` (the skinned meshes `hand` bends) lies from a point in its frame along a direction there, as they stand at
 * rest (their bind pose): the nearest within 6 cm; none there is a misuse, said at once — the bones lie outside the skin
 */
function measuring(skins: readonly SkinnedMesh[], hand: Object3D) {
  // (each skin's triangles about the hand at rest, in its frame: the geometry through the mesh's bind matrix and the hand's bind pose)
  const near = new Triangles(skins.map((skin) => {
    const k = skin.skeleton.bones.findIndex((bone) => bone === hand);
    return { geometry: skin.geometry, matrix: new Matrix4().copy(skin.skeleton.boneInverses[k]).multiply(skin.bindMatrix) };
  }), new Vector3(), 0.3), ray = new Ray();
  return (from: Vector3, direction: Vector3): number => {
    const met = near.first(ray.set(from, direction.clone().normalize()), 0.06);
    if (met === null) throw new Error(`fingers: no skin within 6 cm of "${hand.name}"'s bones at rest, from ${from.toArray().map((v) => v.toFixed(3))}: are they inside the mesh?`);
    return met;
  };
}

const _q = new Quaternion(), _back = new Quaternion(), _one = new Vector3(1, 1, 1), _cross = new Vector3(), _u = new Vector3(), _c = new Vector3(), _d = new Vector3();
