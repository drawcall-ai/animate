import { Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { Dev } from '../../core/dev';
import { GRAVITY } from '../../core/math';
import { INDEX, SIDES } from '../bones';
import type { Stepping } from './carriage';
import type { Humanoid } from '../humanoid';
import { solePoints } from '../landmarks';
import { ballOf, footRotation, heelOf, footprint } from './foot';
import { hullOf, outside } from './support';

/** XCoM from the final pose; the support includes a swing's committed landing (Hof's next-step capture). */
export function checkSupport<W>(h: Humanoid<W>, f: Frame<W>, dev: Dev): void {
  if (f.time <= f.dt) return;
  const com = f.prev.com(new Vector3());
  const velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = com.clone().addScaledVector(velocity, 1 / Math.sqrt(GRAVITY / h.proportions.legLength));
  const support = h.feet.flatMap((foot, s) => {
    if (foot.phase === 'swing') return footprint(h.proportions, foot.position, foot.yaw);
    const side = SIDES[s];
    return solePoints(h, f.prev, side).map((at): [number, number] => [at.x, at.z]);
  });
  const hull = hullOf(support);
  if (h.gait.settled && h.feet.every((foot) => foot.phase === 'planted') && Math.hypot(velocity.x, velocity.z) < 0.05) {
    const value = outside(hull, com);
    if (value > 0.001) dev.append(f.time - f.dt, { check: 'standing CoM outside the feet (m)', value, limit: 0.001, where: 'hips' });
  }
  const value = outside(hull, xcom);
  if (value > 0.1) dev.append(f.time - f.dt, { check: 'XCoM outside support (m)', value, limit: 0.1, where: 'hips' });
}

/** Read the final planted foot, allowing its roll about the heel or ball, never the solve's goal. */
export function checkFeet<W>(h: Humanoid<W>, f: Frame<W>, dev: Dev, steps: readonly Pick<Stepping, 'plantedTime'>[]): void {
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
    if (steps[s].plantedTime === 0 && h.gait.run === 0) {
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
