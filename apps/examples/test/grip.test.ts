import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('grip', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'pickup-shelf')!);
  const a: any = sim.actors[0];
  let prev: Vector3 | null = null;
  let maxBoxSpeed = 0, speedAt = 0, maxGrip = 0, gripAt = 0, maxAcc = 0, accAt = 0;
  let prevV = 0;
  while (sim.t < 12) {
    sim.step();
    const box = sim.run.props().find((q) => q.kind === 'box')!.position.clone();
    if (prev) {
      const v = box.distanceTo(prev) * 60;
      if (v > maxBoxSpeed) { maxBoxSpeed = v; speedAt = sim.t; }
      const acc = Math.abs(v - prevV) * 60;
      if (sim.t > 3.5 && acc > maxAcc) { maxAcc = acc; accAt = sim.t; }
      prevV = v;
    }
    prev = box;
    const inp = sim.lastInputs[0];
    for (const s of ['left', 'right'] as const) {
      const e = inp[`${s}Hand`];
      if (e?.position && (e.weight ?? 1) > 0.99 && sim.t > 4.5) {
        const d = a.pose[`${s}Wrist`].distanceTo(e.position as Vector3);
        if (d > maxGrip) { maxGrip = d; gripAt = sim.t; }
      }
    }
  }
  console.log(`box max speed ${maxBoxSpeed.toFixed(2)} m/s @${speedAt.toFixed(2)}; max box accel jump ${maxAcc.toFixed(1)} m/s² @${accAt.toFixed(2)}; max hand-off-box ${(maxGrip * 100).toFixed(1)} cm @${gripAt.toFixed(2)}`);
});
