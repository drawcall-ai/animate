import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { Humanoid, type Input, type Ladder, type Options } from '@prohuman/core';
import { createOpenPoseModel } from '@prohuman/openpose';
import { handOf } from './joints';

/** scenery a scenario shows (drawn only: the humanoids know of it only through their input) */
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
  /** a ladder (the core's input): its stiles reach `rails` m above its top */
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

/** a target as the scenarios script it: always a point */
export interface Effector {
  position: Vector3;
  quaternion?: Quaternion;
  weight?: number;
}

/** what a scenario feeds a humanoid: the core input, with scripted targets */
export interface ScenarioInput extends Input {
  head?: Effector;
  chest?: Effector;
  hips?: Effector;
  leftHand?: Effector;
  rightHand?: Effector;
  leftFoot?: Effector;
  rightFoot?: Effector;
  goal?: Effector;
  seat?: Effector;
  mount?: Effector & { lean?: number };
}

export const EFFECTORS = ['head', 'chest', 'hips', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const;

export interface ScenarioRun {
  /** called every fixed step before the humanoids update */
  inputs(t: number, dt: number, actors: Humanoid[]): ScenarioInput[];
  props(): Prop[];
  /** the facing (yaw) the camera shots are taken against now: a vehicle's heading (default: the scenario's `facing`) */
  facing?(): number;
}

export interface Scenario {
  id: string;
  title: string;
  /** which effectors are driven — everything else is inferred */
  drives: string;
  description: string;
  duration: number;
  actors: Options[];
  create(): ScenarioRun;
  /** camera focus; defaults to the first actor's hips */
  focus?(actors: Humanoid[]): Vector3;
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

export const FIXED_DT = 1 / 60;

/** Deterministic fixed-step simulation of a scenario. */
export class Simulation {
  readonly actors: Humanoid[];
  readonly run: ScenarioRun;
  t = 0;
  lastInputs: ScenarioInput[] = [];

  /** `model` makes each actor's character model */
  constructor(
    readonly scenario: Scenario,
    model: () => CharacterModel = () => createOpenPoseModel(),
  ) {
    this.actors = scenario.actors.map((o) => new Humanoid(model(), o));
    this.run = scenario.create();
  }

  step() {
    this.update(this.script());
  }

  /** the scenario's inputs for the next step (also kept as `lastInputs`) */
  script(): ScenarioInput[] {
    const inputs = this.run.inputs(this.t, FIXED_DT, this.actors);
    if (inputs.length !== this.actors.length) throw new Error(`${this.scenario.id}: ${inputs.length} inputs for ${this.actors.length} actors`);
    this.lastInputs = inputs;
    return inputs;
  }

  /** one fixed step of every actor on `inputs` (from `script`) */
  update(inputs: ScenarioInput[]) {
    for (let i = 0; i < this.actors.length; i++) this.actors[i].update(FIXED_DT, inputs[i]);
    this.t += FIXED_DT;
  }

  /** the scenery as it is now: the run's props, the held ones in the solved hands */
  props(): Prop[] {
    return this.run.props().map((p) => ((p.kind === 'rod' || p.kind === 'ball') && p.held ? this.carry(p, p.held) : p));
  }

  /** `p` moved with its hand from where the target holds it to where the solved hand does */
  private carry<P extends Extract<Prop, { held?: Held }>>(p: P, { hand, actor = 0 }: Held): P {
    // (before the first step there are no targets yet)
    if (this.lastInputs.length === 0) return p;
    const target = this.lastInputs[actor][`${hand}Hand`];
    if (!target) throw new Error(`${this.scenario.id}: a prop is held in actor ${actor}'s ${hand} hand, which has no target`);
    const solved = handOf(this.actors[actor], hand, _p, _q);
    // the hand's turn from the target to the solved hand (none for a position-only target)
    const turn = target.quaternion ? solved.quaternion.multiply(_t.copy(target.quaternion).invert()) : _q.identity();
    const move = (v: Vector3) => v.clone().sub(target.position).applyQuaternion(turn).add(solved.position);
    return p.kind === 'rod' ? { ...p, position: move(p.position), to: move(p.to) } : { ...p, position: move(p.position) };
  }

  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }
}

const _p = new Vector3();
const _q = new Quaternion();
const _t = new Quaternion();
