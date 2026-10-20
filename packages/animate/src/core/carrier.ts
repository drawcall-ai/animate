import { Box3, Quaternion, Vector3 } from 'three';
import { STEP } from './body';
import type { Body, Frame } from './body';
import type { Placement, Target } from './goal';
import { spinOf } from './rotation';

/** Where a carrier is at a sub-step (`current`) and the two before. */
export interface Placed {
  readonly prev2: Required<Placement>;
  readonly prev: Required<Placement>;
  readonly current: Required<Placement>;
}

/**
 * A rigid frame things move on (a cart, a board, a held box), with a history like a body's:
 * `current` where it was last moved to, `prev` and `prev2` the two sub-steps before. Its one
 * mover moves it once per sub-step: a scene before the bodies that read it, a body that wears it
 * after its behaviour. Read it at a sub-step's time (`at`).
 */
export class Carrier implements Placed {
  readonly prev2: Required<Placement>;
  readonly prev: Required<Placement>;
  readonly current: Required<Placement>;
  /** the time it was last moved to (s) */
  private time = -Infinity;

  /** Whether a mover has already written this sub-step. */
  moved(time: number): boolean { return this.time >= time - 1e-9; }

  constructor(position: Vector3, quaternion = new Quaternion()) {
    const at = () => ({ position: position.clone(), quaternion: quaternion.clone() });
    [this.prev2, this.prev, this.current] = [at(), at(), at()];
  }

  /** moves it to where it is at `time` (s): once per sub-step; a sub-step it was not moved in it stood still */
  move(time: number, position: Readonly<Vector3>, quaternion: Readonly<Quaternion> = this.current.quaternion): void {
    if (time <= this.time + 1e-9) throw new Error(`a carrier moved twice at ${time.toFixed(4)} s`);
    const still = time - this.time > 1.5 * STEP;
    copy(this.prev2, still ? this.current : this.prev);
    copy(this.prev, this.current);
    this.current.position.copy(position);
    this.current.quaternion.copy(quaternion);
    this.time = time;
  }

  /**
   * where it is at `time` (s) and the two sub-steps before: its fields, but while the body that wears it is posing that
   * sub-step (`due`) — it moves its worn items after its behaviour — carried on as it last moved
   */
  at(time: number): Placed {
    if (this.dueAt !== time || this.moved(time)) return this;
    const { position, quaternion } = this.ahead;
    position.copy(this.current.position).multiplyScalar(2).sub(this.prev.position);
    quaternion.copy(this.prev.quaternion).invert().premultiply(this.current.quaternion).multiply(this.current.quaternion).normalize();
    return { prev2: this.prev, prev: this.current, current: this.ahead };
  }

  /** Its mover moves it at `time` (s), after what reads it then: a body wearing it, posing that sub-step. */
  due(time: number): void {
    this.dueAt = time;
  }

  private dueAt = NaN;
  private readonly ahead = { position: new Vector3(), quaternion: new Quaternion() };

  /** put where it is at `time` (s), as if it had stood there all along (made somewhere else, it starts on a body) */
  place(time: number, position: Readonly<Vector3>, quaternion: Readonly<Quaternion>): void {
    this.move(time, position, quaternion);
    copy(this.prev, this.current);
    copy(this.prev2, this.current);
  }

  /** its velocity (m/s) and spin (rad/s) over the last sub-step */
  velocity(out: Vector3): Vector3 {
    return out.subVectors(this.current.position, this.prev.position).divideScalar(STEP);
  }

  spin(out: Vector3): Vector3 {
    return spinOf(this.prev.quaternion, this.current.quaternion, STEP, out);
  }

  /** `local` (in its frame) in the world as it is now — at `time` (s), if given (`at`) — into `out`: moving with it (v + ω × r) */
  toWorld(local: Placement, out: Target & { velocity: Vector3; spin: Vector3 }, time?: number): Target & { velocity: Vector3; spin: Vector3 } {
    const { prev, current: { position, quaternion } } = time === undefined ? this : this.at(time);
    const r = _r.copy(local.position).applyQuaternion(quaternion);
    out.position.copy(r).add(position);
    if (local.quaternion) (out.quaternion ??= new Quaternion()).copy(quaternion).multiply(local.quaternion);
    else out.quaternion = undefined;
    spinOf(prev.quaternion, quaternion, STEP, out.spin);
    out.velocity.subVectors(position, prev.position).divideScalar(STEP).add(_v.crossVectors(out.spin, r));
    return out;
  }
}

/** An item's mass (kg; default none), where its centre of mass is in its frame (default its origin), and whether it rests on something (default true). */
export interface ItemOptions {
  /** Identifies the item in reach and carry errors. */
  name?: string;
  mass?: number;
  centre?: Vector3;
  /** Optional solid envelope in item-local metres; otherwise bounds the centre and grips. */
  bounds?: Box3;
  supported?: boolean;
}

/**
 * A carrier something holds by its grips (targets in its frame: a palm on a face rolls freely about
 * its normal, `axis`), with a mass: a body that holds or wears it carries it (its centre of mass).
 */
export class Item extends Carrier {
  readonly name: string;
  /** which body wears it; null while unattached */
  wornBy: Body | null = null;
  readonly mass: number;
  readonly centre: Readonly<Vector3>;
  readonly bounds: Box3;
  /** it rests on something (a table, a rack, a peg): a hand on it bears none of its weight; carrying it off (`hold` with `to`, `carry`) or wearing it clears this, letting go of it where nothing else holds or wears it (`release`: put down) sets it */
  supported: boolean;

  constructor(
    position: Vector3,
    quaternion: Quaternion,
    readonly grips: Readonly<Record<string, Target>>,
    { name = "item", mass = 0, centre = new Vector3(), supported = true, bounds }: ItemOptions = {},
  ) {
    super(position, quaternion);
    if (!(mass >= 0 && Number.isFinite(mass))) throw new Error(`an item of mass ${mass}`);
    if (bounds && (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite))) {
      throw new Error(`"${name}" has empty or non-finite bounds`);
    }
    this.name = name;
    this.mass = mass;
    this.centre = centre.clone();
    this.bounds = bounds?.clone() ?? new Box3().setFromPoints([centre, ...Object.values(grips).map((g) => g.position)]);
    this.supported = supported;
  }
}

/** `local` (a placement in `item`'s frame) as a goal: where it is in the world at a sub-step, moving with the item (its velocity and spin fed forward) */
export function onItem(item: Carrier, local: Placement = { position: new Vector3(), quaternion: new Quaternion() }): (f: Frame) => Target {
  return (f) => item.toWorld(local, { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }, f.time);
}

function copy(to: Required<Placement>, from: Required<Placement>) {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
}

const _r = new Vector3();
const _v = new Vector3();
