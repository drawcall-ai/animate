// The pelvis placed as high as the feet hold it.
import { follow } from '../../kernel/follow';
import { minimumJerk, softMin } from '../../kernel/math';
import { LOWEST, _v, type Now, type Steps } from './state';
import { foldOf, nominal, reach } from './reach';
import { swingPose } from './swing';

/**
 * The swinging ankles on their paths, the pelvis as high as the feet let it (in the air: where the root has it). In the air the pelvis'
 * own height eases back up to the gait's, the root's rise on it; heights are kept as if standing up: the crouch's own smooth lowering
 * and raising is followed at once.
 */
export function placePelvis(steps: Steps, now: Now) {
  const { st, legs, heights } = steps, s = st.scale, { f, dt, rise, airborne, standing, crouch: k } = now;
  const crouched = st.crouch.depth * s * k;
  // (followed up toward `to` within `RISE`, braking as it comes: it arrives without a jolt, and a fall is turned back up within it too)
  const lifted = (to: number) => follow(heights[0], heights[1], to + crouched, RISE, dt) - crouched;
  const flying = lifted(nominal(steps, now) - rise);
  steps.poses = legs.map((leg) => leg.swing ? swingPose(steps, now, leg, leg.swing, flying) : null);
  let y = airborne ? flying + rise : nominal(steps, now);
  // (a swinging foot holds the pelvis down only late in its swing: before, its leg just swings straighter)
  steps.held = y;
  if (!airborne) legs.forEach((leg, i) => {
    const most = reach(steps, now, leg, steps.poses[i]?.ankle);
    y = softMin(y, most + (leg.swing ? LOWEST * s * (1 - minimumJerk((leg.swing.u - 0.5) / 0.3)) : 0), 0.004 * s);
    if (!leg.swing) steps.held = softMin(steps.held, most, 0.004 * s);
  });
  // (let down at once as the feet need, up again within `RISE`: a foot let go of does not pop the pelvis up)
  // (the root's own rise and fall are followed at once)
  const fold = foldOf(steps, now);
  const want = Math.max(y - rise, standing - LOWEST * s);
  // (let down no further than the feet need: a quick drop is not carried on past it — the soldier's pelvis sank 3 cm more than its trailing
  // leg asked, a 6 cm bob a stride)
  const base = airborne ? flying : Math.max(Math.min(want, lifted(want)), Math.min(want, heights[1] - crouched), fold - rise);
  [heights[0], heights[1]] = [heights[1], base + crouched];
  f.current.setRoot(_v.copy(steps.pelvis).setY(base + rise));
}

/** Tuned: the pelvis takes its height up again within `RISE` (m/s²) */
const RISE = { accel: 20 };
