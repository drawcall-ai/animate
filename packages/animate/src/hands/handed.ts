import type { ReadonlyPose } from '../kernel/pose';
import type { Request, Staging } from '../kernel/requests';
import type { Legged } from '../legs/legged';
import type { Looker } from '../look/gaze';
import type { Hold, Holder, Resolving } from '../things/resolve';
import type { Thing } from '../things/thing';

/**
 * A body as its hands see it: on its legs, with eyes and the hands that hold things; the bodies it keeps clear of, what it wears, and the
 * requests it files itself (a hand backing out).
 */
export type Handed = Legged & Looker & Holder & {
  /** the bodies it keeps clear of, as they were before this frame's updates */
  readonly near: ReadonlySet<{ posesFor(reader: Resolving): readonly [ReadonlyPose, ReadonlyPose] }>;
  /** the hold each hand is on its way to take, as its hand verb brings it there (none: it brings it nowhere) */
  readonly coming: Record<string, Hold | null>;
  /** what it wears: things on its bones its hands do not hold */
  readonly worn: readonly Thing[];
  own(verb: string, site: string, staging: Staging): Request;
};
