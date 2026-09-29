import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('bv', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'pickup-shelf')!);
  const a: any = sim.actors[0];
  let prev: Vector3 | null = null;
  const out: string[] = [];
  let i = 0;
  while (sim.t < 11) {
    sim.step();
    const box = sim.run.props().find((q) => q.kind === 'box')!.position.clone();
    const v = prev ? box.distanceTo(prev) * 60 : 0;
    prev = box;
    const inp = sim.lastInputs[0].leftHand;
    const grip = inp?.position ? a.pose.leftWrist.distanceTo(inp.position as Vector3) : -1;
    if (i++ % 6 === 0 && sim.t > 4) out.push(`${sim.t.toFixed(2)} v=${v.toFixed(2)} grip=${(grip * 100).toFixed(0)}cm w=${inp?.weight ?? 1} task=${a.tasks.hands[0]?.weight.toFixed(2)}`);
  }
  console.log(out.join('\n'));
});
