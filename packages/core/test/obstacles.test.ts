import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Humanoid, createSkeletonModel, type Box, type Input, type Sphere } from '../src';

const DT = 1 / 60;

const body = () => new Humanoid(createSkeletonModel());
/** a bone origin's or landmark's world position, read from the model */
function at(h: Humanoid, name: string): Vector3 {
  const n = h.model.scene.getObjectByName(name);
  if (!n) throw new Error(`no ${name}`);
  return n.getWorldPosition(new Vector3());
}

const box = (z: number, depth: number, height: number, width = 1): Box => ({
  min: new Vector3(-width / 2, 0, z - depth / 2),
  max: new Vector3(width / 2, height, z + depth / 2),
});

const insideFootprint = (p: Vector3, b: Box) => p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z;

/** distance from `p` to the segment a–b */
function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = new Vector3().subVectors(b, a);
  const t = Math.min(1, Math.max(0, new Vector3().subVectors(p, a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

describe('floor obstacles', () => {
  it('steps over low boxes: no foot lands on one, and the swing clears it', () => {
    const h = body();
    const boxes = [box(1.4, 0.25, 0.12), box(2.8, 0.08, 0.28)];
    const input: Input = { goal: { position: { x: 0, y: 0, z: 4.5 } }, floorObstacles: boxes };
    let landedOn = 0;
    let lowestOver = Infinity;
    for (let t = 0; t < 10; t += DT) {
      h.update(DT, input);
      for (const [s, f] of h.feet.entries()) {
        if (f.phase === 'planted' && boxes.some((b) => insideFootprint(f.position, b))) landedOn++;
        const side = s === 0 ? 'left' : 'right';
        // the sole's lowest point over a box stays above its top
        for (const p of [at(h, `${side}Heel`), at(h, `${side}BigToe`), at(h, `${side}SmallToe`)]) {
          for (const b of boxes) if (insideFootprint(p, b)) lowestOver = Math.min(lowestOver, p.y - b.max.y);
        }
      }
    }
    expect(landedOn).toBe(0);
    // (a foot did pass over the boxes, above their tops)
    expect(lowestOver).toBeGreaterThan(0);
    expect(lowestOver).toBeLessThan(0.3);
    expect(h.model.scene.position.z).toBeGreaterThan(4);
  });
});

describe('body obstacles', () => {
  it('keeps the trunk clear of a sphere pushed into it', () => {
    const center = new Vector3(0, 1.25, 0.12);
    const ball: Sphere = { center, radius: 0.12 };
    /** how far the spine chain (hips → neck) stays outside the sphere */
    const clearance = (h: Humanoid) => {
      const [hips, spine, chest, neck] = ['hips', 'spine', 'chest', 'neck'].map((b) => at(h, b));
      return Math.min(segmentDistance(center, hips, spine), segmentDistance(center, spine, chest), segmentDistance(center, chest, neck)) - ball.radius;
    };
    const free = body();
    free.update(2);
    // (the sphere would reach into the trunk of a body ignoring it)
    expect(clearance(free)).toBeLessThan(0);
    const h = body();
    let worst = Infinity;
    for (let t = 0; t < 3; t += DT) {
      h.update(DT, { bodyObstacles: [ball] });
      if (t > 1) worst = Math.min(worst, clearance(h));
    }
    expect(worst).toBeGreaterThan(0.05);
  });
});
