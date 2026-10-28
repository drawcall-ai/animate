import { it } from 'vitest';
import { Vector3 } from 'three';
import { BEATS } from '../src/beats';
import { runBeat } from './run';

// Probe: the procession beat's walk abreast, climb and arrival, sampled every 2 s.
it('probe procession', () => {
  const beat = BEATS.find((b) => b.id === (process.env.BEAT ?? 'procession'))!;
  const head = new Vector3();
  const playing = runBeat(beat, (p) => {
    const frame = Math.round(p.time * 60);
    if (frame % 120 !== 0 && !(p.time > 34 && frame % 30 === 0)) return;
    console.log(p.time.toFixed(1), p.bodies.slice(0, 3).map((b) => `x${b.position.x.toFixed(2)} z${b.position.z.toFixed(2)} y${b.object.position.y.toFixed(2)} v${b.velocity.length().toFixed(2)} f${b.facing.toFixed(2)} head${b.bones.head.getWorldPosition(head).y.toFixed(2)}`).join(' | '));
  });
  console.log('settled', playing.bodies.slice(0, 3).map((b) => [b.settled, b.feet.map((f) => f.planted), b.gait.walk.toFixed(2)]));
  for (let i = 0; i < 120; i++) playing.step(1 / 60);
  console.log('later', playing.bodies.slice(0, 3).map((b) => b.settled), playing.done());
  console.log('finished', playing.finished(), 'done', playing.done(), 'time', playing.time.toFixed(1));
  console.log('log', playing.bodies.flatMap((b) => b.log).slice(0, 6).map((e) => JSON.stringify(e).slice(0, 300)));
});
