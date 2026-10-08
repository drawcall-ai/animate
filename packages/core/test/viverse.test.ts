import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { VRM, VRMHumanoid, type VRMMeta } from '@pixiv/three-vrm';
import { fixModelAnimationClip, loadCharacterModel, type CharacterModel } from '@pmndrs/viverse';
import { Humanoid, createSkeletonModel } from '../src';
import { BONES, CHILD_BONES, PARENT, perBone, type BoneName, type Rest } from '../src/pose/bones';
import type { Pose } from '../src/pose/pose';
import { sampleRest } from './fixtures';

// three's loaders report progress with ProgressEvent, which Node lacks
class NodeProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}
globalThis.ProgressEvent ??= NodeProgressEvent;

/** a real run on `model`, walking off at an angle while reaching for a point: the solver's pose every 50 steps */
function* poses(model: CharacterModel): Generator<Pose> {
  const h = new Humanoid(model, { position: { x: 0.4, y: 0, z: -0.3 }, yaw: 2.2 });
  for (let i = 1; i <= 150; i++) {
    h.update(1 / 60, { goal: { position: { x: -2, y: 0, z: 1.5 } }, leftHand: { position: { x: 0.3, y: 1.4, z: 1 }, weight: 0.6 } });
    if (i % 50 === 0) yield h['pose'];
  }
}

/** the pose as a one-key VRM-normalized clip (root-relative, as a character controller plays it) */
function clipOf(pose: Pose): AnimationClip {
  const inv = pose.root.quaternion.clone().invert();
  const tracks = BONES.map((b) => {
    const q = b === 'hips' ? inv.clone().multiply(pose.rotations.hips) : pose.rotations[b];
    return new QuaternionKeyframeTrack(`${b}.quaternion`, [0], q.toArray());
  });
  const hips = pose.joints.hips.clone().sub(pose.root.position).applyQuaternion(inv);
  return new AnimationClip('pose', 1, [...tracks, new VectorKeyframeTrack('hips.position', [0], hips.toArray())]);
}

/** how far apart two rotations are, componentwise (unlike angleTo, precise near zero; clips hold float32) */
const gap = (a: Quaternion, b: Quaternion) => {
  const d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  return Math.hypot(a.x - d * b.x, a.y - d * b.y, a.z - d * b.z, a.w - d * b.w);
};

/** world transforms of the driven nodes */
function snapshot(model: CharacterModel, node: (b: BoneName) => Object3D | null) {
  model.scene.updateMatrixWorld(true);
  return BONES.flatMap((b) => {
    const n = node(b);
    return n ? [{ b, position: n.getWorldPosition(new Vector3()), quaternion: n.getWorldQuaternion(new Quaternion()) }] : [];
  });
}

/** the posed model against viverse's own retargeting of the same pose, and against the solver's joints (bones and landmarks) */
function agrees(model: CharacterModel, node: (b: BoneName) => Object3D | null) {
  const bones = BONES.filter((b) => node(b));
  expect(bones.length).toBeGreaterThanOrEqual(BONES.length - 2);
  for (const pose of poses(model)) {
    const ours = snapshot(model, node);
    for (const { b, position } of ours) expect(position.distanceTo(pose.joints[b]), b).toBeLessThan(1e-5);
    // every joint is a node named after it (a missing bone's toe tips ride on the foot)
    for (const [name, p] of Object.entries(pose.joints)) {
      const joint = model.scene.getObjectByName(name);
      if (joint) expect(joint.getWorldPosition(new Vector3()).distanceTo(p), name).toBeLessThan(1e-5);
      else expect(name, name).toMatch(/Toes$/);
    }

    for (const b of bones) node(b)?.quaternion.set(0.5, 0.5, 0.5, 0.5);
    const clip = clipOf(pose);
    fixModelAnimationClip(model, clip, undefined, false);
    const mixer = new AnimationMixer(model.scene);
    mixer.clipAction(clip).play();
    mixer.update(0);
    const theirs = snapshot(model, node);
    ours.forEach(({ b, position, quaternion }, i) => {
      expect(theirs[i].position.distanceTo(position), b).toBeLessThan(1e-5);
      expect(gap(theirs[i].quaternion, quaternion), b).toBeLessThan(1e-5);
    });
    mixer.stopAllAction();
  }
}

