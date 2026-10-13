import { action } from '@pmndrs/timeline';
import { Body, type BodyOptions, type Ctx, type Skeleton } from '../src/index.js';

/** a body whose behaviour runs `propose` every sub-step, forever */
export function drive(skeleton: Skeleton, propose: (ctx: Ctx) => void, options?: BodyOptions<unknown>): Body {
  return new Body(
    skeleton,
    function* () {
      yield* action<Ctx>({ update: (ctx) => void propose(ctx) });
    },
    options,
  );
}

/** steps `body` by 1/60 s `seconds` long, calling `each` after every step */
export function run(body: Body, seconds: number, each?: (step: number) => void): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    body.update(1 / 60);
    each?.(i);
  }
}
