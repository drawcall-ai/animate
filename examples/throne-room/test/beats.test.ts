import { expect, it } from 'vitest';
import { BEATS } from '../src/beats/index';
import { playsThrough } from './play-through';

// Every registered beat but the film, which is as long as all of these together: its file gets a worker of its own beside them.
for (const beat of BEATS.filter((each) => each.id !== 'film')) playsThrough(beat);
it('lists beats', () => expect(BEATS.some((each) => each.id === 'film')).toBe(true));
