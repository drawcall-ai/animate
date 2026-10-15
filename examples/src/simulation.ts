import { parallel } from '@pmndrs/timeline';
import type { CharacterModel } from '@pmndrs/viverse';
import { Humanoid, watch, type Frame, type Pose, type World } from '@drawcall/animate';
import { createOpenPoseModel } from './openpose';
import { FIXED_DT, type Prop, type Role, type Scenario, type Stage } from './scenario';

/** Deterministic fixed-step run of a scenario: its carriers moved, then every actor stepped, at 60 Hz. */
export class Simulation {
  readonly stage: Stage;
  readonly world: World;
  readonly actors: Humanoid<World>[] = [];
  /** the actors' poses as the world shows them: as they were last step */
  private readonly bodies: Pose[];
  /** s */
  t = 0;

  /** `model` makes each actor's character model for its role */
  constructor(
    readonly scenario: Scenario,
    model: (role: Role) => CharacterModel = (role) => createOpenPoseModel({ height: role.height }),
    dev = false,
  ) {
    this.stage = scenario.stage(dev);
    this.world = this.stage.world;
    const cast = this.actors;
    scenario.actors.forEach((role, i) => {
      cast.push(new Humanoid(model(role), (h) => {
        const story = this.stage.script(h, i, cast);
        if (!dev) return story;
        const finished = watch<World>(scenario.id, (f) => f.time + 1e-9 >= scenario.duration && !this.stage.done()
          ? { check: 'scenario unfinished', value: 1, limit: 0, where: scenario.id } : null);
        return function* () { yield* parallel<Frame<World>>('all', finished, story); };
      }, { dev, world: this.world, position: role.position, yaw: role.yaw, wearing: (p) => this.stage.wearing?.(i, p) ?? [] }));
    });
    this.bodies = cast.map((h) => h.snapshot());
    this.world.bodies = this.bodies;
  }

  /** one fixed step: the carriers to where they are then, every actor reading the others as they were last step */
  step() {
    this.stage.move?.(this.t + FIXED_DT);
    this.actors.forEach((h, i) => this.bodies[i].copy(h.pose));
    for (const h of this.actors) h.update(FIXED_DT);
    this.stage.bodies?.forEach((b) => b.update(FIXED_DT));
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
