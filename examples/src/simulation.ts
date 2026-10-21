import type { CharacterModel } from '@pmndrs/viverse';
import { Body, human, World, type Humanoid } from '@drawcall/animate';
import { createOpenPoseModel } from './openpose';
import { FIXED_DT, type Prop, type Role, type Scenario, type Stage } from './scenario';

/** Deterministic fixed-step run of a scenario: its carriers moved, then every actor and body stepped, at 60 Hz. */
export class Simulation {
  readonly stage: Stage;
  readonly world = new World();
  readonly actors: Humanoid[] = [];
  /** s */
  t = 0;

  /** `model` makes each actor's character model for its role */
  constructor(
    readonly scenario: Scenario,
    model: (role: Role) => CharacterModel = (role) => createOpenPoseModel({ height: role.height }),
    dev = false,
  ) {
    this.stage = scenario.stage(dev);
    const cast = this.actors;
    scenario.actors.forEach((role, i) => {
      // (each script runs its own base: `idle` from the rig)
      cast.push(new Body(human(model(role)), (h) => this.stage.script(h as Humanoid, i, cast),
        { dev, at: role.position, yaw: role.yaw, wearing: (p) => this.stage.wearing?.(i, p) ?? [], idle: false }) as Humanoid);
    });
    this.world.add(...cast, ...this.stage.bodies ?? []);
  }

  /** one fixed step: the carriers to where they are then, every body reading the others as they were last step */
  step() {
    this.stage.move?.(this.t + FIXED_DT);
    this.world.update(FIXED_DT);
    this.t += FIXED_DT;
  }
  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }

  /** the scenery as it is now */
  props(): Prop[] {
    return this.stage.props(this.t);
  }
}
