import { Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { OFF_FLOOR } from '../kernel/dev';
import type { ReadonlyPose } from '../kernel/pose';
import type { Poise } from '../kernel/poise';
import type { Go } from '../kernel/go';
import type { AnySpecies, Temperament } from '../species/define';
import type { Locomotion } from './locomotion';
import type { Stepper } from './step/stepper';
import type { Steering } from './step/state';
import type { Floor } from './floor';

/** What a body's root does when the app drives it (a player's): where it is on the floor, its velocity, facing, crouch, a leap. */
export interface Root {
  /** its point on the floor (m): x and z — the body stands on its floor there; a y off that floor is ignored (a dev log says so) */
  position: Vector3;
  /** its velocity over the floor (m/s); default read off its moves */
  velocity?: Vector3;
  /** its facing (rad about +Y; 0 faces +Z) */
  yaw: number;
  /** how far it crouches (0 standing … 1 a deep crouch): a key's 0 or 1 as it is, the legs ease it */
  crouch?: number;
  /** leap at this speed (m/s up) as soon as the feet can */
  jump?: number;
}

/**
 * A body as its legs see it: its species, how it stands now, what its parts ask of its stance and where the request that has its legs
 * takes it (or the root its app drives), what it bears in its hands, and the walk it reports.
 */
export interface Legged {
  readonly species: AnySpecies;
  readonly pose: ReadonlyPose;
  /** its root's turn about +Y (0 faces +Z) */
  readonly yaw: number;
  readonly scale: number;
  readonly tempo: number;
  readonly life: Temperament;
  readonly drive?: (time: number) => Root;
  /** what it stands on */
  readonly floor: Floor;
  /** its stepping legs, made with its balance */
  stepper: Stepper | null;
  readonly poise: Poise;
  readonly going: Go | null;
  /** where its eyes are asked to look, for a species whose posture turns its head */
  readonly look: Readonly<Vector3> | null;
  readonly locomotion: Locomotion;
  /** the weight its hands bear off their support (kg): its walks slow for it */
  readonly load: number;
}

/**
 * A body's root as its app drives it (`drive`), a sub-step at a time: where it is, its velocity (read off its moves when not given),
 * facing and crouch; a leap it asks is passed to the legs.
 */
export function drivenRoot(self: Pick<Legged, 'drive' | 'stepper' | 'poise' | 'floor'>): (f: Frame) => Steering {
  const drive = self.drive;
  if (!drive) throw new Error('drivenRoot: the body is not driven');
  let last: Vector3 | null = null;
  return (f) => {
    const root = drive(f.time);
    // (a root driven above or below its floor stands on it)
    const height = Math.abs(root.position.y - self.floor(root.position.x, root.position.z));
    if (height > OFF_FLOOR) f.dev?.once(f.time, { check: 'driven root off the floor, its height ignored (m)', value: height, limit: OFF_FLOOR, where: 'root' });
    const position = root.position.clone().setY(0);
    const velocity = root.velocity?.clone().setY(0) ?? (last ? position.clone().sub(last).divideScalar(f.dt) : new Vector3());
    last = position.clone();
    if (![position.x, position.z, velocity.x, velocity.z, root.yaw].every(Number.isFinite)) throw new Error('drive: a root that is not finite');
    if (root.jump !== undefined) self.stepper?.jump(root.jump);
    return { position, velocity, yaw: root.yaw, crouch: root.crouch };
  };
}
