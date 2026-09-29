import { Vector3 } from 'three';
import { Humanoid, type HumanoidInput, type HumanoidOptions } from '@prohuman/core';

export interface Prop {
  kind: 'box' | 'shelf' | 'tray' | 'ball';
  position: Vector3;
  size: Vector3;
  yaw?: number;
}

export interface ScenarioRun {
  /** called every fixed step before the humanoids update */
  inputs(t: number, dt: number, actors: Humanoid[]): HumanoidInput[];
  props(): Prop[];
}

export interface Scenario {
  id: string;
  title: string;
  /** which effectors are driven — everything else is inferred */
  drives: string;
  description: string;
  duration: number;
  actors: HumanoidOptions[];
  create(): ScenarioRun;
  /** camera focus; defaults to the first actor's pelvis */
  focus?(actors: Humanoid[]): Vector3;
  cameraDistance?: number;
  /** surroundings drawn instead of the plain grid; `center` = where the ring is centred */
  environment?: { kind: 'boxing-arena'; center: [number, number, number] };
}

export const FIXED_DT = 1 / 60;

/** Deterministic fixed-step simulation of a scenario. */
export class Simulation {
  readonly actors: Humanoid[];
  readonly run: ScenarioRun;
  t = 0;
  lastInputs: HumanoidInput[] = [];

  constructor(readonly scenario: Scenario) {
    this.actors = scenario.actors.map((o) => new Humanoid(o));
    this.run = scenario.create();
  }

  step() {
    this.lastInputs = this.run.inputs(this.t, FIXED_DT, this.actors);
    this.actors.forEach((a, i) => a.update(this.lastInputs[i] ?? {}, FIXED_DT));
    this.t += FIXED_DT;
  }

  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }
}
