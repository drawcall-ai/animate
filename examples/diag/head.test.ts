import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/simulation';
import { eyesOf } from '../src/joints';

const id = process.env.SC ?? 'look-around';
const [t0, t1] = (process.env.T ?? '7,8.5').split(',').map(Number);
it('head', () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const h = sim.actors[0] as any;
  while (sim.t < t1) {
    sim.step();
    if (sim.t < t0) continue;
    const head = sim.inputs()[0].head;
    const e = head ? eyesOf(h).distanceTo(head.position) : 0;
    const s = h.state;
    console.log(`${sim.t.toFixed(3)} head err ${e.toFixed(3)} com ${s.com.toArray().map((x: number) => x.toFixed(3))} feet ${h.feet.map((f: any) => f.phase).join(',')}`);
  }
});
