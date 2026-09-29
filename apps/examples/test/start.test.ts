import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('start', () => {
  for (const id of (process.env.SCS ?? 'stroll,walk-tray').split(',')) {
    const sim = new Simulation(SCENARIOS.find((s) => s.id === id)!);
    const a: any = sim.actors[0];
    const z0 = a.pose.pelvis.z, x0 = a.pose.pelvis.x;
    let firstLift = -1, moved5 = -1;
    while (sim.t < 4) {
      sim.step();
      const d = Math.hypot(a.pose.pelvis.z - z0, a.pose.pelvis.x - x0);
      if (moved5 < 0 && d > 0.05) moved5 = sim.t;
      if (firstLift < 0 && a.gait.feet.some((f: any) => f.phase === 'swing')) {
        firstLift = sim.t;
        const mz = (a.gait.feet[0].anchor.z + a.gait.feet[1].anchor.z) / 2, mx = (a.gait.feet[0].anchor.x + a.gait.feet[1].anchor.x) / 2;
        (a as any)._ahead = Math.hypot(a.pose.pelvis.z - mz, a.pose.pelvis.x - mx);
      }
    }
    console.log(`${id}: pelvis moved 5 cm at ${moved5.toFixed(2)}s, first foot lifted at ${firstLift.toFixed(2)}s, pelvis ahead of feet then ${((a as any)._ahead * 100).toFixed(1)} cm`);
  }
});
