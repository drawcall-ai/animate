import type { Quaternion, Vector3 } from 'three';
import type { BodyState } from '@prohuman/body';

/** An axis-aligned box (a THREE.Box3 fits). */
export interface Box {
  min: Vector3;
  max: Vector3;
}

/** A sphere (a THREE.Sphere fits). */
export interface Sphere {
  center: Vector3;
  radius: number;
}

/**
 * A ladder standing on the floor against the ground it leads up to: its rungs, `spacing` apart
 * (default 0.3 m), from the floor at `position` (the middle of its foot, on the rungs' line) up to
 * `height`, where that ground's top is; climbed facing `yaw`. Its stiles are `width` apart
 * (default 0.46 m) and reach on above the top.
 */
export interface Ladder {
  position: Vector3;
  yaw: number;
  height: number;
  spacing?: number;
  width?: number;
}

/** Somewhere to sit: the seat surface under the hips, and the seated facing (its up tilted back as far as a backrest leans). */
export interface Seat {
  position: Vector3;
  quaternion: Quaternion;
}

/**
 * Something that carries a body (a bicycle, a board, a car, a horse), as it is now: where it
 * stands on the ground under the body (what it leans and rocks about), its heading, and its
 * velocity (m/s).
 */
export interface Mount {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
}

/**
 * Something that happened between actors, at `time` (s): `kind` names it (a 'hit'), `actor` is
 * the actor it happened to (by index), `position` and `velocity` where and how hard (a hit's
 * change of velocity, m/s).
 */
export interface WorldEvent {
  time: number;
  kind: string;
  actor: number;
  position?: Vector3;
  velocity?: Vector3;
}

/**
 * The world the actors share, as plain data the behaviours read (and the app keeps up to date):
 * - `floorObstacles`: boxes standing on the floor (stepped over, jumped, walked around)
 * - `ground`: boxes whose tops are floor to stand on (climbed onto when too high to step)
 * - `ladders`: ladders up to ground
 * - `bodyObstacles`: volumes the trunk and head give way to (a held box, a low ceiling)
 * - `seats`, `mounts`: what can be sat on and ridden
 * - `bodies`: every actor's body as solved last frame, by actor (bodies read each other only
 *   through these, so the order they update in changes nothing)
 * - `events`: what happened between actors, oldest first
 */
export interface World {
  floorObstacles: Box[];
  ground: Box[];
  ladders: Ladder[];
  bodyObstacles: (Sphere | Box)[];
  seats: Seat[];
  mounts: Mount[];
  bodies: Readonly<BodyState>[];
  events: WorldEvent[];
}

/** A world of `parts`, empty otherwise. */
export function createWorld(parts: Partial<World> = {}): World {
  return { floorObstacles: [], ground: [], ladders: [], bodyObstacles: [], seats: [], mounts: [], bodies: [], events: [], ...parts };
}
