import type { Beat } from '../src/beats';
import { play, type Playing } from '../src/play';

/** plays `beat` headless at 60 Hz until its story returns or its duration runs out */
export function runBeat(beat: Beat, onFrame?: (playing: Playing) => void): Playing {
  const playing = play(beat);
  while (!playing.finished() && playing.time < beat.duration) {
    playing.step(1 / 60);
    playing.scene.updateMatrixWorld(true);
    onFrame?.(playing);
  }
  return playing;
}
