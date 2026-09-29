// Temporal quality: jitter (acceleration reversals / jerk), speed, tiny steps.
import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation, FIXED_DT } from '../src/scenario';

const JOINTS = ['headCenter', 'nose', 'neck', 'pelvis', 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] as const;

for (const sc of SCENARIOS.filter((s) => !process.env.SC || s.id === process.env.SC)) {
  it(sc.id, () => {
    const sim = new Simulation(sc);
    const hist: Record<string, Vector3[]> = {};
    for (const j of JOINTS) hist[j] = [];
    let tiny = 0, steps = 0;
    const lastPhase = ['planted', 'planted'];
    const lift = [new Vector3(), new Vector3()];
    const tinyAt: string[] = [];
    while (sim.t < sc.duration) {
      sim.step();
      const a: any = sim.actors[0];
      for (const j of JOINTS) hist[j].push(a.pose[j].clone());
      a.gait.feet.forEach((f: any, s: number) => {
        if (f.phase === 'swing' && lastPhase[s] !== 'swing') lift[s].copy(f.anchor);
        if (f.phase === 'planted' && lastPhase[s] === 'swing') {
          steps++;
          const len = f.anchor.distanceTo(lift[s]);
          if (len < 0.1) { tiny++; tinyAt.push(sim.t.toFixed(2)); }
        }
        lastPhase[s] = f.phase;
      });
    }
    const out: string[] = [];
    let worst = '';
    let worstRev = 0;
    for (const j of JOINTS) {
      const p = hist[j];
      let vmax = 0, vmaxAt = 0, rev = 0, jerkSum = 0, n = 0;
      const acc: Vector3[] = [];
      for (let i = 1; i < p.length - 1; i++) {
        const v = p[i + 1].clone().sub(p[i - 1]).divideScalar(2 * FIXED_DT);
        if (v.length() > vmax) { vmax = v.length(); vmaxAt = i * FIXED_DT; }
        acc.push(p[i + 1].clone().sub(p[i].clone().multiplyScalar(2)).add(p[i - 1]).divideScalar(FIXED_DT * FIXED_DT));
      }
      for (let i = 1; i < acc.length; i++) {
        const a0 = acc[i - 1], a1 = acc[i];
        const jerk = a1.clone().sub(a0).length() / FIXED_DT;
        jerkSum += jerk * jerk; n++;
        // jitter: acceleration flipping direction frame to frame while significant
        if (a0.length() > 2 && a1.length() > 2 && a0.dot(a1) < -0.5 * a0.length() * a1.length()) rev++;
      }
      // visible jitter: deviation from a 5-frame local average (mm)
      let hfMax = 0, hfSum = 0, hfMaxAt = 0;
      for (let i = 2; i < p.length - 2; i++) {
        const avg = p[i - 2].clone().add(p[i - 1]).add(p[i]).add(p[i + 1]).add(p[i + 2]).divideScalar(5);
        const dev = p[i].distanceTo(avg) * 1000;
        hfSum += dev * dev;
        if (dev > hfMax) { hfMax = dev; hfMaxAt = i * FIXED_DT; }
      }
      const hfRms = Math.sqrt(hfSum / (p.length - 4));
      const revPerS = rev / sc.duration;
      if (revPerS > worstRev) { worstRev = revPerS; worst = j; }
      out.push(`${j}: vmax ${vmax.toFixed(2)}@${vmaxAt.toFixed(1)} jitter ${revPerS.toFixed(1)}/s jerkRMS ${Math.sqrt(jerkSum / n).toFixed(0)} hf ${hfRms.toFixed(2)}mm (max ${hfMax.toFixed(1)}@${hfMaxAt.toFixed(1)})`);
    }
    console.log(`== ${sc.id}: steps ${steps}, tiny(<10cm) ${tiny} [${tinyAt.join(' ')}], worst jitter ${worst} ${worstRev.toFixed(1)}/s\n  ` + out.join('\n  '));
  });
}
