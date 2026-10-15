import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SIDES } from '@drawcall/animate';
import { Simulation } from '../src/simulation';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, vary } from '../scripts/run';

for (const sc of SCENARIOS) {
  it(`${sc.id}: final-pose dev checks${sc.id === 'vr' ? ' (underHead completion known)' : ''}`, () => {
    const log = run(sc);
    expect(log.filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}

for (const sc of SCENARIOS.filter((sc) => ['reach', 'knight-arming', 'pickup-shelf'].includes(sc.id))) {
  it.each([1, 2, 3, 4])(`${sc.id}: variation #%s final-pose dev checks`, (seed) => {
    expect(run(vary(sc, seed))).toEqual([]);
  });
}


it('keeps airborne soles above the floor in every humanoid scene', () => {
  const out = new Vector3();
  for (const sc of SCENARIOS.filter((sc) => sc.actors.length > 0)) {
    const sim = new Simulation(sc);
    let lowest = 0;
    while (sim.t < sc.duration) {
      sim.step();
      for (const h of sim.actors) h.feet.forEach((foot, s) => {
        if (foot.phase !== 'swing') return;
        for (const name of ['Heel', 'BigToe', 'SmallToe'] as const) {
          const point = h.rig.points[`${SIDES[s]}${name}`];
          lowest = Math.min(lowest, h.pose.point(point.bone, point.at, out).y);
        }
      });
    }
    expect(lowest, sc.id).toBeGreaterThanOrEqual(-1e-6);
  }
});
