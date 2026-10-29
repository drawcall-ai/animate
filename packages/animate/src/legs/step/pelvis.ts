// The pelvis placed as high as the feet hold it.
import { follow } from '../../kernel/follow';
import { Vector3 } from 'three';
import { lerp, minimumJerk, smoothstep, softMin } from '../../kernel/math';
import { LOWEST, _v, type Now, type Steps } from './state';
import { foldOf, nominal, reach } from './reach';
import { swingPose } from './swing';
import { stepping } from './way';

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
  // (stepping down, the pelvis is let down through the swing to where the leg reaches its landing from, as the stance knee lowers it over
  // single support — recalled: McFadyen & Winter 1988, stair descent's "controlled lowering"; read: Protopapadaki 2007, ~90° of stance
  // knee flexion to descend — not dropped onto the landing late in the swing as the foot comes down to it)
  if (!airborne) legs.forEach((leg) => {
    const w = leg.swing;
    const down = w ? stepping(steps, leg, w).down : 0;
    if (!w || down === 0) return;
    // (from where in the swing its landing first stood lower: a landing moved on over a tread's edge mid-swing lowers it from there)
    if (Number.isNaN(w.lowering)) w.lowering = w.u;
    const landing = steps.feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _landing).addScaledVector(now.r.velocity, -(1 - w.u) * w.T);
    const most = reach(steps, now, leg, landing);
    if (y > most) y = lerp(y, most, smoothstep(w.lowering, 1, w.u) * down);
  });
  // (let down at once as the feet need, up again within `RISE`: a foot let go of does not pop the pelvis up)
  // (the root's own rise and fall are followed at once)
  // (no further than `LOWEST` below standing over the lowest floor a foot stands or lands on: down a stair, as far as the leg reaching
  // for the tread below needs)
  const lowest = Math.min(...legs.map((leg) => leg.anchor.y - steps.feet.ankleHeight));
  const want = Math.max(y - rise, standing - Math.max(0, now.ground - lowest) - LOWEST * s);
  // (let down no further than the feet need: a quick drop is not carried on past it — the soldier's pelvis sank 3 cm more than its trailing
  // leg asked, a 6 cm bob a stride)
  const base = airborne ? flying : Math.max(Math.min(want, lifted(want)), Math.min(want, heights[1] - crouched), foldOf(steps, now) - rise);
  [heights[0], heights[1]] = [heights[1], base + crouched];
  f.current.setRoot(_v.copy(steps.pelvis).setY(base + rise));
}

/** Tuned: the pelvis takes its height up again within `RISE` (m/s²) */
const RISE = { accel: 20 };

const _landing = new Vector3();
