import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('res', () => {
  const sc = SCENARIOS.find((s) => s.id === (process.env.SC ?? 'vr'))!;
  const sim = new Simulation(sc);
  const a: any = sim.actors[Number(process.env.WHO ?? 0)];
  sim.advanceTo(Number(process.env.T ?? 6.6));
  const solver: any = a.solver;
  const env = { mode: 'posture', root: a.gait.root, support: [null, null], moving: a.gait.walk, tasks: a.tasks, stance: a.stance, overlay: a.overlay };
  solver.env = env;
  const r = new Float64Array(96);
  const show = (label: string, p: Float64Array) => {
    const n = solver.residuals(p, r);
    const parts = Array.from(r.slice(0, n)).map((x, i) => `${i}:${x.toFixed(2)}`).filter((s) => !s.endsWith(':0.00') && !s.endsWith(':-0.00'));
    console.log(label, 'cost', Array.from(r.slice(0, n)).reduce((s, x) => s + x * x, 0).toFixed(3), parts.join(' '));
  };
  const p = Float64Array.from(a.raw);
  console.log('params', Array.from(p).map((x) => x.toFixed(2)).join(' '), 'walk', a.gait.walk.toFixed(2));
  show('current', p);
  for (const [hip, sp] of [[0.3, 0.1], [0.6, 0.2], [0.0, 0.0]]) {
    const q = Float64Array.from(p);
    q[5] = hip; q[6] = sp;
    show(`hip=${hip} sp=${sp}`, q);
  }
});
