import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from './body';
import type { Behaviour } from './goal';

/**
 * `first`, and `next` setting off while it still runs: once `at` holds (or `first` has ended) —
 * what comes next under way before this is over (the eyes on it, the body turning to it, the hands
 * opening for it), as people anticipate, rather than one thing after another. It ends once both
 * have. No fade is needed: each behaviour follows its goals from history, so one that sets off early
 * simply begins following them. `next` is layered after `first` (it wins where both write a bone,
 * and an ask both write is the later one's, but `bow` and `lower`, the most either asks): give
 * `next` an opening that leaves `first`'s bones alone until `first` is done with them.
 */
export function overlap<W>(first: Behaviour<W>, next: Behaviour<W>, at: (f: Frame<W>) => boolean): Behaviour<W> {
  return function* () {
    let ended = false;
    yield* parallel<Frame<W>>(
      'all',
      function* () {
        yield* first();
        ended = true;
      },
      function* () {
        yield* action<Frame<W>>({ until: (f) => ended || at(f) });
        yield* next();
      },
    );
  };
}
