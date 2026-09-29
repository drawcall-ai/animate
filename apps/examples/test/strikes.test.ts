import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
const ang = (a: Vector3, b: Vector3, c: Vector3) => 180 - (Math.acos(a.clone().sub(b).normalize().dot(c.clone().sub(b).normalize())) * 180) / Math.PI;
const yawOfLine = (l: Vector3, r: Vector3) => Math.atan2(l.z - r.z, l.x - r.x);
it('strikes', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'fight')!);
  const probes: [number, number, string][] = [[1.6, 0, 'jab A'], [2.2, 0, 'cross A'], [3.5, 1, 'cross B'], [8.83, 0, 'body A'], [4.75, 0, 'roundhouse A'], [6.12, 1, 'frontkick B']];
  for (const [t, who, name] of probes.sort((a, b) => a[0] - b[0])) {
    sim.advanceTo(t);
    const p = sim.actors[who].pose;
    const tw = ((yawOfLine(p.leftShoulder, p.rightShoulder) - yawOfLine(p.leftHip, p.rightHip)) * 180) / Math.PI;
    const lean = (Math.acos(p.neck.clone().sub(p.pelvis).normalize().y) * 180) / Math.PI;
    console.log(`${name.padEnd(13)} t=${t} elbowL=${ang(p.leftShoulder, p.leftElbow, p.leftWrist).toFixed(0)} elbowR=${ang(p.rightShoulder, p.rightElbow, p.rightWrist).toFixed(0)} kneeL=${ang(p.leftHip, p.leftKnee, p.leftAnkle).toFixed(0)} kneeR=${ang(p.rightHip, p.rightKnee, p.rightAnkle).toFixed(0)} shoulderVsHip=${tw.toFixed(0)}° lean=${lean.toFixed(0)}° ankleR.y=${p.rightAnkle.y.toFixed(2)}`);
  }
});
