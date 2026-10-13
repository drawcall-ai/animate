import { Vector3 } from 'three';
import { action, parallel, type ReusableTimeline, type UntilCondition } from '@pmndrs/timeline';
import type { Ctx } from '../../core/body';
import type { Humanoid } from '../humanoid';
import { forwardOf, yawOf } from '../math';
import type { Effector } from '../status';
import { walk } from './walk';

/** a body part a target may lead the body by */
export type Part = 'hips' | 'head' | 'hands';

export interface FollowOptions<W> {
  /** the part's target, asked every frame (for `hands`, both hands' midpoint) */
  target: (ctx: Ctx<W>) => Readonly<Effector>;
  /** the top speed (m/s) and acceleration (m/s²) of the walk */
  speed?: number;
  accel?: number;
  until?: UntilCondition<Ctx<W>>;
}

/**
 * how far ahead of where the body stands each part's target is held (× height): the hips over
 * it, the eyes a little ahead, the hands at a comfortable reach in front
 */
const AHEAD: Record<Part, number> = { hips: 0, head: 0.02, hands: 0.17 };
/** how quickly the target's way is picked up (1/s), and how fast it must go for its way to be the one to face (m/s) */
const HEADING_RATE = 4;
const HEADING_SPEED = 0.1;

const _v = new Vector3();

/**
 * Following a body part's far target: nobody scripts the steps. Where the body must stand for the
 * part to be at its target becomes the walk's goal, the way the target goes its facing; a target
 * close by is met by the body's own reach, one a bit away by a step, a far one walked to. The
 * hips' or head's target is reported in the intent; the hands' are their reach's.
 */
export function follow<W>(h: Humanoid<W>, part: Part, options: FollowOptions<W>): ReusableTimeline<Ctx<W>> {
  return function* () {
    const goal = new Vector3();
    const last = new Vector3();
    const velocity = new Vector3();
    let facing = h.yaw;
    let seen = false;
    const aim = (ctx: Ctx<W>) => {
      const at = options.target(ctx).position;
      // the way the target goes, smoothed: the facing to follow it with
      if (seen && ctx.dt > 0) velocity.lerp(_v.subVectors(at, last).divideScalar(ctx.dt).setY(0), 1 - Math.exp(-HEADING_RATE * ctx.dt));
      last.copy(at);
      seen = true;
      if (velocity.length() > HEADING_SPEED) facing = yawOf(velocity.x, velocity.z);
      return goal.set(at.x, 0, at.z).addScaledVector(forwardOf(facing), -AHEAD[part] * h.proportions.height);
    };
    const walking = walk(h, { to: aim, facing: () => facing, speed: options.speed, accel: options.accel, eager: true, until: options.until });
    // (the hands' targets are their reach's to report; the hips' and the head's are taken on here)
    if (part === 'hands') yield* walking();
    else yield* parallel<Ctx<W>>('race', walking, intend(h, part, options.target));
  };
}

/** reports `part`'s target in the intent every frame (what the body is asked to do, as the metrics read it) */
export function intend<W>(h: Humanoid<W>, part: 'hips' | 'head' | 'leftHand' | 'rightHand', target: (ctx: Ctx<W>) => Readonly<Effector>): ReusableTimeline<Ctx<W>> {
  return function* () {
    try {
      yield* action<Ctx<W>>({
        update: (ctx) => {
          const t = target(ctx);
          const own = (h.status.intent[part] ??= { position: new Vector3(), weight: 0 });
          own.position.copy(t.position);
          own.quaternion = t.quaternion?.clone();
          own.weight = t.weight;
        },
      });
    } finally {
      delete h.status.intent[part];
    }
  };
}
