import type { Quaternion, Vector3 } from 'three';
import type { ReusableTimeline } from '@pmndrs/timeline';
import type { Frame, Humanoid, Ladder, Stance, World } from '@drawcall/animate';

export const FIXED_DT = 1 / 60;

/** An actor's part: where it starts, and how it stands at ease (set, the metrics skip the rest-stance check). */
export interface Role {
  /** on the floor */
  position?: { x: number; z: number };
  /** facing about +Y (0 faces +Z) */
  yaw?: number;
  stance?: Partial<Stance>;
}

/**
 * A scenario as timelines: one behaviour per actor, composed by `script` from behaviours and the
 * scenario's own direction. A script reports what it asks of its actor (effector targets, a seat,
 * a mount) in the actor's `status.intent`, which the markers and the metrics read.
 */
export interface Scenario {
  id: string;
  title: string;
  description?: string;
  /** s */
  duration: number;
  actors: readonly Role[];
  /** a fresh world for a run (its `bodies` are filled in by the simulation) */
  world(): World;
  /** the scenery drawn at time `t` (s) */
  props(t: number): Prop[];
  /**
   * the behaviour of actor `index` of `cast` (made in order: while the behaviours are being made,
   * `cast` holds only the actors before; by the time they run, all)
   */
  script(actor: Humanoid<World>, index: number, cast: readonly Humanoid<World>[]): ReusableTimeline<Frame<World>>;
  /** camera focus; defaults to the first actor's hips */
  focus?(actors: readonly Humanoid<World>[]): Vector3;
  cameraDistance?: number;
  /** the facing (yaw) the camera shots are taken against, held fixed; defaults to the first actor's */
  facing?: number;
  /** the actors' character model: OpenPose skeletons (default), or a viverse character — a model file, or viverse's mannequin without `url` */
  body?: 'openpose' | { url?: string };
  /** false: no plain grid (the scenario draws its own ground, a slope) */
  grid?: false;
  /** surroundings drawn instead of the plain grid; `center` = where the ring is centred */
  environment?: { kind: 'boxing-arena'; center: [number, number, number] };
}

/** scenery a scenario shows (drawn only: the humanoids know of it only through their world) */
export type Prop =
  /** `ghost`: see-through (a ceiling the body is under) */
  | { kind: 'box' | 'tray'; position: Vector3; size: Vector3; yaw?: number; ghost?: boolean; quaternion?: Quaternion }
  | { kind: 'ball'; position: Vector3; radius: number; held?: Held }
  /** a stick from `position` to `to` (a rifle's barrel, a sword's blade) */
  | { kind: 'rod'; position: Vector3; to: Vector3; radius: number; held?: Held }
  /** `position` = the middle of its footprint on the floor, `boards` = the board tops' heights */
  | { kind: 'shelf'; position: Vector3; size: Vector3; boards: readonly number[] }
  /** a ditch: `position` = the middle of its opening on the floor, `size` = its width, depth and length */
  | { kind: 'pit'; position: Vector3; size: Vector3 }
  /** a ladder of the world: its stiles reach `rails` m above its top */
  | { kind: 'ladder'; ladder: Ladder; rails: number }
  /** a vehicle: its parts in its own frame (`position`, `quaternion`) */
  | { kind: 'vehicle'; position: Vector3; quaternion: Quaternion; parts: readonly Part[] };

/**
 * A prop carried in a hand, as if attached to its bone: scripted relative to that hand's
 * target (its position, and rotation if given), drawn the same way relative to the solved
 * hand, which may not reach the target. `actor` defaults to the first.
 */
export interface Held {
  hand: 'left' | 'right';
  actor?: number;
}

/** a vehicle's part in its frame: a tube (`from` → `to`; `contact`: lying against the body, a strap), a wheel (in the y–z plane turned by `quaternion`, `tube` thick) or a box */
export type Part =
  | { kind: 'rod'; from: Vector3; to: Vector3; radius: number; contact?: true }
  | { kind: 'wheel'; center: Vector3; radius: number; tube: number; quaternion?: Quaternion }
  | { kind: 'box'; center: Vector3; size: Vector3; quaternion?: Quaternion };
