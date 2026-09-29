import { describe, expect, it } from 'vitest';
import { Humanoid, JOINTS } from '../src';

const fmt = (v: { x: number; y: number; z: number }) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;

describe('humanoid', () => {
  it('stands plausibly', () => {
    const h = new Humanoid();
    h.update({}, 1);
    const p = h.pose;
    for (const j of JOINTS) expect(Number.isFinite(p[j].x + p[j].y + p[j].z), j).toBe(true);
    console.log('stand', ['nose', 'neck', 'pelvis', 'leftWrist', 'leftKnee', 'leftAnkle', 'leftHeel', 'leftBigToe'].map((j) => j + '=' + fmt(p[j as 'nose'])).join(' '));
    expect(p.nose.y).toBeGreaterThan(1.55);
    expect(p.pelvis.y).toBeGreaterThan(0.88);
  });

  it('walks to far hand targets and reaches', () => {
    const h = new Humanoid();
    const log: string[] = [];
    let maxSlide = 0;
    const prevAnk = [h.gait.feet[0].anchor.clone(), h.gait.feet[1].anchor.clone()];
    for (let i = 0; i < 60 * 6; i++) {
      const t = i / 60;
      h.update({ leftHand: { position: { x: 0.15, y: 0.9, z: 3 } }, rightHand: { position: { x: -0.15, y: 0.9, z: 3 } } }, 1 / 60);
      for (let s = 0; s < 2; s++) {
        const f = h.gait.feet[s];
        if (f.phase === 'planted' && f.plantedTime > 0.2) {
          maxSlide = Math.max(maxSlide, Math.hypot(f.anchor.x - prevAnk[s].x, f.anchor.z - prevAnk[s].z));
        }
        prevAnk[s].copy(f.anchor);
      }
      if (i % 15 === 0) log.push(`t=${t.toFixed(2)} root=${h.gait.root.x.toFixed(2)},${h.gait.root.z.toFixed(2)} v=${h.gait.speed.toFixed(2)} pel=${fmt(h.pose.pelvis)} L=${h.gait.feet[0].phase[0]} R=${h.gait.feet[1].phase[0]} lw=${fmt(h.pose.leftWrist)}`);
    }
    console.log(log.join('\n'));
    const p = h.pose;
    const d = h.dims;
    expect(Math.abs(p.leftShoulder.distanceTo(p.leftElbow) - d.upperArm)).toBeLessThan(1e-3);
    expect(Math.abs(p.leftHip.distanceTo(p.leftKnee) - d.thigh)).toBeLessThan(1e-3);
    expect(p.leftWrist.distanceTo({ x: 0.15, y: 0.9, z: 3 } as any)).toBeLessThan(0.05);
    expect(maxSlide).toBeLessThan(1e-6);
  });
});
