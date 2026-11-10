import { runTimeline, type NonReuseableTimeline, type ReusableTimeline } from '@pmndrs/timeline';
import { selfOf, Body } from '../body';

/**
 * Runs `story` headless to its end as an app would, frame by frame (`dt`, s): the story, then each of `bodies`. Returns what it returned and
 * how long it took (s). A story still running after `limit` s throws, naming what was running: to verify a story, this ends what would
 * otherwise hang. `frame` is called after the bodies update each frame, with the story's time (s): to measure as it goes. It prints nothing:
 * read `body.log` after it.
 */
export function play<R>(bodies: Body | readonly Body[], story: ReusableTimeline<unknown, R> | NonReuseableTimeline<unknown, R>, { limit = 60, dt = 1 / 60, frame }: { limit?: number; dt?: number; frame?: (time: number) => void } = {}): { result: R; time: number } {
  const all = bodies instanceof Body ? [bodies] : bodies;
  const ended: R[] = [];
  const step = runTimeline(function* () {
    ended.push(yield* typeof story === 'function' ? story() : story);
  });
  let time = 0;
  while (!ended.length) {
    if (time >= limit - 1e-9) throw new Error(`story still running after ${+time.toFixed(2)} s: ${running(all)}`);
    time += dt;
    step(undefined, dt);
    for (const body of all) body.update(dt);
    frame?.(time);
  }
  return { result: ended[0], time };
}

/** what `bodies` are doing for their stories: each verb running, where it was asked for and since when */
function running(bodies: readonly Body[]): string {
  const verbs = bodies.flatMap((body) => selfOf(body).requests.filter((request) => request.kind !== 'own').map((request) => {
    const since = `since ${request.filed.toFixed(1)} s`;
    return `${request.verb} (${[request.site, since, request.kind === 'aimer' ? "it ends only on its until (a pose's: or stay)" : ''].filter(Boolean).join(', ')})`;
  }));
  return verbs.join('; ') || 'no verb is running, so a `wait` whose condition never holds, or a step of its own';
}
