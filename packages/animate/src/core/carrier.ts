import { Quaternion, Vector3 } from 'three';
import { STEP } from './body';
import type { Frame } from './body';
import type { Placement, Target } from './goal';
import { log } from './rotation';

/**
 * A rigid frame things move on (a cart, a board, a held box), with a history like a body's:
 * `current` where it is at the sub-step being posed, `prev` and `prev2` the two before. Its one
 * mover moves it once per sub-step, before anything that reads it.
 */
export class Carrier {
  readonly prev2: Required<Placement>;
  readonly prev: Required<Placement>;
  readonly current: Required<Placement>;
  /** the time it was last moved to (s) */
  private time = -Infinity;

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

  /** its velocity (m/s) and spin (rad/s) over the last sub-step */
  velocity(out: Vector3): Vector3 {
    return out.subVectors(this.current.position, this.prev.position).divideScalar(STEP);
  }

  spin(out: Vector3): Vector3 {
    return log(_q.copy(this.prev.quaternion).invert().premultiply(this.current.quaternion), out).divideScalar(STEP);
  }

  /** `local` (in its frame) in the world as it is now, into `out`: moving with it (v + ω × r) */
  toWorld(local: Placement, out: Target & { velocity: Vector3; spin: Vector3 }): Target & { velocity: Vector3; spin: Vector3 } {
    const { position, quaternion } = this.current;
    const r = _r.copy(local.position).applyQuaternion(quaternion);
    out.position.copy(r).add(position);
    if (local.quaternion) (out.quaternion ??= new Quaternion()).copy(quaternion).multiply(local.quaternion);
    else out.quaternion = undefined;
    this.spin(out.spin);
    this.velocity(out.velocity).add(_v.crossVectors(out.spin, r));
    return out;
  }
}

/** An item's mass (kg; default none) and where its centre of mass is in its frame (default its origin). */
export interface ItemOptions {
  mass?: number;
  centre?: Vector3;
}

/**
 * A carrier something holds by its grips (targets in its frame: a palm on a face rolls freely about
 * its normal, `axis`), with a mass: a body that holds or wears it carries it (its centre of mass).
 */
export class Item extends Carrier {
  readonly mass: number;
  readonly centre: Readonly<Vector3>;

  constructor(
    position: Vector3,
    quaternion: Quaternion,
    readonly grips: Readonly<Record<string, Target>>,
    { mass = 0, centre = new Vector3() }: ItemOptions = {},
  ) {
    super(position, quaternion);
    if (!(mass >= 0 && Number.isFinite(mass))) throw new Error(`an item of mass ${mass}`);
    this.mass = mass;
    this.centre = centre.clone();
  }
}

/** `local` (a placement in `item`'s frame) as a goal: where it is in the world at a sub-step, moving with the item (its velocity and spin fed forward) */
export function onItem<W>(item: Carrier, local: Placement): (f: Frame<W>) => Target {
  const out: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
  return () => item.toWorld(local, out);
}

function copy(to: Required<Placement>, from: Required<Placement>) {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
}

const _q = new Quaternion();
const _r = new Vector3();
const _v = new Vector3();
