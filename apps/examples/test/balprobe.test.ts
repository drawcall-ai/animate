import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
// where is the XCoM relative to the feet (body frame: fwd, left) in the worst moments
it('balprobe', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === (process.env.SC ?? 'sit'))!);
  const a: any = sim.actors[0];
  const [t0, t1] = (process.env.T ?? '2.4,4.6').split(',').map(Number);
  const w0 = Math.sqrt(9.81 / a.dims.legLength);
  let prev: Vector3 | null = null;
  while (sim.t < t1) {
    sim.step();
    const p = a.pose;
    const com = new Vector3().addScaledVector(p.headCenter, 0.081).addScaledVector(p.chest, 0.25).addScaledVector(p.spine, 0.25)
      .addScaledVector(p.leftShoulder.clone().lerp(p.leftWrist, 0.4), 0.05).addScaledVector(p.rightShoulder.clone().lerp(p.rightWrist, 0.4), 0.05)
      .addScaledVector(p.leftHip.clone().lerp(p.leftAnkle, 0.4), 0.161).addScaledVector(p.rightHip.clone().lerp(p.rightAnkle, 0.4), 0.161);
    const v = prev ? com.clone().sub(prev).multiplyScalar(60) : new Vector3();
    prev = com;
    if (sim.t < t0 || Math.round(sim.t * 60) % 4) continue;
    const x = com.clone().addScaledVector(v, 1 / w0);
    const g = a.gait;
    const fw = new Vector3(Math.sin(g.root.yaw), 0, Math.cos(g.root.yaw)), lf = new Vector3(fw.z, 0, -fw.x);
    const rel = (q: Vector3) => { const d = q.clone().sub(com); return `${d.dot(fw).toFixed(2)},${d.dot(lf).toFixed(2)}`; };
    const ft = g.feet.map((f: any, i: number) => `${'LR'[i]}${f.phase[0]}${f.phase === 'swing' ? f.s.toFixed(1) : '   '} [${rel(f.phase === 'swing' ? f.to : f.anchor)}]`).join(' ');
    console.log(sim.t.toFixed(2), `yaw ${g.root.yaw.toFixed(2)} v(${v.dot(fw).toFixed(2)},${v.dot(lf).toFixed(2)}) xcom[${rel(x)}] | ${ft}`);
  }
});
