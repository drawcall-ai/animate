// The old engine's planning of the pelvis over its feet: how high the legs let it, and the stride's cycle off its steps.
import { Vector3 } from 'three';
import { clamp, forwardOf, lerp, minimumJerk, smoothstep } from '../../core/math';
import type { Side } from '../bones';
import type { Carriage, Stepping } from './carriage';
import { ankleFor, MAX_HEEL } from '../posture/foot';
import { entrain, plantedReach, type Cycle, type Posture, type Upright } from '../posture/posture';

/**
 * a landing foot holds the pelvis down from this far through its swing on, fully by this far, and
 * by this much less before (× height); a foot just lifted still holds it, less and less, this far through its swing
 */
const LANDING = { from: 0.1, to: 0.75, relax: 0.025 };
const LIFTED = 0.25;
/** Tuned heel-rise forecast onset (rad); follows the actual roll softly beyond it. */
const HEEL_SOFT = 0.75;
/** the shortest an arm takes to swing from back to front (s), walking and running: the stride's phase runs no faster */
const ARM_PERIOD = { walk: 0.5, run: 0.3 };

export interface Supported extends Upright {
  bent: number;
  velocity: Vector3;
  steps: readonly { side: Side; plantedTime: number; landPitch: number; roll: readonly number[];
    swing: Pick<NonNullable<Stepping['swing']>, 'from' | 'fromYaw' | 'duration' | 'progress' | 'strike'> | null }[];
  hip(side: Side, out: Vector3): Vector3;
}

type CycleSource = Pick<Carriage, 'run' | 'clock' | 'lastLift' | 'lastLiftAt' | 'steps' | 'timing'>;

/** The old controller's cycle, preserving its lift entrainment and swing-shaped bob: `posture`'s stride phase entrained to its lifts. */
export function cycleOf(posture: Posture, c: CycleSource, dt: number): Cycle {
  let bob = 0, nod = 1, compression = 0;
  for (const s of c.steps) {
    if (!s.swing) continue;
    bob = Math.sin(Math.PI * s.swing.progress);
    nod = Math.cos(2 * Math.PI * s.swing.progress);
  }
  const t = c.timing();
  if (c.run > 0) for (const s of c.steps) if (!s.swing) compression = Math.max(compression, Math.sin(Math.PI * clamp(s.plantedTime / t.stance, 0, 1)));
  const period = Math.max(c.timing().step, lerp(ARM_PERIOD.walk, ARM_PERIOD.run, c.run));
  const lifted = (c.lastLift === 0 ? 0 : Math.PI) + (Math.PI * (c.clock - c.lastLiftAt)) / period;
  posture.phase = entrain(posture.phase, lifted, Math.PI / period, dt);
  return { phase: posture.phase, bob, nod, compression };
}

/**
 * Planning bound before pelvis following/rotation; legs.pelvisHeight enforces the final geometry.
 * The highest the pelvis may be (over its ground point) with every foot still in its
 * leg's reach: a planted foot (a trailing one up on its ball, and every one as far as `tiptoe` asks
 * it up, 0 … 1; and not below `floor`), a landing one
 * in the late swing (fading in, against the hip as it will be on landing).
 */
export function reachLimit(c: Supported, floor: number, tiptoe: number): number {
  const p = c.p;
  const fwd = forwardOf(c.yaw, _f);
  let limit = Infinity;
  c.steps.forEach((st, s) => {
    const foot = c.feet[s];
    const hip = c.hip(st.side, _hip);
    const below = c.pelvis.y - hip.y;
    const planted = (at: Vector3, yaw: number, landed: number, strike: number) => {
      // (fading from the landing's: a trailing foot's heel rises, a landed one rolls flat)
      const behind = -((at.x - hip.x) * fwd.x + (at.z - hip.z) * fwd.z);
      const extra = Math.max(0, -HEEL_SOFT - st.roll[1]);
      const raised = -HEEL_SOFT - extra * minimumJerk(extra / (MAX_HEEL - HEEL_SOFT));
      const heel = lerp(strike * (1 - smoothstep(0, 0.15, landed)), raised, Math.max(tiptoe, smoothstep(0, 0.1, behind)));
      const reach = plantedReach(c.bent, landed) * p.legLength;
      const top = highest(hip, ankleFor(p, st.side, at, yaw, heel, _ankle), reach) + below;
      return lerp(top, Math.max(top, floor), smoothstep(0.05, 0.15, behind));
    };
    const w = st.swing;
    if (!w) {
      limit = Math.min(limit, planted(foot.position, foot.yaw, st.plantedTime, st.landPitch));
      return;
    }
    // (a foot just lifted lets the pelvis go gradually; a runner's at once)
    if (w.progress < LIFTED * (1 - c.run)) limit = Math.min(limit, planted(w.from, w.fromYaw, Infinity, st.landPitch) + LANDING.relax * p.height * smoothstep(0, LIFTED, w.progress));
    if (w.progress < LANDING.from) return;
    // (as it will hold the pelvis once landed: against the hip as it will be then)
    hip.addScaledVector(c.velocity, (1 - w.progress) * w.duration);
    limit = Math.min(limit, planted(foot.position, foot.yaw, 0, w.strike) + LANDING.relax * p.height * (1 - smoothstep(LANDING.from, LANDING.to, w.progress)));
  });
  return limit;
}

/** the highest the hip joint (at `hip`'s x, z) can be with the leg (`reach` long) still reaching `ankle` */
function highest(hip: Readonly<Vector3>, ankle: Vector3, reach: number): number {
  const h2 = reach * reach - ((hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2);
  return ankle.y + Math.sqrt(Math.max(1e-4, h2));
}

const _f = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
