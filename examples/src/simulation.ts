import type { CharacterModel } from '@pmndrs/viverse';
import { Humanoid, World, type Body } from '@drawcall/animate';
import { createOpenPoseModel } from './openpose';
import { openPoseOf } from './skeletons';
import type { Skin } from './stage/skin';
import { FIXED_DT, type Prop, type Role, type Scenario, type Stage } from './scenario';

/** Deterministic fixed-step run of a scenario: its carriers moved, then every actor and body stepped, at 60 Hz. */
export class Simulation {
  readonly stage: Stage;
  readonly world = new World();
  readonly actors: Humanoid[] = [];
  /** what the stage's bodies wear (`scenario.skins`), posed after every step */
  readonly skins: (Skin | null)[];
  /** s */
  t = 0;

  /** `model` makes each actor's character model for its role, `skin` a body's skin from its url (none: the bodies are drawn as skeletons) */
  constructor(
    readonly scenario: Scenario,
    model: (role: Role) => CharacterModel = (role) => (role.skeleton ? openPoseOf(role.skeleton) : createOpenPoseModel({ height: role.height })),
    dev = false,
    skin?: (url: string, body: Body) => Skin,
  ) {
    this.stage = scenario.stage(dev);
    const cast = this.actors;
    scenario.actors.forEach((role, i) => {
      // (each script runs its own base: `idle` from the rig; it is made with its actor, in order, as a script may set up the stage)
      const actor = new Humanoid(model(role), () => script,
        { dev, at: role.position, yaw: role.yaw, wearing: (p) => this.stage.wearing?.(i, p) ?? [], idle: false });
      const script = this.stage.script(actor, i, cast);
      cast.push(actor);
    });
    this.world.add(...cast, ...this.stage.bodies ?? []);
    this.skins = (this.stage.bodies ?? []).map((body, i) => {
      const url = scenario.skins?.[i];
      return url && skin ? skin(url, body) : null;
    });
    this.dress();
  }

  private dress() {
    this.skins.forEach((skin, i) => skin?.pose(this.stage.bodies![i].pose));
  }

  /** one fixed step: the carriers to where they are then, every body reading the others as they were last step */
  step() {
    this.stage.move?.(this.t + FIXED_DT);
    this.world.update(FIXED_DT);
    this.dress();
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
