import { Quaternion, Vector3 } from 'three';
import type { Box, Sphere } from '../input';

/** A position the body should bring something to, blended by `weight` (0..1). */
export interface Task {
  pos: Vector3;
  weight: number;
}

/** A wrist target, optionally with the hand's world rotation. */
export interface HandTask extends Task {
  rot: Quaternion | null;
}

export interface OrientedTask {
  pos: Vector3 | null;
  rot: Quaternion | null;
  weight: number;
}

/** An ankle target with the foot's rotation (a wrist target's shape). */
export type FootTask = HandTask;

/** What carries the body (its position and heading), and where the feet go on it. */
export interface MountTask {
  pos: Vector3;
  rot: Quaternion | null;
  /** the share of a balanced lean the body takes itself (1: balancing freely) */
  lean: number;
  /** how far it carries the body (0..1): getting on or off, the rest stands on the ground */
  weight: number;
  /** [left, right]; null: the foot stays where it is on the mount */
  feet: [FootTask | null, FootTask | null];
}

/** Where the hip joints rest seated, and how far its backrest leans back (rad). */
export interface SeatTask extends Task {
  recline: number;
}

/** Where to stand (x, z of the support centre) and optionally which way to face. */
export interface GoalTask extends Task {
  yaw: number | null;
}

/** The tracked body parts: the body must go where they are measured. */
export interface Tracked {
  /** where the eye midpoint goes */
  head: Task | null;
  chest: OrientedTask | null;
  hips: OrientedTask | null;
}

/** What the body is asked to do this tick. */
export interface Tasks extends Tracked {
  /** the wrist targets as asked [left, right]: where to stand and look */
  hands: [HandTask | null, HandTask | null];
  /** the wrist targets acted on now [left, right]: faded in by readiness (far ones are walked to first) */
  reach: [HandTask | null, HandTask | null];
  /** kicking / lifted feet [left, right] (mounted: none, the mount's feet stand on theirs) */
  feet: [Task | null, Task | null];
  /** what carries the body: while given, the body rides it */
  mount: MountTask | null;
  /** gaze target: people turn to face what they attend to */
  look: Vector3 | null;
  /** a tracked head orientation (VR), and its yaw: the body follows once it exceeds comfortable neck rotation */
  headRot: Quaternion | null;
  headYaw: number | null;
  goal: GoalTask | null;
  /** where the hip joints rest when seated; `weight` = how far down (0 standing, 1 seated) */
  seat: SeatTask | null;
  /** boxes on the floor: nobody stands in them, low ones are stepped over */
  floorObstacles: readonly Box[];
  /** boxes whose tops are floor to stand on */
  ground: readonly Box[];
  /** volumes the trunk and head stay out of, and the knees out of the spheres */
  bodyObstacles: readonly (Sphere | Box)[];
  /** the body obstacles as the body approaches them, which the posture is solved against: boxes reach toward it (it ducks ahead of time) */
  approaching: readonly (Sphere | Box)[];
  /** where balance holds the centre of mass off the feet (m, horizontal): leaning into the force the hands exert */
  readonly lean: Vector3;
}

export function emptyTasks(): Tasks {
  return {
    hands: [null, null],
    reach: [null, null],
    head: null,
    chest: null,
    hips: null,
    feet: [null, null],
    mount: null,
    look: null,
    headRot: null,
    headYaw: null,
    goal: null,
    seat: null,
    floorObstacles: [],
    ground: [],
    bodyObstacles: [],
    approaching: [],
    lean: new Vector3(),
  };
}

/** An oriented task with the vectors it may point to (reused from tick to tick). */
export interface OwnedTask {
  pos: Vector3;
  rot: Quaternion;
  task: OrientedTask;
}

export function ownedTask(): OwnedTask {
  const pos = new Vector3();
  const rot = new Quaternion();
  return { pos, rot, task: { pos, rot, weight: 0 } };
}

/** Whether a body part (head, chest or hips) is tracked: the body must go where it's measured. */
export const tracksBody = (t: Tracked) => !!(t.head || t.chest || t.hips);
