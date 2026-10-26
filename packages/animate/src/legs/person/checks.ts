// A person's balance read off its final poses, whichever legs carry it.
import { Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Dev } from '../../kernel/dev';
import { SIDES } from '../../species/humanoid/bones';
import type { PersonLegged } from './legged';
import { solePoints } from '../../species/humanoid/landmarks';
import { footprint } from './foot';
import { hullOf, outside, xcomOf } from '../support';

/** XCoM from the final pose; the support includes a swing's committed landing (Hof's next-step capture). */
export function checkSupport(h: PersonLegged, f: Frame, dev: Dev): void {
  if (f.time <= f.dt) return;
  const com = f.prev.com(new Vector3());
  const velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = xcomOf(com, velocity, h.proportions.legLength, new Vector3());
  const legs = h.stepper?.legs ?? [];
  const support = legs.flatMap((leg, s) => {
    if (leg.swing) return footprint(h.proportions, leg.anchor, leg.yaw);
    const side = SIDES[s];
    return solePoints(h.proportions, f.prev, side).map((at): [number, number] => [at.x, at.z]);
  });
  const hull = hullOf(support);
  if (h.locomotion.settled && legs.every((leg) => !leg.swing) && Math.hypot(velocity.x, velocity.z) < 0.05) {
    const value = outside(hull, com);
    if (value > 0.001) dev.append(f.time - f.dt, { check: 'standing CoM outside the feet (m)', value, limit: 0.001, where: 'hips' });
  }
  const value = outside(hull, xcom);
  if (value > 0.1) dev.append(f.time - f.dt, { check: 'XCoM outside support (m)', value, limit: 0.1, where: 'hips' });
}
