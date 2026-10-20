import type { Quaternion, Vector3 } from 'three';
import type { Body, Behaviour, Dressed, Humanoid, Item, Proportions, World } from '@drawcall/animate';
import type { Report } from './report';

export const FIXED_DT = 1 / 60;

/** An actor's part: where it starts. */
export interface Role {
  /** on the floor */
  position?: { x: number; z: number };
  /** facing about +Y (0 faces +Z) */
  yaw?: number;
  /** standing height (m; default the model's) */
  height?: number;
}

/** A run of a scenario: its world, its scenery and carriers, and its actors' behaviours (made fresh for every run). */
export interface Player {
  input: { move: { x: number; z: number }; aimYaw: number; aimPitch: number; fire: boolean; ads: boolean; sprint: boolean; crouch: boolean; jump: boolean; reload: boolean; view: 'first' | 'third' };
  live: boolean;
  /** the root the player drives: where the body is on the floor, how fast it goes, which way it faces */
  root?: { position: Vector3; velocity: Vector3; yaw: number; crouch?: number };
  /** what the player is doing beyond moving (a reload under way, its steps so far, the items it moves) */
  status?: () => { reloading: boolean; steps: readonly string[]; magazines: readonly Item[] };
  eyes(): Vector3;
}

export interface Stage {
  player?: Player;
  world: World;
  /** Generic articulated bodies stepped alongside the humanoid cast. */
  bodies?: readonly Body[];
  /** what the script asked of the first actor, for the metrics */
  report: Report;
  /** the scenery drawn at time `t` (s) */
  props(t: number): Prop[];
  /** whether the run did what the scenario is for (asked at its end) */
  done(): boolean;
  /** what actor `index` wears from the start, for its proportions (made with it: worn and borne from its first sub-step) */
  wearing?(index: number, p: Proportions): readonly Dressed[];
  /** what must keep out of the first actor's body as things are now: the items it handles (for the metrics) */
  solids?(): Solid[];
  /** moves the scenario's own carriers to time `t` (s), before the bodies step (they read them there) */
  move?(t: number): void;
  /**
   * the behaviour of actor `index` of `cast` (made in order: while the behaviours are being made,
   * `cast` holds only the actors before; by the time they run, all)
   */
  script(actor: Humanoid<World>, index: number, cast: readonly Humanoid<World>[]): Behaviour<World>;
}

/** A scenario: its actors and how they are shown; `stage` makes a run of it. */
export interface Scenario {
  id: string;
  title: string;
  description?: string;
  /** s */
  duration: number;
  actors: readonly Role[];
  stage(dev?: boolean): Stage;
  cameraDistance?: number;
  /** World yaw of a fixed shot, overriding its usual body-relative bearing. */
  cameraAngles?: Partial<Record<'front' | 'side', number>>;
  /** the actors' character model: OpenPose skeletons (default), or a viverse character — a model file, or viverse's mannequin without `url` */
  body?: 'openpose' | { url?: string };
  /** false: no plain grid (the scenario draws its own ground, a slope) */
  grid?: false;
  /** surroundings drawn instead of the plain grid; `center` = where the ring is centred */
  environment?: { kind: 'boxing-arena'; center: [number, number, number] };
}

/** scenery a scenario shows (drawn only: the humanoids know of it only through their world and its carriers); a cylinder's axis is its local +Y */
export type Prop =
  | { kind: 'box'; position: Vector3; size: Vector3; quaternion?: Quaternion }
  | { kind: 'cylinder'; color?: number; position: Vector3; radius: number; length: number; quaternion?: Quaternion }
  | { kind: 'ball'; position: Vector3; radius: number };

/** a segment `a`–`b` (world) thickened by `radius` that keeps out of a body but its parts `touches` (those that wear or bear it) and the hands holding its item */
export interface Solid {
  /** what it is (for the metrics' report) */
  name: string;
  /** the item it is of: a hand holding it (and its forearm) may touch it */
  item?: Item;
  a: Vector3;
  b: Vector3;
  radius: number;
  touches: readonly string[];
}
