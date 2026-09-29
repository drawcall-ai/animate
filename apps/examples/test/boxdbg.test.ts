import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('b', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'pickup-shelf')!);
  const a: any = sim.actors[0];
  sim.advanceTo(5.7);
  for (let i = 0; i < 90; i++) {
    sim.step();
    if (i % 6) continue;
    const g = a.gait, p = a.pose;
    const fx = Math.sin(g.root.yaw), fz = Math.cos(g.root.yaw);
    const F = (q: any) => ((q.x - g.root.x) * fx + (q.z - g.root.z) * fz).toFixed(2);
    const box = sim.run.props().find((q: any) => q.kind === 'box')!.position;
    const av = sim.lastInputs[0].avoid?.length ?? 0;
    console.log(`t=${sim.t.toFixed(2)} box fwd=${F(box)} y=${box.y.toFixed(2)} | pelvis fwd=${F(p.pelvis)} y=${p.pelvis.y.toFixed(2)} chest fwd=${F(p.chest)} y=${p.chest.y.toFixed(2)} knee fwd=${F(p.leftKnee)} y=${p.leftKnee.y.toFixed(2)} avoid=${av} hip=${a.cur[5].toFixed(2)} shift=${a.cur[4].toFixed(2)} drop=${a.cur[3].toFixed(2)} rawHip=${a.raw[5].toFixed(2)}`);
  }
});
