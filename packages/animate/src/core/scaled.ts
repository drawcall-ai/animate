import { Vector3 } from 'three';
import type { Gait } from './legs/gait';
import type { Carriage } from './legs/carriage';
import type { LegChain } from './legs/legs';
import type { ReadonlyPose } from './pose';
import { Skeleton } from './skeleton';
import type { Species } from './species';

/**
 * `species` at `size` times its size: its bones, its feet and its eyes `size` times as far apart, each bone `size`³ as heavy, and its
 * gait dynamically similar (Alexander & Jayes 1983, recalled: at equal Froude numbers, strides and lifts ∝ length, speeds ∝ √length,
 * cadences ∝ 1/√length, and so its lean into its acceleration). A body made of it takes `size` as its scale. A posture of the species' own is kept as it is; a person
 * is scaled by its model instead: `new Humanoid(createSkeletonModel(height))`.
 */
export function scaled<H extends string>(species: Species<H>, size: number): Species<H> {
  if (!(size > 0 && Number.isFinite(size))) throw new Error(`scaled: a size of ${size}`);
  const { skeleton, gaze, legs, inertia } = species;
  const bones = skeleton.bones.map((bone) => ({ ...bone, offset: bone.offset.clone().multiplyScalar(size), com: bone.com.clone().multiplyScalar(size), mass: bone.mass * size ** 3 }));
  const chains = Object.fromEntries(skeleton.chainNames().map((name) => [name, skeleton.chain(name).map((bone) => skeleton.bones[bone].name)]));
  const limits = skeleton.limits.filter((limit) => limit !== undefined);
  return {
    ...species,
    skeleton: new Skeleton(bones, { limits, chains }),
    scale: (species.scale ?? 1) * size,
    gaze: gaze && { ...gaze, eyes: stretchedEyes(gaze.eyes, size) },
    legs: legs && { ...legs, chains: legs.chains.map((chain) => feet(chain, size)), gait: gait(legs.gait, size) },
    // (its trunk's lean as quick as its stride: ∝ 1/√length)
    inertia: inertia && { ...inertia, frequency: inertia.frequency / Math.sqrt(size) },
  };
}

/** `eyes` reading each pose with points given in a bone's frame `size` times as far from it (a view made once a pose: a body's poses last) */
function stretchedEyes(eyes: (pose: ReadonlyPose, out: Vector3) => Vector3, size: number): (pose: ReadonlyPose, out: Vector3) => Vector3 {
  const at = new Vector3(), views = new WeakMap<ReadonlyPose, ReadonlyPose>();
  const view = (pose: ReadonlyPose): ReadonlyPose => {
    let seen = views.get(pose);
    if (!seen) views.set(pose, seen = Object.create(pose, { point: { value: (bone: number, local: Vector3, out: Vector3) => pose.point(bone, at.copy(local).multiplyScalar(size), out) } }) as ReadonlyPose);
    return seen;
  };
  return (pose, out) => eyes(view(pose), out);
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
function gait(g: Gait, size: number): Gait {
  const k = Math.sqrt(size), at = (v: number) => v / k;
  const offsetAt = (offset: Gait['contacts'][number]['offset']) => typeof offset === 'number' ? offset : (v: number, fr: number) => offset(at(v), fr);
  return {
    ...g,
    height: g.height * size,
    slowest: g.slowest * k,
    referenceSpeed: g.referenceSpeed === undefined ? undefined : g.referenceSpeed * k,
    clearance: g.clearance.map((c) => c * size),
    frequency: (v, fr) => g.frequency(at(v), fr) / k,
    contacts: g.contacts.map((c) => ({
      ...c,
      offset: offsetAt(c.offset),
      duty: (v: number, fr: number) => c.duty(at(v), fr),
    })),
    body: typeof g.body === 'function' ? ((body) => (v: number, fr: number) => carriage(body(at(v), fr), size))(g.body) : g.body && carriage(g.body, size),
  };
}

/** a carriage at `size`: its rises and falls as long, its angles as they are */
const carriage = (b: Carriage, size: number): Carriage => ({ ...b, withers: b.withers * size, croup: [b.croup[0] * size, b.croup[1]], headRise: b.headRise * size });
