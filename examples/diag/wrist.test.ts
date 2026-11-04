import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/simulation';
import { handOf } from '../src/joints';
import { Quaternion, Vector3 } from 'three';

const id = process.env.SC ?? 'walk-tray';
const [t0, t1] = (process.env.T ?? '10.3,10.8').split(',').map(Number);
it('wrist', () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const h = sim.actors[0] as any;
  while (sim.t < t1) {
    sim.step();
    if (sim.t < t0) continue;
    const inp = sim.inputs()[0];
    const errs = (['left', 'right'] as const).map((s) => { const t = inp[`${s}Hand`]; return t ? handOf(h, s, new Vector3(), new Quaternion()).position.distanceTo(t.position) : 0; });
    const s = h.state;
    console.log(`${sim.t.toFixed(3)} wrist ${errs.map((e) => e.toFixed(3))} com ${s.com.toArray().map((x: number) => x.toFixed(3))} v ${s.comVelocity.toArray().map((x: number) => x.toFixed(2))} feet ${h.feet.map((f: any) => f.phase).join(',')}`);
  }
});
