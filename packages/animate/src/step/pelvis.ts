// The pelvis placed as high as the feet hold it.
import { follow } from '../kernel/follow';
import { MathUtils, Vector3 } from 'three';
import { lerp, minimumJerk, softMin } from '../kernel/math';
import { LOWEST } from './thresholds';
import type { Stepper } from './stepper';
import { foldOf, hipOf, lengthOf, nominal, legReach, travelOf } from './leg-reach';
import { swingPose } from './swing';
import { RISE, stepping } from './swing-path';

/**
 * The swinging ankles on their paths, the pelvis as high as the feet let it (in the air: where the root has it). In the air the pelvis'
 * own height eases back up to the gait's, the root's rise on it; heights are kept as if standing up: the crouch's own smooth lowering
 * and raising is followed at once.
 */
export function placePelvis(stepper: Stepper) {
  const { st, legs, heights, input } = stepper, s = st.scale, { f, dt, rise, airborne, standing, crouch: k } = input;
  const crouched = st.crouch.depth * s * k;
  // (followed up toward `to` within `LIFT`, braking as it comes: it arrives without a jolt, and a fall is turned back up within it too)
  const lifted = (to: number) => follow(heights[0], heights[1], to + crouched, LIFT, dt) - crouched;
  const flying = input.flight
    ? lifted(input.r.position.y + nominal(stepper) - input.ground - rise)
    : lifted(nominal(stepper) - rise);
  stepper.poses = legs.map((leg) => leg.swing ? swingPose(stepper, leg, leg.swing, flying) : null);
  let y = airborne ? flying + rise : nominal(stepper), stance = Infinity, arriving = Infinity;
  // (a swinging foot holds the pelvis down late in its swing, before its reach becomes a contact constraint)
  stepper.held = y;
  if (!airborne) legs.forEach((leg, i) => {
    const most = legReach(stepper, leg, stepper.poses[i]?.ankle);
    y = softMin(y, most + (leg.swing ? LOWEST * s * (1 - minimumJerk((leg.swing.u - 0.5) / 0.3)) : 0), 0.004 * s);
    if (!leg.swing) {
      stance = Math.min(stance, most);
      stepper.held = softMin(stepper.held, most, 0.004 * s);
    }
  });
  // (stepping down, the pelvis is let down through the swing to where the leg reaches its landing from, as the stance knee lowers it over
  // single support — recalled: McFadyen & Winter 1988, stair descent's "controlled lowering"; read: Protopapadaki 2007, ~90° of stance
  // knee flexion to descend — not dropped onto the landing late in the swing as the foot comes down to it)
  if (!airborne) legs.forEach((leg) => {
    const w = leg.swing;
    const down = w ? stepping(stepper, leg, w).down : 0;
    if (!w || (!input.contact && down === 0)) return;
    // (from where in the swing its landing first stood lower: a landing moved on over a tread's edge mid-swing lowers it from there)
    if (Number.isNaN(w.lowering)) w.lowering = w.u;
    const remaining = (1 - w.u) * w.T;
    const travel = travelOf(input, remaining, _travel).sub(input.r.position);
    const landing = stepper.feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _landing).sub(travel);
    const most = legReach(stepper, leg, landing);
    if (y > most) y = lerp(y, most, MathUtils.smoothstep(w.u, w.lowering, 1) * down);
    if (input.contact) {
      const hip = hipOf(stepper, leg);
      if (Math.hypot(landing.x - hip.x, landing.z - hip.z) <= st.reach * lengthOf(stepper, leg)) {
        // Lower toward the next contact while the trailing foot clears its tread, not before it can leave.
        const descending = w.level - leg.anchor.y + stepper.feet.ankleHeight > RISE;
        const share = descending ? minimumJerk((w.u - w.lowering) / (1 - w.lowering)) : 1;
        arriving = Math.min(arriving, lerp(y, most - input.climb * remaining, share));
      }
    }
  });
  // (let down at once as the feet need, up again within `LIFT`: a foot let go of does not pop the pelvis up)
  // (the root's own rise and fall are followed at once)
  // (no further than `LOWEST` below standing over the lowest floor a foot stands or lands on: down a stair, as far as the leg reaching
  // for the tread below needs)
  const lowest = Math.min(...legs.map((leg) => leg.anchor.y - stepper.feet.ankleHeight));
  const want = Math.min(Math.max(y - rise, standing - Math.max(0, input.ground - lowest) - LOWEST * s), arriving - rise);
  // (let down no further than the feet need: a quick drop is not carried on past it — the soldier's pelvis sank 3 cm more than its trailing
  // leg asked, a 6 cm bob a stride)
  let base = flying;
  if (!airborne) {
    if (input.contact) {
      const followed = lifted(want);
      base = Math.max(Math.min(followed, stance - rise), foldOf(stepper) - rise);
      // A geometric contact correction moves the history too; it does not launch the pelvis on the next tick.
      heights[1] += base - followed;
    } else {
      base = Math.max(Math.min(want, lifted(want)), Math.min(want, heights[1] - crouched), foldOf(stepper) - rise);
    }
  }
  [heights[0], heights[1]] = [heights[1], base + crouched];
  f.current.setRoot(_v.copy(stepper.pelvis).setY(base + rise));
}

/** Tuned: the pelvis takes its height up again within `LIFT` (m/s²) */
const LIFT = { accel: 20 };

const _landing = new Vector3(), _travel = new Vector3();
const _v = new Vector3();
