import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('debug', () => {
  const sc = SCENARIOS.find((s) => s.id === (process.env.SC ?? 'stroll'))!;
  const sim = new Simulation(sc);
  const a = sim.actors[0];
  const out: string[] = [];
  const from = Number(process.env.FROM ?? 0), to = Number(process.env.TO ?? 99), every = Number(process.env.EVERY ?? 6);
  let i = 0;
  while (sim.t < Math.min(to, sc.duration)) {
    sim.step();
    if (sim.t < from || i++ % every) continue;
    const g = a.gait;
    const cur = (a as any).cur as Float64Array;
    const plan = (a as any).plan as Float64Array;
    const f = g.feet.map((f) => `${f.phase[0]}(${f.anchor.x.toFixed(2)},${f.anchor.z.toFixed(2)} p${f.pitch.toFixed(2)})`).join(' ');
    out.push(`t=${sim.t.toFixed(2)} root=${g.root.x.toFixed(2)},${g.root.z.toFixed(2)} yaw=${g.root.yaw.toFixed(2)} v=${g.speed.toFixed(2)} walk=${g.walk.toFixed(2)} plan=${plan[0].toFixed(2)},${plan[1].toFixed(2)},${plan[2].toFixed(2)} pel=${a.pose.pelvis.y.toFixed(3)} drop=${cur[3].toFixed(3)} shift=${cur[4].toFixed(2)} hip=${cur[5].toFixed(2)} sp=${cur[6].toFixed(2)} tw=${cur[8].toFixed(2)} ${f}`);
  }
  console.log(out.join('\n'));
});
