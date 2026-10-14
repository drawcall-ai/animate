// Beat attribution: which task runs when. `pnpm judge` resolves the scenarios' '@drawcall/animate'
// to this module (scripts/judge.mjs), so every task a script makes is logged as a beat while it
// runs, named by the task and the script lines that made it — nothing for authors to add.
import * as animate from '@drawcall/animate';
import type { Behaviour, World } from '@drawcall/animate';

export * from '@drawcall/animate';

/** a task's run: what it is, where in the scripts it was made, from when to when (s; null: still running) */
export interface Beat {
  task: string;
  where: string;
  start: number;
  end: number | null;
}

/** the beats of the current run, and the time the next sub-step runs at (the harness sets it before each step) */
export const beats = { log: [] as Beat[], t: 0 };

/** the beats running at `t`, the latest started first (the base, `idle`, left out) */
export function running(log: readonly Beat[], t: number): Beat[] {
  return log.filter((b) => b.task !== 'idle' && b.start <= t && (b.end === null || b.end > t)).sort((a, b) => b.start - a.start);
}

/** a beat's short label: its task and where it was made */
export const label = (b: Beat) => (b.where ? `${b.task}@${b.where}` : b.task);

/** `task` made by `make`, logged as a beat each time it runs */
function traced<A extends unknown[]>(task: string, make: (...args: A) => Behaviour<World>): (...args: A) => Behaviour<World> {
  return (...args) => {
    const where = maker(new Error().stack ?? '');
    const inner = make(...args);
    return function* () {
      const beat: Beat = { task, where, start: beats.t, end: null };
      beats.log.push(beat);
      try {
        yield* inner();
      } finally {
        beat.end = beats.t;
      }
    };
  };
}

/**
 * where in the scripts a task was made, innermost first, up to two lines (`knight.ts:43<sword.ts:20`):
 * the stack's frames in the examples' sources (the scripts' generators are anonymous, so lines, not names)
 */
function maker(stack: string): string {
  const lines: string[] = [];
  for (const frame of stack.split('\n')) {
    const m = /\/examples\/src\/(?:.*\/)?([\w.-]+\.ts):(\d+):\d+\)?$/.exec(frame);
    if (!m) continue;
    const at = `${m[1]}:${m[2]}`;
    if (lines.at(-1) !== at) lines.push(at);
    if (lines.length === 2) break;
  }
  return lines.join('<');
}

export const walkTo = traced('walkTo', animate.walkTo<World>);
export const handTo = traced('handTo', animate.handTo<World>);
export const headTo = traced('headTo', animate.headTo<World>);
export const grab = traced('grab', animate.grab<World>);
export const approach = traced('approach', animate.approach<World>);
export const reachFor = traced('reachFor', animate.reachFor<World>);
export const carry = traced('carry', animate.carry<World>);
export const hold = traced('hold', animate.hold<World>);
export const release = traced('release', animate.release<World>);
export const wear = traced('wear', animate.wear<World>);
export const takeOff = traced('takeOff', animate.takeOff<World>);
export const withGaze = traced('withGaze', animate.withGaze<World>);
export const lookAt = traced('lookAt', animate.lookAt<World>);
export const ask = traced('ask', animate.ask<World>);
export const trunkTo = traced('trunkTo', animate.trunkTo<World>);
export const pelvisTo = traced('pelvisTo', animate.pelvisTo<World>);
export const idle = traced('idle', animate.idle<World>);
