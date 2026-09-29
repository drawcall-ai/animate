import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('run', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'run')!);
  const a: any = sim.actors[0];
  let flight = 0, n = 0, lastPrint = -1;
  while (sim.t < 15) {
    sim.step();
    const g = a.gait;
    if (g.run > 0.9) { n++; if (g.feet.every((f: any) => f.phase !== 'planted')) flight++; }
    const sec = Math.floor(sim.t);
    if (sec !== lastPrint) {
      lastPrint = sec;
      const t = g.timing();
      console.log(`t=${sim.t.toFixed(1)} v=${g.speed.toFixed(2)} run=${g.run.toFixed(2)} stance=${t.stance.toFixed(2)} swing=${t.swing.toFixed(2)} pelY=${a.pose.pelvis.y.toFixed(2)} feet=${g.feet.map((f: any) => f.phase[0]).join('')}`);
    }
  }
  console.log(`flight fraction while running: ${(flight / Math.max(1, n)).toFixed(2)}`);
});
