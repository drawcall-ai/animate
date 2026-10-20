import { action, type UntilCondition } from '@pmndrs/timeline';
import type { Frame } from './body';

/** Waits until `condition` holds, handing the frame on to what follows. */
export const when = (condition: UntilCondition<Frame>) => action<Frame>({ until: condition });
