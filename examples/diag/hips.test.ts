import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/simulation';

const id = process.env.SC ?? 'look-around';
const [t0, t1] = (process.env.T ?? '10.6,11.2').split(',').map(Number);
it('hips', () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const h = sim.actors[0] as any;
  while (sim.t < t1) {
    sim.step();
    if (sim.t < t0) continue;
    const m = h.body.merged;
    const ts = m.targets.filter((t: any) => t.target.kind === 'position' && (t.target.point === 'com' || t.target.point.bone === 0)).map((t: any) => `${t.target.owner}:${t.target.point === 'com' ? 'com' : 'hips'}:${t.weight.toFixed(2)}@${t.target.value.toArray().map((x: number) => x.toFixed(3))}`);
    const cs = m.contacts.map((c: any) => `${c.owner}:${c.point === 'com' ? 'com' : c.point.bone}${c.support ? 's' : ''}`).join(' ');
    const s = h.state;
    console.log(`${sim.t.toFixed(3)} hips ${s.positions[0].toArray().map((x: number) => x.toFixed(3))} com ${s.com.toArray().map((x: number) => x.toFixed(3))} feet ${h.feet.map((f: any) => f.phase).join(',')} | ${ts.join(' ')} | ${cs}`);
  }
});
