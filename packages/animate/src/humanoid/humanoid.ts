import { Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import type { ReusableTimeline } from '@pmndrs/timeline';
import { Body, type Ctx } from '../core/body';
import { BodyState } from '../core/state';
import type { Proportions } from './proportions';
import { Rig } from './rig';
import { standing } from './start';
import { defaultStance, feetFacing } from './stance';
import { Hints } from './hints';
import { createStatus, type Foot, type Status } from './status';

export interface HumanoidOptions<W> {
  world?: W;
  /** where the body stands (on the floor, y = 0) */
  position?: { x: number; z: number };
  /** its facing about +Y (0 faces +Z) */
  yaw?: number;
}

/**
 * A @pmndrs/viverse character model as a body stepping `behaviour` (made for this humanoid: it
 * reads the rig and writes the status), posed after every update. The body starts standing
 * relaxed where `options` puts it. One Humanoid per model.
 */
export class Humanoid<W = unknown> {
  readonly rig: Rig;
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  /** what the behaviours report: footing, seated, mounted, intent */
  readonly status: Status;
  /** what the behaviours ask of each other */
  readonly hints = new Hints();
  private readonly body: Body<W>;
  private readonly ground = new Vector3();

  constructor(
    readonly model: CharacterModel,
    behaviour: (h: Humanoid<W>) => ReusableTimeline<Ctx<W>>,
    options: HumanoidOptions<W> = {},
  ) {
    const rig = (this.rig = new Rig(model));
    const p = (this.proportions = rig.proportions);
    const yaw = options.yaw ?? 0;
    const floor = new Vector3(options.position?.x ?? 0, 0, options.position?.z ?? 0);
    // standing relaxed from the start, the feet planted under it (the status first: the
    // behaviour starts as the body is made)
    const stance = defaultStance(p);
    const start = standing(rig, p, stance, floor, yaw);
    this.status = createStatus(start.feet, stance);
    this.body = new Body(rig.skeleton, behaviour(this), { world: options.world, position: start.state.position, local: start.state.local });
    const state = this.body.state;
    rig.write(state, 0);
  }

  /** the last solved state */
  get state(): Readonly<BodyState> {
    return this.body.state;
  }

  /** [left, right]; read-only */
  get feet(): readonly [Readonly<Foot>, Readonly<Foot>] {
    return this.status.feet;
  }

  /** how far the body is seated (0 standing … 1 seated) */
  get seated(): number {
    return this.status.seated;
  }

  /** riding a mount */
  get mounted(): boolean {
    return this.status.mounted;
  }

  /** the body's facing about +Y (0 faces +Z): as the behaviours hint it, else as the feet stand */
  get yaw(): number {
    const { feet, stance } = this.status;
    return this.hints.last.facing ?? feetFacing(feet[0].yaw, feet[1].yaw, stance);
  }

  /** the body's ground velocity: its centre of mass's, horizontal (m/s); read-only */
  get velocity(): Readonly<Vector3> {
    const v = this.body.state.comVelocity;
    return this.ground.set(v.x, 0, v.z);
  }

  /** a copy of the last solved state, as other bodies read it */
  snapshot(): Readonly<BodyState> {
    return new BodyState(this.rig.skeleton).copy(this.body.state);
  }

  /** Advances the body by `dt` seconds and poses the model; a VRM is updated by `dt` too. */
  update(dt: number) {
    this.body.update(dt);
    this.rig.write(this.body.state, dt);
  }
}
