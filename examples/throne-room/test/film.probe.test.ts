import { it } from 'vitest';
import { beat, lastFilm } from '../src/beats/film';
import { runBeat } from './run';

// Probe (FILM_PROBE=1): plays the film headless and prints its events, shots and sound cues (footsteps counted per walker) with their
// story times, so the cutting and the sound's sync with the motion can be read off; then the bodies' dev logs and the end checks.
it.skipIf(!process.env.FILM_PROBE)('film probe', async () => {
  const playing = await runBeat(beat);
  const list = (entries: [number, string][]) => entries.map(([time, what]) => `  ${time.toFixed(2)} ${what}`).join('\n');
  console.log(`events\n${list(Object.entries(lastFilm.events).map(([what, time]) => [time, what]))}`);
  console.log(`shots\n${list(lastFilm.shots.map((shot) => [shot.time, shot.name]))}`);
  const cues = playing.view.sound.cues;
  console.log(`cues\n${list(cues.filter((cue) => !cue.clip.startsWith('step')).map((cue) => [cue.time, `${cue.clip} (${cue.why})`]))}`);
  const steps: Record<string, number> = {};
  for (const cue of cues) if (cue.clip.startsWith('step')) steps[cue.why!.split(' ')[0]] = (steps[cue.why!.split(' ')[0]] ?? 0) + 1;
  console.log('footsteps', steps);
  console.log('log', playing.bodies.flatMap((body) => body.log.map((e) => `${e.time.toFixed(2)} ${e.check} @ ${e.where} (${e.beat})`)));
  const done = playing.done();
  console.log('done', done, lastFilm.ends);
});
