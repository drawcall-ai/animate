import { BEATS } from '../src/beats/index';
import { playsThrough } from './play-through';

for (const beat of BEATS.filter((each) => each.id === 'film')) playsThrough(beat);
