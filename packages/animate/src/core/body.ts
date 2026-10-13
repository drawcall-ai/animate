import { TimelineRunner, type ReusableTimeline, type TimelineClock } from '@pmndrs/timeline';
import type { Quaternion, Vector3 } from 'three';
import { Board, merge, type Merged } from './board';
import { History } from './history';
import { contactResidual, targetResidual } from './rows';
import type { Skeleton } from './skeleton';
import { Solver } from './solver';
import { BodyState } from './state';
import type { Granted, Support } from './types';

/** the sub-step (s) */
export const STEP = 1 / 60;

/** What a body's behaviour sees and writes each sub-step. */
export interface Ctx<W = unknown> {
  /** the last solved state */
  body: Readonly<BodyState>;
  /** the world the body was made with; throws when it was made without one */
  readonly world: W;
  /** this sub-step's length (s) */
  dt: number;
  /** the simulation time of `body` (s) */
  time: number;
  propose: Board;
  /** what `owner`'s proposals got in the last sub-step, and how closely they were met */
  granted(owner: string): Granted;
  /** the winning contacts of the last merge that bear weight, where their points are now */
  supports(): Support[];
}

export interface BodyOptions<W> {
  world?: W;
  /** the root's start position (default its offset) */
  position?: Vector3;
  /** the root's start rotation (default none; it overrides `local[0]`) */
  rotation?: Quaternion;
  /** each bone's start rotation in its parent's frame, the root's in the world's (default none) */
  local?: readonly Quaternion[];
}

const NONE: Granted = { won: [], lost: [], targets: [] };

/**
 * An articulated body moved by one behaviour timeline: each 1/60 s sub-step the board is
 * cleared, the behaviour proposes, the proposals are merged and the solver advances the state.
 */
export class Body<W = unknown> {
  private readonly current: BodyState;
  private readonly solver: Solver;
  private readonly runner: TimelineRunner<Ctx<W>>;
  private readonly clock: TimelineClock = { delta: 0, prevDelta: 0, frame: 0 };
  private readonly ctx: Ctx<W>;
  private readonly history = new History();
  private merged: Merged | undefined;

  constructor(skeleton: Skeleton, behaviour: ReusableTimeline<Ctx<W>>, options: BodyOptions<W> = {}) {
    this.current = new BodyState(skeleton);
    if (options.local) {
      if (options.local.length !== skeleton.bones.length) throw new Error(`a start pose of ${options.local.length} rotations for ${skeleton.bones.length} bones`);
      options.local.forEach((q, i) => this.current.local[i].copy(q).normalize());
    }
    if (options.position) this.current.position.copy(options.position);
    if (options.rotation) this.current.local[0].copy(options.rotation).normalize();
    this.current.derive();
    this.solver = new Solver(skeleton);
    const { world } = options;
    this.ctx = {
      body: this.current,
      get world() {
        if (world === undefined) throw new Error('this body was made without a world');
        return world;
      },
      dt: STEP,
      time: 0,
      propose: new Board(),
      granted: (owner) => this.granted(owner),
      supports: () => this.supports(),
    };
    this.runner = new TimelineRunner(behaviour);
  }

  get state(): Readonly<BodyState> {
    return this.current;
  }

  /** the simulation time (s) */
  get time(): number {
    return this.ctx.time;
  }

  /** advances by `dt` (s) in ceil(dt · 60) even sub-steps */
  update(dt: number): void {
    if (!(dt >= 0 && Number.isFinite(dt))) throw new Error(`cannot update by ${dt} s`);
    // (1e-6: 1/30 · 60 is a hair above 2 in floating point)
    const steps = Math.ceil(dt / STEP - 1e-6);
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  private step(dt: number): void {
    const { ctx, clock } = this;
    ctx.propose.clear();
    ctx.dt = dt;
    clock.delta = dt;
    this.runner.step(ctx, clock);
    clock.prevDelta = dt;
    clock.frame++;
    this.merged = merge(ctx.propose, this.current.skeleton);
    this.history.apply(this.merged, this.current, dt);
    this.solver.step(this.current, this.merged, dt);
    ctx.time += dt;
  }

  private granted(owner: string): Granted {
    if (!this.merged) return NONE;
    const { soft } = this.solver;
    const outcome = this.merged.outcomes.get(owner);
    const targets = this.merged.targets
      .filter((t) => t.target.owner === owner)
      .map(({ target, weight }) => ({ ...target, weight, strain: targetResidual(soft, target) }));
    return {
      won: (outcome?.won ?? []).map((c) => ({ ...c, strain: contactResidual(soft, c), residual: contactResidual(this.current, c) })),
      lost: outcome?.lost ?? [],
      targets,
    };
  }

  private supports(): Support[] {
    if (!this.merged) return [];
    return this.merged.contacts
      .filter((c) => (c.support ?? 0) > 0)
      .map((contact) => ({ contact, position: this.current.point(contact.point, contact.position.clone()) }));
  }
}
