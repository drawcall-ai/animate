import { Vector3 } from 'three';
import type { Carriage, Gait } from './gait';
import type { LegChain } from './leg';
import type { ReadonlyPose } from '../kernel/pose';
import { Skeleton } from '../kernel/skeleton';
import type { Species } from './define';

/**
 * `species` at `size` times its size: its bones, its feet and its eyes `size` times as far apart, each bone `size`³ as heavy, and its
 * gait dynamically similar (Alexander & Jayes 1983, recalled: at equal Froude numbers, strides and lifts ∝ length, speeds ∝ √length,
 * cadences ∝ 1/√length, and so its lean into its acceleration). A body made of it takes `size` as its scale. A posture of the species' own is kept as it is; a person
 * is sized by its skeleton instead.
 */
export function scaled<Bone extends string, Hand extends string>(species: Species<Bone, Hand>, size: number): Species<Bone, Hand> {
  if (!(size > 0 && Number.isFinite(size))) throw new Error(`scaled: a size of ${size}`);
  if (species.person) throw new Error('scaled: a person is sized by its skeleton');
  const { skeleton, gaze, legs, inertia } = species;
  const bones = skeleton.bones.map((bone) => ({ ...bone, offset: bone.offset.clone().multiplyScalar(size), com: bone.com.clone().multiplyScalar(size), mass: bone.mass * size ** 3 }));
  const chains = Object.fromEntries(skeleton.chainNames().map((name) => [name, skeleton.chain(name).map((bone) => skeleton.bones[bone].name)]));
  const limits = skeleton.limits.filter((limit) => limit !== undefined);
  return {
    ...species,
    bones: species.bones.map((bone) => ({ ...bone, position: [bone.position[0] * size, bone.position[1] * size, bone.position[2] * size] as const })),
    skeleton: new Skeleton(bones, { limits, chains }),
    mass: species.mass * size ** 3,
    scale: species.scale * size,
    gaze: gaze && { ...gaze, eyes: stretchedEyes(gaze.eyes, size) },
    legs: legs && { ...legs, chains: legs.chains.map((chain) => feet(chain, size)), gait: gaitAt(legs.gait, size) },
    // (its trunk's lean as quick as its stride: ∝ 1/√length)
    inertia: inertia && { ...inertia, frequency: inertia.frequency / Math.sqrt(size) },
  };
}

/** `eyes` reading each pose with points given in a bone's frame `size` times as far from it (a view made once a pose: a body's poses last) */
function stretchedEyes(eyes: (pose: ReadonlyPose, out: Vector3) => Vector3, size: number): (pose: ReadonlyPose, out: Vector3) => Vector3 {
  const at = new Vector3(), views = new WeakMap<ReadonlyPose, ReadonlyPose>();
  return (pose, out) => {
    let view = views.get(pose);
    if (!view) {
      const point = (bone: number, local: Vector3, into: Vector3) => pose.point(bone, at.copy(local).multiplyScalar(size), into);
      views.set(pose, view = Object.create(pose, { point: { value: point } }) as ReadonlyPose);
    }
    return eyes(view, out);
  };
}

function feet(chain: LegChain, size: number): LegChain {
  return {
    ...chain,
    heel: chain.heel.clone().multiplyScalar(size),
    toe: chain.toe.clone().multiplyScalar(size),
    toes: chain.toes && { ...chain.toes, tip: chain.toes.tip.clone().multiplyScalar(size) },
  };
}

/** the gait dynamically similar at `size`: read at the speed of the same Froude number */
export function gaitAt(gait: Gait, size: number): Gait {
  const k = Math.sqrt(size), at = (v: number) => v / k;
  const offsetAt = (offset: Gait['contacts'][number]['offset']) => typeof offset === 'number' ? offset : (v: number, fr: number) => offset(at(v), fr);
  return {
    ...gait,
    height: gait.height * size,
    slowest: gait.slowest * k,
    referenceSpeed: gait.referenceSpeed === undefined ? undefined : gait.referenceSpeed * k,
    clearance: gait.clearance.map((c) => c * size),
    frequency: (v, fr) => gait.frequency(at(v), fr) / k,
    contacts: gait.contacts.map((c) => ({
      ...c,
      offset: offsetAt(c.offset),
      duty: (v: number, fr: number) => c.duty(at(v), fr),
    })),
    body: typeof gait.body === 'function' ? ((body) => (v: number, fr: number) => carriage(body(at(v), fr), size))(gait.body) : gait.body && carriage(gait.body, size),
  };
}

/** a carriage at `size`: its rises and falls as long, its angles as they are */
const carriage = (b: Carriage, size: number): Carriage => ({ ...b, withers: b.withers * size, croup: [b.croup[0] * size, b.croup[1]], headRise: b.headRise * size });
