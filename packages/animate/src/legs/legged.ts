import type { Vector3 } from 'three';
import type { ReadonlyPose } from '../kernel/pose';
import type { Poise } from '../kernel/poise';
import type { Go } from '../kernel/go';
import type { AnySpecies, Temperament } from '../species/define';
import type { Locomotion } from './locomotion';
import type { Stepper } from './step/stepper';

/** What a body's root does when the app drives it (a player's): where it is on the floor, its velocity, facing, crouch, steadiness, a leap. */
export interface Root {
  /** its point on the floor (m) */
  position: Vector3;
  /** its velocity over the floor (m/s); default read off its moves */
  velocity?: Vector3;
  /** its facing (rad about +Y; 0 faces +Z) */
  yaw: number;
  /** how far it crouches (0 standing … 1 a deep crouch): a key's 0 or 1 as it is, the legs ease it */
  crouch?: number;
  /** how still it holds itself (0 at ease … 1 aiming): its breathing and sway fade by it */
  steady?: number;
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
