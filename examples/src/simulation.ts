import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { Humanoid, type Box, type Effector, type Intent, type Ladder, type Sphere, type World } from '@drawcall/animate';
import { createOpenPoseModel } from './openpose';
import { handOf } from './joints';
import { FIXED_DT, type Held, type Prop, type Scenario } from './scenario';

/** What an actor is asked to do and the scenery it is in, at one step (drawn as markers, read by the metrics). */
export interface Input extends Intent {
  ground: readonly Box[];
  floorObstacles: readonly Box[];
  bodyObstacles: readonly (Sphere | Box)[];
  ladders: readonly Ladder[];
}

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

  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }

  /** what each actor is asked to do now */
  inputs(): Input[] {
    return this.actors.map((h) => inputOf(h.status.intent, this.world));
  }

  /** the scenery as it is now: the scenario's props, the held ones in the solved hands */
  props(inputs: readonly Input[] = this.inputs()): Prop[] {
    return this.scenario.props(this.t).map((p) => ((p.kind === 'rod' || p.kind === 'ball') && p.held ? this.carry(p, p.held, inputs) : p));
  }

  /** `p` moved with its hand from where the hand's target holds it to where the solved hand does */
  private carry<P extends Extract<Prop, { held?: Held }>>(p: P, { hand, actor = 0 }: Held, inputs: readonly Input[]): P {
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
function inputOf(intent: Readonly<Intent>, scenery: Readonly<World>): Input {
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
