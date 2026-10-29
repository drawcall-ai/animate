import { expect, it } from 'vitest';
import { BEATS } from '../src/beats';
import { runBeat } from './run';

// Every registered beat plays to its end state within its duration, and no body's dev checks complain.
for (const beat of BEATS) {
  it(`${beat.id} plays to its end`, async () => {
    const playing = await runBeat(beat);
    expect(playing.finished(), `${beat.id} finished within ${beat.duration} s`).toBe(true);
    expect(playing.done(), `${beat.id} reached its end state`).toBe(true);
    expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
  });
}
it('lists beats', () => expect(Array.isArray(BEATS)).toBe(true));
