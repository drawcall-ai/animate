import type { Beat } from '../src/beats';
import { play, type Playing } from '../src/play';

/**
 * plays `beat` headless at 60 Hz until its story returns or its duration runs out; it gives the test runner a turn every simulated
 * 10 s (a long beat's minute of solid stepping otherwise starves the runner's messages until it times out)
 */
export async function runBeat(beat: Beat, onFrame?: (playing: Playing) => void): Promise<Playing> {
  const playing = play(beat);
  for (let frame = 1; !playing.finished() && playing.time < beat.duration; frame++) {
    playing.step(1 / 60);
    playing.scene.updateMatrixWorld(true);
    onFrame?.(playing);
    if (frame % 600 === 0) await new Promise((resume) => setImmediate(resume));
  }
  return playing;
}
