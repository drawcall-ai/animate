import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/simulation';

const id = process.env.SC ?? 'stroll';
const [t0, t1] = (process.env.T ?? '1.9,2.2').split(',').map(Number);
it('trace', () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const h = sim.actors[0] as any;
  while (sim.t < t1) {
    sim.step();
    if (sim.t < t0) continue;
    const s = h.state;
    const m = h.body.merged;
    const cs = m.contacts.map((c: any) => `${c.owner}:${c.point === 'com' ? 'com' : c.point.bone}${c.support ? 's' : ''}p${c.priority}${c.footprint ? 'F' : ''}`).join(' ');
    console.log(`${sim.t.toFixed(3)} com ${s.com.toArray().map((x: number) => x.toFixed(3))} v ${s.comVelocity.toArray().map((x: number) => x.toFixed(2))} feet ${h.feet.map((f: any) => f.phase).join(',')} | ${cs}`);
  }
});
