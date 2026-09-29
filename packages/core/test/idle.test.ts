import { it } from 'vitest';
import { Vector3 } from 'three';
import { Humanoid } from '../src';
const ang = (a: Vector3, b: Vector3, c: Vector3) => 180 - (Math.acos(a.clone().sub(b).normalize().dot(c.clone().sub(b).normalize())) * 180) / Math.PI;
it('idle', () => {
  const h: any = new Humanoid();
  for (let i = 0; i < 120; i++) h.update({}, 1 / 60);
  const p = h.pose;
  console.log('knee', ang(p.leftHip, p.leftKnee, p.leftAnkle).toFixed(1), 'elbow', ang(p.leftShoulder, p.leftElbow, p.leftWrist).toFixed(1),
    'pelvisY', p.pelvis.y.toFixed(3), 'hipH', h.dims.hipHeight.toFixed(3), 'cur', Array.from(h.cur as Float64Array).map((x: number) => x.toFixed(3)).join(' '),
    'hip-ankle', p.leftHip.distanceTo(p.leftAnkle).toFixed(3), 'leg', h.dims.legLength.toFixed(3), 'sh-wr', p.leftShoulder.distanceTo(p.leftWrist).toFixed(3), 'arm', h.dims.armLength.toFixed(3));
});
