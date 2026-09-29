import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
// feet never inside an obstacle; swing speeds stay human (no snapping); the body never
// leaves a stance foot out of reach (leg over-extension = "about to fall")
it('stepover', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === (process.env.SC ?? 'step-over'))!);
  const a: any = sim.actors[0];
  let worst = 0, at = 0, vUp = 0, vUpAt = 0, vH = 0, vHAt = 0, acc = 0, accAt = 0, over = 0, overAt = 0;
  const prev = [a.pose.leftAnkle.clone(), a.pose.rightAnkle.clone()];
  const pv = [0, 0].map(() => a.pose.leftAnkle.clone().set(0, 0, 0));
  const dt = 1 / 60;
  while (sim.t < 12) {
    sim.step();
    const os = sim.lastInputs[0]?.obstacles ?? [];
    for (const j of ['leftBigToe', 'leftHeel', 'leftAnkle', 'rightBigToe', 'rightHeel', 'rightAnkle'] as const) {
      const p = a.pose[j];
      for (const o of os) {
        if (p.x > o.minX && p.x < o.maxX && p.z > o.minZ && p.z < o.maxZ) {
          const pen = o.height! - p.y;
          if (pen > worst) { worst = pen; at = sim.t; }
        }
      }
    }
    ['leftAnkle', 'rightAnkle'].forEach((j, i) => {
      const p = a.pose[j];
      const v = p.clone().sub(prev[i]).divideScalar(dt);
      if (Math.abs(v.y) > vUp) { vUp = Math.abs(v.y); vUpAt = sim.t; }
      const h = Math.hypot(v.x, v.z);
      if (h > vH) { vH = h; vHAt = sim.t; }
      const ac = v.clone().sub(pv[i]).length() / dt;
      if (sim.t > 0.1 && ac > acc) { acc = ac; accAt = sim.t; }
      pv[i].copy(v);
      prev[i].copy(p);
      // IK ankle vs foot target: > 1 cm means the leg couldn't reach
      const d = p.distanceTo(a.gait.feet[i].ankle);
      if (d > over) { over = d; overAt = sim.t; }
    });
  }
  console.log(`inside ${(worst * 100).toFixed(1)}cm@${at.toFixed(2)} | ankle vy ${vUp.toFixed(2)}@${vUpAt.toFixed(2)} vh ${vH.toFixed(2)}@${vHAt.toFixed(2)} acc ${acc.toFixed(0)}@${accAt.toFixed(2)} | overreach ${(over * 100).toFixed(1)}cm@${overAt.toFixed(2)} | final z ${a.gait.root.z.toFixed(2)}`);
});