/** a VRM made the way three-vrm loads one, with viverse's hidden rest copy added as `loadCharacterModel` does */
function vrmOf(rest: Rest, metaVersion: '0' | '1'): CharacterModel & VRM {
  const turn = (v: Vector3) => (metaVersion === '0' ? new Vector3(-v.x, v.y, -v.z) : v.clone());
  const raw = perBone((b) => Object.assign(new Bone(), { name: `J_${b}` }));
  raw.hips.position.copy(turn(rest.hips));
  for (const b of CHILD_BONES) {
    raw[b].position.copy(turn(rest.offsets[b]));
    raw[PARENT[b]].add(raw[b]);
  }
  const scene = new Group();
  scene.add(raw.hips);
  const humanoid = new VRMHumanoid(perBone((b) => ({ node: raw[b] })));
  scene.add(humanoid.normalizedHumanBonesRoot);
  const meta: VRMMeta = metaVersion === '0' ? { metaVersion } : { metaVersion, name: 'test', authors: [], licenseUrl: '' };
  const vrm = new VRM({ scene, humanoid, meta });
  const restPose = scene.clone();
  restPose.visible = false;
  restPose.traverse((o) => (o.name = `rest_${o.name}`));
  scene.add(restPose);
  return Object.assign(vrm, { mixer: new AnimationMixer(scene), currentAnimations: new Map() });
}

/** some joint nodes the body may have added to a model */
const landmarks = (model: CharacterModel) => ['nose', 'headTop', 'leftEye', 'rightEar', 'leftHeel', 'rightBigToe', 'leftSmallToe', 'neck'].filter((n) => model.scene.getObjectByName(n));

describe('viverse', () => {
  it("poses viverse's default mannequin (glTF) as viverse retargets a VRM-normalized clip", { timeout: 20000 }, async () => {
    const model = await loadCharacterModel();
    agrees(model, (b) => model.scene.getObjectByName(b) ?? null);
    expect(landmarks(model)).toHaveLength(8);
    const p = new Humanoid(await loadCharacterModel()).proportions;
    expect(p.height).toBeCloseTo(model.height ?? 0, 9);
    expect(p.hipHeight).toBeGreaterThan(0.85);
  });

  for (const version of ['0', '1'] as const) {
    it(`poses a VRM ${version} as viverse retargets a VRM-normalized clip`, () => {
      const rest = sampleRest(1.6);
      const model = vrmOf(rest, version);
      agrees(model, (b) => model.humanoid.getNormalizedBoneNode(b));
      expect(landmarks(model)).toHaveLength(8);
    });

    it(`measures a VRM ${version}'s proportions`, () => {
      const rest = sampleRest(1.6);
      const p = new Humanoid(vrmOf(rest, version)).proportions;
      expect(p.hips.distanceTo(rest.hips)).toBeLessThan(1e-9);
      for (const b of CHILD_BONES) expect(p.offsets[b].distanceTo(rest.offsets[b]), b).toBeLessThan(1e-9);
    });
  }

  it('builds a skeleton model as viverse loads a glTF, and poses it', () => {
    const model = createSkeletonModel(1.6);
    for (const b of BONES) {
      expect(model.scene.getObjectByName(b), b).toBeInstanceOf(Bone);
      expect(model.scene.getObjectByName(`rest_${b}`), b).toBeInstanceOf(Bone);
    }
    expect(model.height).toBe(1.6);
    const p = new Humanoid(model).proportions;
    const rest = sampleRest(1.6);
    for (const b of CHILD_BONES) expect(p.offsets[b].distanceTo(rest.offsets[b]), b).toBeLessThan(1e-12);
    const other = createSkeletonModel();
    agrees(other, (b) => other.scene.getObjectByName(b) ?? null);
    expect(landmarks(other)).toHaveLength(8);
  });

  it('names what a model lacks', () => {
    const model = vrmOf(sampleRest(), '1');
    model.scene.traverse((o) => (o.name = o.name.replace('rest_', 'x_')));
    expect(() => new Humanoid(model)).toThrow(/rest_Normalized_J_hips/);
  });
});
