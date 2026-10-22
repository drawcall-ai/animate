import { AnimationClip, AnimationMixer, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { fixModelAnimationClip, loadCharacterModel, type CharacterModel } from '@pmndrs/viverse';
import { Pose } from '../../src';
import { BONES, CHILD_BONES, INDEX, PARENT, type BoneName } from '../../src/humanoid/bones';
import { createSkeletonModel } from '../../src/humanoid/model';
import { DEFAULT_HEIGHT, proportionsFor, type Proportions } from '../../src/humanoid/proportions';
import { Rig } from '../../src/humanoid/rig';
import { yawOf } from '../../src/core/math';
import { massFor } from '../../src/humanoid/skeleton';
import { rng, turnUpTo, vrmOf } from './fixtures';

/** the bone's node, or the node the rig added at its origin (a VRM's) */
const node = (m: CharacterModel, b: BoneName) => m.scene.getObjectByName(b);

/**
 * the models a rig is built from, each kind made fresh on demand, the node a bone's rotation is
 * written to (a VRM's normalized bone, which the rig's node named after it is attached to) and,
 * for those built from known proportions, those
 */
const MODELS: { kind: string; make: () => Promise<CharacterModel>; driven: (m: CharacterModel, b: BoneName) => Object3D | null | undefined; built?: Proportions }[] = [
  { kind: 'bare bones', make: async () => createSkeletonModel(), driven: node, built: proportionsFor(DEFAULT_HEIGHT) },
  { kind: "viverse's mannequin (glTF)", make: () => loadCharacterModel(), driven: node },
  { kind: 'VRM 0', make: async () => vrmOf('0'), driven: (m, b) => node(m, b)?.parent, built: proportionsFor(1.6) },
  { kind: 'VRM 1', make: async () => vrmOf('1'), driven: (m, b) => node(m, b)?.parent, built: proportionsFor(1.6) },
];

const MM = 1e-3;

/** the pose as a one-key VRM-normalized clip, relative to the hips' facing (as a character controller plays it, the scene placed there) */
function clipOf(rig: Rig, pose: Pose): AnimationClip {
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawOf(pose.local(0)));
  const hips = facing.invert().multiply(pose.local(0));
  const tracks = BONES.map((b, i) => new QuaternionKeyframeTrack(`${b}.quaternion`, [0], (i === 0 ? hips : pose.local(i)).toArray()));
  return new AnimationClip('pose', 1, [...tracks, new VectorKeyframeTrack('hips.position', [0], rig.proportions.hips.toArray())]);
}

/** how far apart two rotations are, componentwise (precise near zero, unlike angleTo; clips hold float32) */
const gap = (a: Quaternion, b: Quaternion) => {
  const d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  return Math.hypot(a.x - d * b.x, a.y - d * b.y, a.z - d * b.z, a.w - d * b.w);
};

const world = (o: Object3D) => ({ position: o.getWorldPosition(new Vector3()), quaternion: o.getWorldQuaternion(new Quaternion()) });

for (const { kind, make, driven, built } of MODELS) {
  describe(`a rig of ${kind}`, { timeout: 20000 }, () => {
    it('is a skeleton of the model’s measures, with Dempster’s masses', async () => {
      const rig = new Rig(await make());
      const { bones } = rig.skeleton;
      expect(bones.map((b) => b.name)).toEqual([...BONES]);
      expect(bones.map((b) => b.parent)).toEqual(BONES.map((b) => (b === 'hips' ? -1 : INDEX[PARENT[b]])));
      bones.forEach((b, i) => expect(b.parent, b.name).toBeLessThan(i));
      if (built) {
        expect(bones[0].offset.distanceTo(built.hips)).toBeLessThan(MM);
        for (const b of CHILD_BONES) expect(bones[INDEX[b]].offset.distanceTo(built.offsets[b]), b).toBeLessThan(MM);
        expect(rig.proportions.height).toBeCloseTo(built.height, 9);
      }
      const total = bones.reduce((m, b) => m + b.mass, 0);
      expect(total).toBeCloseTo(massFor(rig.proportions.height), 9);
      expect(total).toBeGreaterThan(45);
      expect(total).toBeLessThan(90);
      // standing in the T-pose, the centre of mass is ~0.55–0.57 of the height up (Dempster), over the feet
      const com = new Pose(rig.skeleton).com(new Vector3());
      expect(com.y / rig.proportions.height).toBeGreaterThan(0.53);
      expect(com.y / rig.proportions.height).toBeLessThan(0.59);
      expect(Math.hypot(com.x, com.z)).toBeLessThan(0.03);
    });

    it('poses the model as viverse retargets a VRM-normalized clip, and as the skeleton has it', async () => {
      const model = await make();
      const rig = new Rig(model);
      const rand = rng(kind.length);
      for (let k = 0; k < 3; k++) {
        const pose = new Pose(rig.skeleton);
        pose.setRoot(new Vector3(rand() * 4 - 2, rand() + 0.5, rand() * 4 - 2));
        BONES.forEach((_, i) => pose.setLocal(i, turnUpTo(rand, i === 0 ? Math.PI : 1.2)));
        rig.write(pose, 0);
        model.scene.updateMatrixWorld(true);
        const ours = BONES.map((b) => node(model, b)).map((n) => n && world(n));
        // the joints where the skeleton has them: the bones and the landmarks on them
        ours.forEach((o, i) => o && expect(o.position.distanceTo(pose.position(i)), BONES[i]).toBeLessThan(1e-5));
        for (const [name, point] of Object.entries(rig.points)) {
          const mark = model.scene.getObjectByName(name);
          if (!mark) continue;
          const want = pose.point(point.bone, point.at, new Vector3());
          expect(mark.getWorldPosition(new Vector3()).distanceTo(want), name).toBeLessThan(1e-5);
        }

        for (const b of BONES) driven(model, b)?.quaternion.set(0.5, 0.5, 0.5, 0.5);
        const clip = clipOf(rig, pose);
        fixModelAnimationClip(model, clip, undefined, false);
        const mixer = new AnimationMixer(model.scene);
        mixer.clipAction(clip).play();
        mixer.update(0);
        model.scene.updateMatrixWorld(true);
        BONES.forEach((b, i) => {
          const n = node(model, b);
          const o = ours[i];
          if (!n || !o) return;
          const theirs = world(n);
          // (a limb bent a little at rest — the mannequin's arm by 0.5° — is turned onto the skeleton's straight one, its joints where
          // the skeleton has them, as checked above; viverse's retarget keeps the bend: the limbs below the shoulders and hips are not its)
          if (/(LowerArm|Hand|LowerLeg|Foot|Toes)$/.test(b)) return;
          expect(theirs.position.distanceTo(o.position), b).toBeLessThan(1e-5);
          if (!/Upper(Arm|Leg)$/.test(b)) expect(gap(theirs.quaternion, o.quaternion), b).toBeLessThan(1e-5);
        });
        mixer.stopAllAction();
      }
    });

    it('rigs a model once', async () => {
      const model = await make();
      new Rig(model);
      expect(() => new Rig(model)).toThrow(/already has a node named/);
    });
  });
}
