import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/simulation';

const id = process.env.SC ?? 'look-around';
const [t0, t1] = (process.env.T ?? '6.1,6.5').split(',').map(Number);
it('comtarget', () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const h = sim.actors[0] as any;
  while (sim.t < t1) {
    sim.step();
    if (sim.t < t0) continue;
    const m = h.body.merged;
    const ts = m.targets.filter((t: any) => t.target.point === 'com').map((t: any) => `${t.target.owner}:${t.weight.toFixed(2)}@${t.target.value.toArray().map((x: number) => x.toFixed(3))}`);
    const s = h.state;
    console.log(`${sim.t.toFixed(3)} com ${s.com.toArray().map((x: number) => x.toFixed(3))} v ${s.comVelocity.toArray().map((x: number) => x.toFixed(2))} feet ${h.feet.map((f: any) => f.phase + '@' + f.position.x.toFixed(2) + ',' + f.position.z.toFixed(2)).join(' ')} | ${ts.join(' ')}`);
  }
});
