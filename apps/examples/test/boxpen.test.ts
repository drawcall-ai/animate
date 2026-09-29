import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
// how deep does the carried box penetrate the body (trunk capsule pelvis→neck r=0.12, thighs hip→knee r=0.07)?
function segDist(p: Vector3, a: Vector3, b: Vector3) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
it('pen', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'pickup-shelf')!);
  const a: any = sim.actors[0];
  const worst: Record<string, [number, number]> = {};
  while (sim.t < 12) {
    sim.step();
    const box = sim.run.props().find((p) => p.kind === 'box')!;
    const p = a.pose;
    // sample box as points on a grid inside it (axis-aligned-ish by yaw)
    const half = box.size.clone().multiplyScalar(0.5);
    const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
    const parts: [string, Vector3, Vector3, number][] = [
      ['lowTrunk', p.pelvis, p.spine, 0.11], ['midTrunk', p.spine, p.chest, 0.11], ['upTrunk', p.chest, p.neck, 0.11], ['head', p.headCenter, p.headCenter, 0.1],
      ['lThigh', p.leftHip, p.leftKnee, 0.07], ['rThigh', p.rightHip, p.rightKnee, 0.07],
      ['lShin', p.leftKnee, p.leftAnkle, 0.05], ['rShin', p.rightKnee, p.rightAnkle, 0.05],
    ];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const lx = i * half.x, ly = j * half.y, lz = k * half.z;
      const q = new Vector3(box.position.x + lx * c + lz * s, box.position.y + ly, box.position.z - lx * s + lz * c);
      for (const [name, a0, b0, r] of parts) {
        const pen = r - segDist(q, a0, b0);
        if (pen > 0 && pen > (worst[name]?.[0] ?? 0)) worst[name] = [pen, sim.t];
      }
    }
  }
  console.log(Object.entries(worst).map(([k, [v, t]]) => `${k}: ${(v * 100).toFixed(1)}cm @${t.toFixed(2)}s`).join('  ') || 'no penetration');
});
