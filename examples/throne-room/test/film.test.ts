import { BEATS } from '../src/beats';
import { playsThrough } from './play-through';

for (const beat of BEATS.filter((each) => each.id === 'film')) playsThrough(beat);
