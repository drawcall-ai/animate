import type { Vector3 } from 'three';
import type { Frame } from './body';
import type { Gazer } from './gaze';
import type { Live } from './goal';
import type { Gait } from './legs/gait';
import type { LegChain, Legs } from './legs/legs';
import type { ReadonlyPose } from './pose';
import type { Skeleton } from './skeleton';

/** What kind of body it is, as data: its skeleton, how it looks about, and the bones it holds things with, by name. */
export interface Species {
  skeleton: Skeleton;
  /** its neck and eyes, for `lookAt` and the gazes built on it */
  gaze?: Gazer;
  /** its hands (or a jaw), by name: the skeleton's chain each reaches with, the hand its tip (`grab`, `hold`) */
  hands?: Readonly<Record<string, string>>;
  /** its legs, their gait, and the posture its trunk, head and tail take over them (`idle` walks it on them) */
  legs?: { chains: readonly LegChain[]; gait: Gait; posture?: (start: ReadonlyPose) => Posture };
}

/** What a creature heeds as it stands and walks besides what it looks at (`lookAt`): a tether it is tied by, a startle (a new point each time). */
export interface Attention { tether?: Live<{ position: Readonly<Vector3>; length: number } | undefined>; startle?: Live<Readonly<Vector3> | undefined> }

/** A species' posture over its legs, written each sub-step before the legs step, its head toward `look` (what `lookAt` asks) if any. */
export interface Posture { prepare(f: Frame, legs: Legs, attention: Attention, look: Readonly<Vector3> | null): void }
