import type { ReusableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '@prohuman/body';
import type { Humanoid, Stance, World } from '@prohuman/humanoid';
import type { Prop } from '../scenario';

/** An actor's part: where it starts, and how it stands at ease (the old stance options; set, the metrics skip the rest-stance check). */
export interface Role {
  /** on the floor */
  position?: { x: number; z: number };
  /** facing about +Y (0 faces +Z) */
  yaw?: number;
  stance?: Partial<Stance>;
}

/**
 * A scenario as timelines: one behaviour per actor, composed by `script` from behaviours and the
 * scenario's own direction. A script reports what it asks of its actor (effector targets, a seat,
 * a mount) in the actor's `status.intent`, which the metrics read.
 */
export interface Scenario {
  id: string;
  title: string;
  description?: string;
  /** s */
  duration: number;
  actors: readonly Role[];
  /** a fresh world for a run (its `bodies` are filled in by the simulation) */
  world(): World;
  /** the scenery drawn at time `t` (s) */
  props(t: number): Prop[];
  /**
   * the behaviour of actor `index` of `cast` (made in order: while the behaviours are being made,
   * `cast` holds only the actors before; by the time they run, all)
   */
  script(actor: Humanoid<World>, index: number, cast: readonly Humanoid<World>[]): ReusableTimeline<Ctx<World>>;
}
