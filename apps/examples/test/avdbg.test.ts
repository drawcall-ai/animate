import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
function seg(p: Vector3, a: Vector3, b: Vector3) { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); }
it('av', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'pickup-shelf')!);
  const a: any = sim.actors[0];
  sim.advanceTo(6.3);
  for (let i = 0; i < 40; i++) {
    sim.step();
    if (i % 4) continue;
    const box = sim.run.props().find((q: any) => q.kind === 'box')!.position;
    const p = a.pose;
    const d = Math.min(seg(box, p.pelvis, p.spine), seg(box, p.spine, p.chest), seg(box, p.chest, p.neck));
    const pRaw = a.raw.slice(); const solver = a.solver;
    console.log(`t=${sim.t.toFixed(2)} box y=${box.y.toFixed(2)} trunkDist=${d.toFixed(3)} (need ≥ ${(0.14 + 0.065 * 1.75).toFixed(3)}) headDist=${box.distanceTo(p.headCenter).toFixed(3)} raw hip=${a.raw[5].toFixed(2)} cur hip=${a.cur[5].toFixed(2)} raw shift=${a.raw[4].toFixed(2)} cur shift=${a.cur[4].toFixed(2)} pelY=${p.pelvis.y.toFixed(2)}`);
  }
});
