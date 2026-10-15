import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, type Frame } from '../../src/core/body';
import { Legs } from '../../src/core/legs/legs';
import { boundSwing, quintic, type Swing } from '../../src/core/legs/swing';
import { HORSE_WALK, horseLegs } from '../../src/core/legs/data/horse';
import { SKELETON } from '../../src/core/legs/data/horse-skeleton';
import { Pose } from '../../src/core/pose';

it('a short swing with an outward lift-off derivative stays inside ROM and lands at rest', () => {
  for (const T of [0.08, 0.2, 0.6]) {
    for (const velocity of [-40, 40]) {
      const s: Swing = {
        x: new Float64Array([0.99]), v: new Float64Array([velocity]), a: new Float64Array([velocity * 100]),
        land: new Float64Array([-0.9]), stepping: 1, scale: 1, toes: new Quaternion(),
      };
      boundSwing(s, 0, T, -1, 1);
      for (let k = 0; k <= 200; k++) {
        const [q] = quintic(s.x[0], s.v[0], s.a[0], s.land[0], T, T * k / 200);
        expect(q).toBeGreaterThanOrEqual(-1 - 1e-12);
        expect(q).toBeLessThanOrEqual(1 + 1e-12);
      }
      expect(quintic(s.x[0], s.v[0], s.a[0], s.land[0], T, T)).toEqual([-0.9, 0, 0]);
    }
  }
});

it('leg contact checks read the final pose after a later writer, and disappear with dev off', () => {
  const run = (dev: boolean) => {
    const pose = new Pose(SKELETON);
    const engine = new Legs(pose, horseLegs(), HORSE_WALK);
    const root = { position: pose.position(0).clone(), quaternion: new Quaternion() };
    const terminal = engine.limbs[0].terminal;
    const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
      engine.update(f, { root: () => root, speed: 0 });
      if (f.time > 0.05) {
        f.current.setLocal(terminal, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3));
        f.current.setRoot(root.position.clone().add(new Vector3(0.01, -0.01, 0)));
      }
    } }), { pose, dev });
    for (let k = 0; k < 10; k++) body.update(1 / 60);
    return body.log;
  };
  const checks = run(true).map((entry) => entry.check);
  expect(checks).toContain('leg contact (m)');
  expect(checks).toContain('leg contact turn (rad)');
  expect(checks).toContain('leg ground (m)');
  expect(run(false)).toEqual([]);
});
