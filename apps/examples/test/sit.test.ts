import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('sit', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'sit')!);
  const a: any = sim.actors[0];
  while (sim.t < 16) {
    sim.step();
    if (Math.round(sim.t * 60) % 15) continue;
    const c = a.cur, g = a.gait;
    console.log(sim.t.toFixed(2), `root ${g.root.x.toFixed(2)},${g.root.z.toFixed(2)} yaw ${g.root.yaw.toFixed(2)} sitU ${a.seatU.toFixed(2)} pel ${a.pose.pelvis.x.toFixed(2)},${a.pose.pelvis.y.toFixed(2)},${a.pose.pelvis.z.toFixed(2)} drop ${c[3].toFixed(2)} shift ${c[4].toFixed(2)} hip ${c[5].toFixed(2)} spine ${c[6].toFixed(2)} knees ${a.pose.leftKnee.y.toFixed(2)} feet ${g.feet.map((f: any) => f.phase[0]).join('')}`);
  }
});
