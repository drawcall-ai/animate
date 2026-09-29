import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('head', () => {
  const sc = SCENARIOS.find((s) => s.id === (process.env.SC ?? 'vr'))!;
  const sim = new Simulation(sc);
  const a = sim.actors[0];
  const out: string[] = [];
  let i = 0;
  while (sim.t < sc.duration) {
    sim.step();
    if (i++ % Number(process.env.EVERY ?? 12)) continue; if (sim.t < Number(process.env.FROM ?? 0) || sim.t > Number(process.env.TO ?? 99)) continue;
    const h = sim.lastInputs[0].head?.position as Vector3;
    const raw = (a as any).raw as Float64Array, cur = (a as any).cur as Float64Array;
    const e = h ? a.pose.headCenter.clone().sub(h) : new Vector3();
    out.push(`t=${sim.t.toFixed(2)} err=${e.length().toFixed(3)} (${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)}) tgt.y=${h?.y.toFixed(2)} drop raw/cur=${raw[3].toFixed(2)}/${cur[3].toFixed(2)} hip=${raw[5].toFixed(2)}/${cur[5].toFixed(2)} sp=${raw[6].toFixed(2)} shift=${raw[4].toFixed(2)} walk=${a.gait.walk.toFixed(2)} pelY=${a.pose.pelvis.y.toFixed(2)} feet=${a.gait.feet.map((f) => f.phase[0]).join('')}`);
  }
  console.log(out.join('\n'));
});
