import type { CharacterModel } from '@pmndrs/viverse';
import { Humanoid, type World } from '@drawcall/animate';
import { createOpenPoseModel } from './openpose';
import { FIXED_DT, type Prop, type Scenario } from './scenario';

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

  /** one fixed step of every actor, each reading the others as they were last step */
  step() {
    this.actors.forEach((h, i) => this.world.bodies[i].copy(h.pose));
    for (const h of this.actors) h.update(FIXED_DT);
    this.t += FIXED_DT;
  }

  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }

  /** the scenery as it is now */
  props(): Prop[] {
    return this.scenario.props(this.t);
  }
}
