import { parallel, type Timeline } from '@pmndrs/timeline';
import { idle } from '../../src/humanoid/idle';
import { Humanoid, createSkeletonModel, type Frame } from '../../src';
// Test fixtures: character models as viverse loads them, and random rotations.
import { AnimationMixer, Bone, Group, Quaternion, Vector3 } from 'three';
import { VRM, VRMHumanoid, type VRMMeta } from '@pixiv/three-vrm';
import type { CharacterModel } from '@pmndrs/viverse';
import { CHILD_BONES, PARENT, perBone } from '../../src/humanoid/bones';
import { proportionsFor } from '../../src/humanoid/proportions';

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

/** a VRM made the way three-vrm loads one, with viverse's hidden rest copy added as `loadCharacterModel` does (from core's viverse test) */
export function vrmOf(metaVersion: '0' | '1', height = 1.6): CharacterModel & VRM {
  const rest = proportionsFor(height);
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

/** mulberry32 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a random rotation up to `angle` (rad) */
export function turnUpTo(rand: () => number, angle: number): Quaternion {
  const axis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
  return new Quaternion().setFromAxisAngle(axis, angle * rand());
}

/** The same idle/task ordering in every interaction test. */
export function standing(tasks: (h: Humanoid) => Timeline<Frame>[], height = 1.75): Humanoid {
  return new Humanoid(createSkeletonModel(height), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), ...tasks(h));
  }, { idle: false });
}
