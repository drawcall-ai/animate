import { describe, expect, it } from 'vitest';
import { Bone, OrthographicCamera, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { action } from '@pmndrs/timeline';
import { Humanoid, type Ctx } from '@drawcall/animate';
import { BODY25_COLORS, BODY25_KEYPOINTS, BODY25_PAIRS, createOpenPoseModel, drawOpenPose2D, OpenPoseSkeleton, projectBody25, toBody25, type Context2D } from '../src/openpose';

/** OpenPose's own BODY_25 part names, in its order (poseParameters.cpp) */
const OPENPOSE = [
  'Nose', 'Neck', 'RShoulder', 'RElbow', 'RWrist', 'LShoulder', 'LElbow', 'LWrist', 'MidHip', 'RHip', 'RKnee', 'RAnkle',
  'LHip', 'LKnee', 'LAnkle', 'REye', 'LEye', 'REar', 'LEar', 'LBigToe', 'LSmallToe', 'LHeel', 'RBigToe', 'RSmallToe', 'RHeel',
];

/** a body standing still, as it starts: relaxed */
const still = () =>
  function* () {
    yield* action<Ctx>({ update: () => {} });
  };

/** an OpenPose model standing at the origin, facing +Z (its left is +X) */
function standing(): CharacterModel {
  const model = createOpenPoseModel();
  const h = new Humanoid(model, still);
  for (let i = 0; i < 30; i++) h.update(1 / 60);
  model.scene.updateMatrixWorld();
  return model;
}

const world = (model: CharacterModel, name: string) => model.scene.getObjectByName(name)?.getWorldPosition(new Vector3()) ?? new Vector3(NaN);

describe('BODY_25 keypoints', () => {
  const model = standing();
  const k = toBody25(model);
  const at = (name: string) => k[OPENPOSE.indexOf(name)];

  it("are the model's bones and landmarks, in order", () => {
    expect(k).toHaveLength(25);
    BODY25_KEYPOINTS.forEach((name, i) => expect(k[i]).toEqual(world(model, name).toArray()));
    expect(BODY25_COLORS).toHaveLength(25);
  });

  it("put each 'R' part on the body's right and each 'L' part on its left", () => {
    OPENPOSE.forEach((name, i) => {
      if (name[0] === 'R') expect(k[i][0], name).toBeLessThan(-0.01);
      if (name[0] === 'L') expect(k[i][0], name).toBeGreaterThan(0.01);
    });
  });

  it('stack from the head down to the feet', () => {
    const y = (name: string) => at(name)[1];
    for (const s of ['R', 'L']) {
      expect(y(`${s}Eye`)).toBeGreaterThan(y('Neck'));
      expect(y(`${s}Shoulder`)).toBeGreaterThan(y(`${s}Elbow`));
      expect(y(`${s}Elbow`)).toBeGreaterThan(y(`${s}Wrist`));
      expect(y(`${s}Hip`)).toBeGreaterThan(y(`${s}Knee`));
      expect(y(`${s}Knee`)).toBeGreaterThan(y(`${s}Ankle`));
      for (const foot of ['BigToe', 'SmallToe', 'Heel']) expect(y(`${s}${foot}`)).toBeLessThan(0.05);
      // toes ahead of the heel
      expect(at(`${s}BigToe`)[2]).toBeGreaterThan(at(`${s}Heel`)[2]);
    }
    expect(y('Nose')).toBeGreaterThan(y('Neck'));
    expect(y('Neck')).toBeGreaterThan(y('MidHip'));
  });

  it('pair into a tree over all 25 keypoints', () => {
    expect(BODY25_PAIRS).toHaveLength(24);
    const reached = new Set([1]);
    for (const [a, b] of BODY25_PAIRS) {
      expect(reached.has(a), `${OPENPOSE[a]} → ${OPENPOSE[b]}`).toBe(true);
      reached.add(b);
    }
    expect(reached.size).toBe(25);
  });
});

describe('projectBody25', () => {
  it('maps normalised device coordinates to pixels, y down', () => {
    const model = standing();
    // an orthographic view down −Z where NDC = world x, y
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const px = projectBody25(model, camera, 400, 200);
    BODY25_KEYPOINTS.forEach((name, i) => {
      const p = world(model, name);
      expect(px[i][0]).toBeCloseTo(((p.x + 1) / 2) * 400, 6);
      expect(px[i][1]).toBeCloseTo(((1 - p.y) / 2) * 200, 6);
    });
  });
});

describe('drawOpenPose2D', () => {
  it('draws a limb per pair, then a disc per keypoint, and restores the context', () => {
    const calls: string[] = [];
    const ctx: Context2D = {
      canvas: { width: 512, height: 512 },
      fillStyle: '#000',
      globalAlpha: 1,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => {},
      ellipse: () => calls.push(`ellipse ${ctx.fillStyle} ${ctx.globalAlpha}`),
      arc: () => calls.push(`arc ${ctx.fillStyle} ${ctx.globalAlpha}`),
      fill: () => {},
    };
    const points = Array.from({ length: 25 }, (_, i): [number, number] => [i * 10, i * 5]);
    drawOpenPose2D(ctx, points);
    expect(calls[0]).toBe('save');
    expect(calls.at(-1)).toBe('restore');
    const limbs = calls.filter((c) => c.startsWith('ellipse'));
    const discs = calls.filter((c) => c.startsWith('arc'));
    expect(limbs).toHaveLength(24);
    expect(discs).toHaveLength(25);
    // a limb in its child keypoint's colour, blended at 0.6
    const [r, g, b] = BODY25_COLORS[BODY25_PAIRS[0][1]];
    expect(limbs[0]).toBe(`ellipse rgb(${r},${g},${b}) 0.6`);
    expect(discs.every((c) => c.endsWith(' 1'))).toBe(true);
  });
});

describe('createOpenPoseModel', () => {
  it('is a viverse character model of VRM-named bones, with an OpenPose skeleton that follows the keypoints', () => {
    const model = createOpenPoseModel({ height: 1.6 });
    expect(model.height).toBe(1.6);
    for (const b of ['hips', 'neck', 'leftUpperArm', 'rightFoot']) expect(model.scene.getObjectByName(b), b).toBeInstanceOf(Bone);
    new Humanoid(model, still).update(0.5);
    model.scene.updateMatrixWorld();
    const skeleton = model.scene.children.find((c) => c instanceof OpenPoseSkeleton);
    if (!skeleton) throw new Error('no skeleton');
    const has = (v: Vector3) => skeleton.children.some((c) => c.getWorldPosition(new Vector3()).distanceTo(v) < 1e-9);
    for (const name of BODY25_KEYPOINTS) expect(has(world(model, name)), name).toBe(true);
    for (const [a, b] of BODY25_PAIRS) {
      const mid = world(model, BODY25_KEYPOINTS[a]).lerp(world(model, BODY25_KEYPOINTS[b]), 0.5);
      expect(has(mid), `${OPENPOSE[a]}–${OPENPOSE[b]}`).toBe(true);
    }
    expect(skeleton.children).toHaveLength(25 + 24);
  });

  it('asks for a Humanoid before it has landmarks', () => {
    expect(() => createOpenPoseModel().scene.updateMatrixWorld()).toThrow(/no nose: drive it with a Humanoid/);
  });
});
