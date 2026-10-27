import { Vector3, type Group, type Object3D } from 'three';
import type { ReusableTimeline } from '@pmndrs/timeline';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, humanoid, type BodyOptions, type Species } from '@drawcall/animate';
import { PERSON, scaled, type PersonSkeleton } from './skeletons';

export const FIXED_DT = 1 / 60;

/** A person: a body of a humanoid species. */
export type Person = Body<Species<string, 'left' | 'right'>>;

/** How a run makes its bodies: checked or not, on which person's skeleton, dressed in which models, varied how. */
export interface CastOptions {
  /** development checks on every body (`dev: true`) */
  dev?: boolean;
  /** the skeleton people stand on where a scenario does not name one (default `PERSON`) */
  skeleton?: PersonSkeleton;
  /** the rigged model a body of `skeleton` wears, if the app has one (the bodies are bare without) */
  dress?: (skeleton: readonly SkeletonBone[]) => Object3D | undefined;
  /** a random source each person is varied by: up to 10 cm off where it starts, turned up to 0.15 rad, up to 4 % taller or shorter */
  vary?: () => number;
}

/** The bodies of a run, made as its options say. */
export class Cast {
  constructor(readonly options: CastOptions = {}) {}

  /** a person on the cast's skeleton, or on `skeleton` */
  person(options: BodyOptions = {}, skeleton: PersonSkeleton = this.options.skeleton ?? PERSON): Person {
    const { vary } = this.options;
    if (!vary) return this.body(humanoid(skeleton), options);
    const jitter = (range: number) => (vary() * 2 - 1) * range;
    const at = (options.at ?? new Vector3()).clone().add(new Vector3(jitter(0.1), 0, jitter(0.1)));
    return this.body(humanoid(scaled(skeleton, 1 + jitter(0.04))), { ...options, at, face: (options.face ?? 0) + jitter(0.15) });
  }

  /** a body of `species` */
  body<S extends Species>(species: S, options: BodyOptions = {}): Body<S> {
    return new Body(species, { dev: this.options.dev, model: this.options.dress?.(species.bones), ...options });
  }
}

/** A run of a scenario: its scene, its bodies and the story they play out (made fresh for every run). */
export interface Stage {
  /** the props and things (each body's object is added to it) */
  scene: Group;
  /** every body, people first */
  bodies: readonly Body[];
  /** what the bodies do, run on the app's timeline: its frame is stepped before the bodies update */
  story: ReusableTimeline<unknown, unknown>;
  /** whether the run did what the scenario is for (asked at its end) */
  done(): boolean;
  /** a player's controls, if a player drives the first person */
  player?: Player;
  /** what must keep out of the first person's body as things are now: the things it handles (for the metrics) */
  solids?(): Solid[];
}

/** A scenario: what it is, how it is shown; `stage` makes a run of it. */
export interface Scenario {
  id: string;
  title: string;
  description?: string;
  /** s */
  duration: number;
  stage(cast: Cast): Stage;
  cameraDistance?: number;
  /** World yaw of a fixed shot, overriding its usual body-relative bearing. */
  cameraAngles?: Partial<Record<'front' | 'side', number>>;
  /** false: no plain grid (the scenario draws its own ground) */
  grid?: false;
  /** surroundings drawn instead of the plain grid; `center` = where the ring is centred */
  environment?: { kind: 'boxing-arena'; center: [number, number, number] };
}

/** A player's part in a run: its controls this frame, what it is doing, and where it looks from. */
export interface Player {
  input: { move: { x: number; z: number }; aimYaw: number; aimPitch: number; fire: boolean; ads: boolean; sprint: boolean; crouch: boolean; jump: boolean; reload: boolean; view: 'first' | 'third' };
  /** the input comes from the keyboard and mouse (not a script) */
  live: boolean;
  /** what the player is doing beyond moving (a reload under way, its steps so far, the magazines it moves) */
  status?: () => { reloading: boolean; steps: readonly string[]; magazines: readonly Object3D[] };
  /** the look the last frame placed the aim in: what the player's camera shows */
  look(): Look;
}

/** Where a player looks from (the eye) and which way (rad). */
export interface Look {
  eye: Vector3;
  yaw: number;
  pitch: number;
}

/** a segment `a`–`b` (world) thickened by `radius` that keeps out of a body but its parts `touches` (those that wear or bear it) and the hands holding `thing` */
export interface Solid {
  /** what it is (for the metrics' report) */
  name: string;
  /** the thing it is of: a hand holding it (and its forearm) may touch it */
  thing?: Object3D;
  a: Vector3;
  b: Vector3;
  radius: number;
  touches: readonly string[];
}
