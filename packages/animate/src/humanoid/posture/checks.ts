// A person's balance read off its final poses, whichever legs carry it.
import { Vector3 } from 'three';
import type { Frame } from '../../core/frame';
import type { Dev } from '../../core/dev';
import { SIDES } from '../bones';
import type { Person } from '../person';
import { solePoints } from '../landmarks';
import { footprint } from './foot';
import { hullOf, outside, xcomOf } from '../../core/legs/support';

/** XCoM from the final pose; the support includes a swing's committed landing (Hof's next-step capture). */
export function checkSupport(h: Person, f: Frame, dev: Dev): void {
  if (f.time <= f.dt) return;
  const com = f.prev.com(new Vector3());
  const velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = xcomOf(com, velocity, h.proportions.legLength, new Vector3());
  const support = h.feet.flatMap((foot, s) => {
    if (foot.phase === 'swing') return footprint(h.proportions, foot.position, foot.yaw);
    const side = SIDES[s];
    return solePoints(h, f.prev, side).map((at): [number, number] => [at.x, at.z]);
  });
  const hull = hullOf(support);
  if (h.locomotion.settled && h.feet.every((foot) => foot.phase === 'planted') && Math.hypot(velocity.x, velocity.z) < 0.05) {
    const value = outside(hull, com);
    if (value > 0.001) dev.append(f.time - f.dt, { check: 'standing CoM outside the feet (m)', value, limit: 0.001, where: 'hips' });
  }
  const value = outside(hull, xcom);
  if (value > 0.1) dev.append(f.time - f.dt, { check: 'XCoM outside support (m)', value, limit: 0.1, where: 'hips' });
}
