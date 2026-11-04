import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { it } from 'vitest';
import { createSkeletonModel, Humanoid, humanoid, reach, type Ctx } from '../../src';

it('unreachable reach', () => {
  const far = { position: new Vector3(0, 1.2, 2.5), weight: 1 };
  const h = new Humanoid(createSkeletonModel(), (h) => function* () { yield* parallel<Ctx>('all', humanoid(h), reach(h, 'right', () => far)); });
  let most = 0; let steps = 0; let prev = 'planted,planted';
  for (let i = 0; i < 240; i++) {
    h.update(1 / 60);
    const s = h.state;
    const feet = h.feet.map((f) => f.position);
    const mid = feet[0].clone().add(feet[1]).multiplyScalar(0.5);
    const xcom = s.com.clone().addScaledVector(s.comVelocity, 1 / Math.sqrt(9.81 / 0.9));
    most = Math.max(most, xcom.z - mid.z);
    const ph = h.feet.map((f) => f.phase).join(',');
    if (ph !== prev && ph !== 'planted,planted') steps++;
    prev = ph;
  }
  console.log(`BW ${process.env.BW} xcom ahead of feet most ${most.toFixed(3)} steps ${steps} com z ${h.state.com.z.toFixed(3)}`);
});
