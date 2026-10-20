import type { Gazer } from './gaze';
import type { Skeleton } from './skeleton';

/** What kind of body it is, as data: its skeleton, how it looks about, and the bones it holds things with, by name. */
export interface Species {
  skeleton: Skeleton;
  /** its neck and eyes, for `lookAt` and the gazes built on it */
  gaze?: Gazer;
  /** its hands (or a jaw): the bone each holds with, by name */
  hands?: Readonly<Record<string, number>>;
}
