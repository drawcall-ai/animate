import { it } from 'vitest';
import { Quaternion } from 'three';
import { beyondRange, zzParts, zzRaw, type BoneName } from '@prohuman/core';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';

const D = 180 / Math.PI;
const ids = (process.env.ZZ ?? '').split(',');
const JOINTS: BoneName[] = ['spine', 'chest', 'neck', 'head'];
for (const s of ['left', 'right'] as const) JOINTS.push(`${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`, `${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`);
for (const sc of SCENARIOS.filter((s) => ids.includes(s.id))) {
  it(sc.id, () => {
    const sim = new Simulation(sc);
    zzRaw.on = true; zzRaw.worst = {};
    const worst: Record<string, { v: number; t: number; p: number[] }> = {};
    const p = new Quaternion(), q = new Quaternion();
    while (sim.t < sc.duration) {
      zzRaw.t = sim.t;
      sim.step();
      const h = sim.actors[0];
      h.model.scene.updateMatrixWorld(true);
      for (const name of JOINTS) {
        const node = h.model.scene.getObjectByName(name)!;
        q.copy(node.parent!.getWorldQuaternion(p).invert().multiply(node.getWorldQuaternion(q)));
        const v = beyondRange(name, q) * D;
        if (v > (worst[name]?.v ?? 0.5)) worst[name] = { v, t: sim.t, p: zzParts().map((x) => Math.round(x * D)) };
      }
    }
    console.log(sc.id + ' raw\n' + Object.entries(zzRaw.worst).map(([n, w]) => `  ${n} +${w.v.toFixed(1)} @${w.t.toFixed(2)} s1 ${w.p[0]}/${w.p[3]} s2 ${w.p[1]}/${w.p[4]} tw ${w.p[2]}/${w.p[5]}`).join('\n'));
    console.log(sc.id + ' out\n' + Object.entries(worst).map(([n, w]) => `  ${n} +${w.v.toFixed(1)} @${w.t.toFixed(2)} s1 ${w.p[0]}/${w.p[3]} s2 ${w.p[1]}/${w.p[4]} tw ${w.p[2]}/${w.p[5]}`).join('\n'));
  });
}
