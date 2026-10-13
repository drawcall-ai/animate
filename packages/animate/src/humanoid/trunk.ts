import { Quaternion, Vector3 } from 'three';
import { action, type UntilCondition } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Carrier } from '../core/carrier';
import { follow, followRotation } from '../core/follow';
import { live, type Behaviour, type Live, type Motion, type Target, type Until } from '../core/goal';
import { clampRotation } from '../core/limits';
import { reached } from '../core/tip';
import { TrackedRotation } from '../core/track';
import { INDEX } from './bones';
import type { Humanoid } from './humanoid';

/** how the trunk turns unless asked otherwise (rad/s², rad/s): calmly */
const TRUNK = { turnAccel: 20, turnSpeed: 3 };

/**
 * The pelvis (the hips' origin and, given its rotation, the hips) to `target` (on a carrier, in its
 * frame), every sub-step, endless or until `until`, moved on from its history at `motion`'s pace
 * (a rotation needs `turnAccel`), the target's velocity and spin followed. It takes the root from
 * `balance` and both feet with it (`h.asks.taken`): the task that runs it owns everything below
 * and above — it places the feet (`footTo`), the trunk (`trunkTo`) and puts `lookAt` last.
 */
export function pelvisTo<W>(h: Humanoid<W>, target: Live<Target, W>, options: Motion & { on?: Carrier; until?: Until<W> }): Behaviour<W> {
  const { on, until, accel, speed, turnAccel, turnSpeed } = options;
  return function* () {
    yield* action<Frame<W>>({
      update: (f) => {
        const t = live(target, f);
        [h.asks.taken[0], h.asks.taken[1]] = [true, true];
        f.current.setRoot(follow(_c.copy(f.prev2.position(0)), _d.copy(f.prev.position(0)), t.position, { accel, speed, velocity: t.velocity, on }, f.dt, _p));
        if (!t.quaternion) return;
        if (turnAccel === undefined) throw new Error('pelvisTo: a target rotation needs a turnAccel');
        f.current.setLocal(0, followRotation(_a.copy(f.prev2.local(0)), _b.copy(f.prev.local(0)), t.quaternion, { accel: turnAccel, speed: turnSpeed, velocity: t.spin, on }, f.dt, _q));
      },
      until: until === 'reached' ? (f) => reached(f.prev2, f.prev, f.dt, 0, live(target, f), on) : until,
    });
  };
}

/**
 * The chest turned `chest` (world), every sub-step, endless or until `until`: the turn from the
 * pelvis split over the lower back and the thorax, half each, each within its range and turned on
 * from its history at `motion`'s pace (calm by default). For a task that owns the root
 * (`pelvisTo`): otherwise `balance` carries the trunk.
 */
export function trunkTo<W>(h: Humanoid<W>, chest: Live<Quaternion, W>, options: Partial<Pick<Motion, 'turnAccel' | 'turnSpeed'>> & { until?: UntilCondition<Frame<W>> } = {}): Behaviour<W> {
  const pace = { accel: options.turnAccel ?? TRUNK.turnAccel, speed: options.turnSpeed ?? TRUNK.turnSpeed };
  return function* () {
    const joints = [new TrackedRotation(), new TrackedRotation()];
    yield* action<Frame<W>>({
      update: (f) => {
        const pose = f.current;
        const turn = _rel.copy(pose.rotation(0)).invert().multiply(live(chest, f));
        const lumbar = limited(h, INDEX.spine, _l.identity().slerp(turn, 0.5));
        const thorax = limited(h, INDEX.chest, _t.copy(lumbar).invert().multiply(turn));
        [lumbar, thorax].forEach((goal, k) => {
          const bone = k === 0 ? INDEX.spine : INDEX.chest;
          pose.setLocal(bone, limited(h, bone, joints[k].follow(f.prev2.local(bone), f.prev.local(bone), goal, pace, f.dt, _q)));
        });
      },
      until: options.until,
    });
  };
}

/** `q` (bone `bone`'s rotation in its parent's frame) within its range */
function limited<W>(h: Humanoid<W>, bone: number, q: Quaternion): Quaternion {
  const limit = h.rig.skeleton.limits[bone];
  if (limit) clampRotation(q, limit);
  return q;
}

const _p = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const _a = new Quaternion();
const _b = new Quaternion();
const _rel = new Quaternion();
const _l = new Quaternion();
const _t = new Quaternion();
