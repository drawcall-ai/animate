import type { Vector3 } from 'three';
import type { Frame } from './body';
import type { Gazer } from './gaze';
import type { Inertial } from './inertia';
import type { Live } from './goal';
import type { Gait } from './legs/gait';
import type { CarriedBones, Striding } from './legs/carriage';
import type { LegChain } from './legs/legs';
import type { ReadonlyPose } from './pose';
import type { Skeleton } from './skeleton';

/** What kind of body it is, as data: its skeleton, how it looks about, and the bones it holds things with, by name (`H`: their names). */
export interface Species<H extends string = string> {
  skeleton: Skeleton;
  /** its neck and eyes, for `lookAt` and the gazes built on it */
  gaze?: Gazer;
  /** its hands (or a jaw), by name: the skeleton's chain each reaches with, the hand its tip (`grab`, `hold`) */
  hands?: Readonly<Record<H, string>>;
  /**
   * its legs (`idle` walks it on them), their gait, and what the gait carries over them (`carriage`: the trunk, spine, pelvis, head and
   * tail as the gait's `body` has them, and the quiet life of these) — or a posture of its own, written in their place, made
   * for the body's gait (`scaled` scales it with the legs)
   */
  legs?: { chains: readonly LegChain[]; gait: Gait; carriage?: CarriedBones; posture?: (start: ReadonlyPose, gait: Gait) => Posture };
  /** how its trunk takes its root's acceleration: leaning into speeding up, slowing down and turning (`Inertial`; none: it does not) */
  inertia?: Inertial;
  /** its size against the body its distances were tuned for (`scaled`; default 1): a body made of it takes it as its `scale` */
  scale?: number;
}

/** What a creature heeds as it stands and walks besides what it looks at (`lookAt`): a tether it is tied by, a startle (a new point each time). */
export interface Attention { tether?: Live<{ position: Readonly<Vector3>; length: number } | undefined>; startle?: Live<Readonly<Vector3> | undefined> }

/** A species' posture over its legs, written each sub-step before the legs step, its head toward `look` (what `lookAt` asks) if any. */
export interface Posture { prepare(f: Frame, legs: Striding, attention: Attention, look: Readonly<Vector3> | null): void }
