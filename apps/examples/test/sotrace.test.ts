import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('sotrace', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === (process.env.SC ?? 'step-over'))!);
  const a: any = sim.actors[0];
  const [t0, t1, every] = (process.env.T ?? '4.6,6.4,3').split(',').map(Number);
  while (sim.t < t1) {
    sim.step();
    if (sim.t < t0 || Math.round(sim.t * 60) % every) continue;
    const g = a.gait, P = a.pose;
    const f = (i: number) => { const x = g.feet[i]; const k = i ? 'right' : 'left'; return `${'LR'[i]}${x.phase[0]} s${x.s.toFixed(2)} anc${x.anchor.z.toFixed(2)}${x.phase === 'swing' ? '>' + x.to.z.toFixed(2) + ' clr' + x.clear.toFixed(2) : ''} ank(${x.ankle.z.toFixed(2)},${x.ankle.y.toFixed(2)}) ik(${P[k + 'Ankle'].z.toFixed(2)},${P[k + 'Ankle'].y.toFixed(2)}) pt${x.pitch.toFixed(2)}`; };
    console.log(sim.t.toFixed(2), `root ${g.root.z.toFixed(2)} v${g.speed.toFixed(2)} pel ${P.pelvis.z.toFixed(2)},${P.pelvis.y.toFixed(2)} | ${f(0)} | ${f(1)}`);
  }
});
