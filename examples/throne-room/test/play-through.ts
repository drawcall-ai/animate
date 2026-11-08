import { expect, it } from 'vitest';
import type { Beat } from '../src/beats';
import { runBeat } from './run';

/** a test that `beat` plays to its end state within its duration, and no body's dev checks complain */
export function playsThrough(beat: Beat) {
  it(`${beat.id} plays to its end`, async () => {
    const playing = await runBeat(beat);
    expect(playing.finished(), `${beat.id} finished within ${beat.duration} s`).toBe(true);
    expect(playing.done(), `${beat.id} reached its end state`).toBe(true);
    expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
  });
}
