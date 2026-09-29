import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('res', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'pickup-shelf')!);
  const a: any = sim.actors[0];
  sim.advanceTo(6.62);
  const solver: any = a.solver;
  const g = a.gait;
  solver.env = { mode: 'posture', root: g.root, support: [g.feet[0].anchor, g.feet[1].anchor], footholds: [g.feet[0].anchor, g.feet[1].anchor], moving: g.walk, tasks: a.tasks, stance: a.stance, overlay: a.overlay };
  const r = new Float64Array(96);
  const show = (label: string, p: Float64Array) => {
    const n = solver.residuals(p, r);
    const big = Array.from(r.slice(0, n)).map((x, i) => [i, x] as [number, number]).filter(([, x]) => Math.abs(x) > 0.3).map(([i, x]) => `${i}:${x.toFixed(2)}`);
    console.log(label, 'cost', Array.from(r.slice(0, n)).reduce((s, x) => s + x * x, 0).toFixed(2), 'n', n, big.join(' '));
  };
  console.log('avoid tasks', a.tasks.avoid.length, 'cur', Array.from(a.cur).map((x: number) => x.toFixed(2)).join(' '), 'raw', Array.from(a.raw).map((x: number) => x.toFixed(2)).join(' '));
  show('raw', Float64Array.from(a.raw));
  show('cur', Float64Array.from(a.cur));
});
