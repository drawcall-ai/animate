import type { Vector3 } from 'three';
import type { Behaviour, Humanoid, World } from '@drawcall/animate';
import type { Report } from './report';

export const FIXED_DT = 1 / 60;

/** An actor's part: where it starts. */
export interface Role {
  /** on the floor */
  position?: { x: number; z: number };
  /** facing about +Y (0 faces +Z) */
  yaw?: number;
}

/** A run of a scenario: its world, its scenery and carriers, and its actors' behaviours (made fresh for every run). */
export interface Stage {
  world: World;
  /** what the script asked of the first actor, for the metrics */
  report: Report;
  /** the scenery drawn at time `t` (s) */
  props(t: number): Prop[];
  /** whether the run did what the scenario is for (asked at its end; default: nothing to check) */
  done?(): boolean;
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
  stage(): Stage;
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

/** scenery a scenario shows (drawn only: the humanoids know of it only through their world and its carriers) */
export type Prop = { kind: 'box'; position: Vector3; size: Vector3; yaw?: number } | { kind: 'ball'; position: Vector3; radius: number };
