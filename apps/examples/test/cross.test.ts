import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('cross', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === (process.env.SC ?? 'pickup-shelf'))!);
  const a: any = sim.actors[0];
  const times: string[] = [];
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const p = a.pose;
    const l = new Vector3(Math.cos(a.gait.root.yaw), 0, -Math.sin(a.gait.root.yaw));
    const d = p.leftAnkle.clone().sub(p.rightAnkle).dot(l);
    if (d < 0.02) times.push(`${sim.t.toFixed(2)}(${d.toFixed(2)},${a.gait.feet.map((f: any) => f.phase[0]).join('')})`);
  }
  console.log(times.join(' '));
});
