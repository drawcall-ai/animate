import { action } from '@pmndrs/timeline';
import type { Frame } from './body';

/** Waits until `condition` holds, handing the frame on to what follows. */
export const when = <W>(condition: (f: Frame<W>) => boolean) => action<Frame<W>>({ until: condition });
