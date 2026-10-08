import { it } from 'vitest';
import { zzLog, zzLogD } from '@prohuman/core';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
const [id, t0, t1, bone] = (process.env.ZZ ?? '').split(',');
it(id, () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const out: string[] = [];
  while (sim.t < Number(t1)) {
    zzLog.length = 0; zzLogD.length = 0;
    sim.step();
    if (sim.t >= Number(t0)) out.push(sim.t.toFixed(2) + ' ' + zzLog.filter((l) => l.startsWith(bone)).join(' | ') + ' ' + zzLogD.join(' '));
  }
  console.log(out.join('\n'));
});
