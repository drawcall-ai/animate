import { Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { Dev } from '../../core/dev';
import { GRAVITY } from '../../core/math';
import { INDEX, SIDES } from '../bones';
import type { Stepping } from './carriage';
import type { Humanoid } from '../humanoid';
import { solePoints } from '../landmarks';
import { ballOf, footRotation, heelOf, footprint } from '../posture/foot';
import { hullOf, outside } from '../../core/legs/support';


/** Read the final planted foot, allowing its roll about the heel or ball, never the solve's goal. */
export function checkFeet(h: Humanoid, f: Frame, dev: Dev, steps: readonly Pick<Stepping, 'plantedTime'>[]): void {
  if (f.time <= f.dt) return;
  SIDES.forEach((side, s) => {
    const foot = h.feet[s];
    if (foot.phase !== 'planted') {
      const sink = -Math.min(...solePoints(h, f.prev, side).map((point) => point.y));
      if (sink > 1e-6) dev.append(f.time - f.dt, { check: 'swing sole sink (m)', value: sink, limit: 1e-6, where: `${side}Foot` });
      return;
    }
    const bone = INDEX[`${side}Foot`];
    const q = f.prev.rotation(bone);
    const forward = new Vector3(0, 0, 1).applyQuaternion(q);
    const pitch = Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
    const slide = (pivot: Vector3) => {
      const actual = f.prev.point(bone, pivot, new Vector3());
      const anchor = pivot.clone().applyQuaternion(footRotation(foot.yaw, 0)).add(foot.position);
      return Math.hypot(actual.x - anchor.x, actual.z - anchor.z);
    };
    const heel = heelOf(h.proportions);
    // Walking heel strike only: running lands through a different, forefoot loading pattern.
    if (steps[s].plantedTime === 0 && h.locomotion.run === 0) {
      const vertical = Math.abs(f.prev.point(bone, heel, new Vector3()).y - f.prev2.point(bone, heel, new Vector3()).y) / f.dt;
      if (vertical > 0.1) dev.append(f.time - f.dt, { check: 'touchdown vertical speed (m/s)', value: vertical, limit: 0.1, where: `${side}Foot` });
      const was = new Vector3(0, 0, 1).applyQuaternion(f.prev2.rotation(bone));
      const turn = Math.abs(pitch - Math.atan2(was.y, Math.hypot(was.x, was.z))) * 180 / Math.PI;
      // Tuned 1.5°/tick ceiling for a visible slap; research-contact §1 gives no per-tick pitch limit.
      if (turn > 1.5) dev.append(f.time - f.dt, { check: 'touchdown pitch step (°)', value: turn, limit: 1.5, where: `${side}Foot` });
    }
    const ball = ballOf(h.proportions, side);
    const value = Math.abs(pitch) < 0.05 ? Math.max(slide(heel), slide(ball)) : slide(pitch > 0 ? heel : ball);
    if (value > 0.01) dev.append(f.time - f.dt, { check: 'planted foot slide (m)', value, limit: 0.01, where: `${side}Foot` });
    const sole = solePoints(h, f.prev, side).map((point) => point.y);
    const sink = foot.position.y - h.proportions.ankleHeight - Math.min(...sole);
    if (sink > 0.01) dev.append(f.time - f.dt, { check: 'planted foot sink (m)', value: sink, limit: 0.01, where: `${side}Foot` });
  });
}
