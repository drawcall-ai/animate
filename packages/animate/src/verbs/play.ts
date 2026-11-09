import { runTimeline, type NonReuseableTimeline, type ReusableTimeline } from '@pmndrs/timeline';
import { selfOf, Body } from '../body/body';

/**
 * Runs `story` headless to its end as an app would, frame by frame (`dt`, s): the story, then each of `bodies`. Returns what it returned and
 * how long it took (s). A story still running after `limit` s throws, naming what was running: to verify a story, this ends what would
 * otherwise hang. It prints nothing: read `body.log` after it.
 */
export function play<R>(bodies: Body | readonly Body[], story: ReusableTimeline<unknown, R> | NonReuseableTimeline<unknown, R>, { limit = 60, dt = 1 / 60 }: { limit?: number; dt?: number } = {}): { result: R; time: number } {
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
  }
  return { result: ended[0], time };
}

/** what `bodies` are doing for their stories: each verb running, where it was asked for and since when */
function running(bodies: readonly Body[]): string {
  const verbs = bodies.flatMap((body) => selfOf(body).requests.filter((request) => !request.owned).map((request) => {
    const since = `since ${request.filed.toFixed(1)} s`;
    return `${request.verb} (${[request.site, since, request.endless ? 'never ends without until' : ''].filter(Boolean).join(', ')})`;
  }));
  return verbs.join('; ') || 'no verb is running, so a `wait` whose condition never holds, or a step of its own';
}
