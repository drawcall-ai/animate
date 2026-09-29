import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
import { Vector3 } from 'three';
it('strollm', () => {
  const sim = new Simulation(SCENARIOS.find((s) => s.id === 'stroll')!);
  const a: any = sim.actors[0];
  const P = a.pose;
  let hy: number[] = [], px: number[] = [], sw: number[] = [], el: number[] = [], pr: number[] = [];
  while (sim.t < 8) {
    sim.step();
    if (sim.t < 4) continue;
    const f = a.gait.forward();
    const l = new Vector3(f.z, 0, -f.x);
    hy.push(P.nose.y);
    px.push(P.pelvis.clone().sub(a.gait.root).dot(l));
    const u = P.rightElbow.clone().sub(P.rightShoulder);
    sw.push(Math.atan2(u.dot(f), -u.y) * 57.3);
    const fo = P.rightWrist.clone().sub(P.rightElbow);
    el.push(u.angleTo(fo) * 57.3);
    pr.push((P.leftHip.y - P.rightHip.y) / P.leftHip.distanceTo(P.rightHip) * 57.3);
  }
  const r = (xs: number[]) => `${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)}`;
  console.log('head y', r(hy), 'pelvis lat', r(px), 'shoulder swing deg', r(sw), 'elbow flex', r(el), 'obliquity deg', r(pr), 'speed', a.gait.speed.toFixed(2));
});
