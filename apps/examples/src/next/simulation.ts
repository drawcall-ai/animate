import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { Humanoid, type Effector, type Intent, type World } from '@prohuman/humanoid';
import { createOpenPoseModel } from '@prohuman/openpose';
import { handOf } from '../joints';
import { FIXED_DT, type Held, type Prop, type ScenarioInput, type Shot, type Shown } from '../scenario';
import type { Scenario } from './scenario';

/** Deterministic fixed-step run of a scenario: every actor stepped at 60 Hz. */
export class Simulation {
  readonly world: World;
  readonly actors: Humanoid<World>[] = [];
  /** s */
  t = 0;

  /** `model` makes each actor's character model */
  constructor(
    readonly scenario: Scenario,
    model: () => CharacterModel = () => createOpenPoseModel(),
  ) {
    this.world = scenario.world();
    const cast = this.actors;
    scenario.actors.forEach((role, i) => {
      cast.push(new Humanoid(model(), (h) => scenario.script(h, i, cast), { world: this.world, position: role.position, yaw: role.yaw }));
    });
    this.world.bodies = cast.map((h) => h.snapshot());
  }

  /** one fixed step of every actor, each reading the others as they were solved last step */
  step() {
    this.world.bodies = this.actors.map((h) => h.snapshot());
    for (const h of this.actors) h.update(FIXED_DT);
    this.t += FIXED_DT;
  }

  /** what each actor is asked to do now, as the old scenarios' input gave it: its intent and the world's scenery */
  inputs(): ScenarioInput[] {
    return this.actors.map((h) => inputOf(h.status.intent, this.world));
  }

  /** the scenery as it is now: the scenario's props, the held ones in the solved hands */
  props(inputs: readonly ScenarioInput[] = this.inputs()): Prop[] {
    return this.scenario.props(this.t).map((p) => ((p.kind === 'rod' || p.kind === 'ball') && p.held ? this.carry(p, p.held, inputs) : p));
  }

  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }

  /** `p` moved with its hand from where the hand's target holds it to where the solved hand does */
  private carry<P extends Extract<Prop, { held?: Held }>>(p: P, { hand, actor = 0 }: Held, inputs: readonly ScenarioInput[]): P {
    const target = inputs[actor][`${hand}Hand`];
    if (!target) throw new Error(`${this.scenario.id}: a prop is held in actor ${actor}'s ${hand} hand, which has no target`);
    const solved = handOf(this.actors[actor], hand, _p, _q);
    // the hand's turn from the target to the solved hand (none for a position-only target)
    const turn = target.quaternion ? solved.quaternion.multiply(_t.copy(target.quaternion).invert()) : _q.identity();
    const move = (v: Vector3) => v.clone().sub(target.position).applyQuaternion(turn).add(solved.position);
    return p.kind === 'rod' ? { ...p, position: move(p.position), to: move(p.to) } : { ...p, position: move(p.position) };
  }
}

const _p = new Vector3();
const _q = new Quaternion();
const _t = new Quaternion();

const copy = (e: Effector | undefined) => e && { position: e.position.clone(), quaternion: e.quaternion?.clone(), weight: e.weight };

/** An actor's intent and the world's scenery as one input record (copies: the status changes on). */
export function inputOf(intent: Readonly<Intent>, scenery: Readonly<World>): ScenarioInput {
  const { mount } = intent;
  return {
    ground: scenery.ground,
    floorObstacles: scenery.floorObstacles,
    bodyObstacles: scenery.bodyObstacles,
    ladders: scenery.ladders,
    head: copy(intent.head),
    chest: copy(intent.chest),
    hips: copy(intent.hips),
    leftHand: copy(intent.leftHand),
    rightHand: copy(intent.rightHand),
    leftFoot: copy(intent.leftFoot),
    rightFoot: copy(intent.rightFoot),
    lookAt: intent.lookAt?.clone(),
    seat: copy(intent.seat),
    mount: mount && { position: mount.position.clone(), quaternion: mount.quaternion?.clone(), weight: mount.weight, lean: mount.lean },
    handForce: intent.handForce?.clone(),
  };
}

/** A new-core scenario as the app shows it, listed beside the old one it recreates. */
export class Showing implements Shown {
  readonly sim: Simulation;
  readonly scenario: Shot;

  constructor(scenario: Scenario, model?: () => CharacterModel) {
    this.sim = new Simulation(scenario, model);
    this.scenario = shotOf(scenario);
  }

  get actors() {
    return this.sim.actors;
  }

  get t() {
    return this.sim.t;
  }

  get lastInputs() {
    return this.sim.inputs();
  }

  facing() {
    return undefined;
  }

  props() {
    return this.sim.props();
  }

  step() {
    this.sim.step();
  }

  advanceTo(t: number) {
    this.sim.advanceTo(t);
  }
}

/** how a new-core scenario is listed: apart from the old one with its id */
export const shotOf = (s: Scenario): Shot => ({ id: `next-${s.id}`, title: `next · ${s.title}`, duration: s.duration, drives: 'new core (@prohuman/body + humanoid timelines)', description: s.description });
