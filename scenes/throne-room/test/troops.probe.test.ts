import { it } from 'vitest';
import { Vector3 } from 'three';
import { BEATS } from '../src/beats';
import { runBeat } from './run';

// Probe: the troops beat headless, summarised (log entries, end state, how far each body's root and centre of mass drift).
it('troops probe', () => {
  const beat = BEATS.find((each) => each.id === 'troops')!;
  let worst = 0;
  let outside = 0;
  let where = '';
  const start = performance.now();
  const playing = runBeat(beat, (p) => {
    for (const body of p.bodies) {
      worst = Math.max(worst, body.object.position.distanceTo(body.position));
      // extrapolated centre of mass (Hof): com + v / sqrt(g / height), against the line between the feet (a swinging foot where it lands)
      const com = body.pose.com(new Vector3());
      const xcom = com.clone().addScaledVector(body.velocity, 1 / Math.sqrt(9.81 / com.y)).setY(0);
      const planted = body.feet.map((foot) => foot.position.clone().setY(0));
      if (!planted.length) continue;
      const [a, b] = [planted[0], planted[planted.length - 1]];
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() ? Math.min(1, Math.max(0, xcom.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
      const off = xcom.clone().sub(a.clone().addScaledVector(ab, t));
      if (off.length() > outside) {
        outside = off.length();
        const ahead = off.x * Math.sin(body.facing) + off.z * Math.cos(body.facing);
        where = `${body.object.name || 'cast'} at ${p.time.toFixed(2)} s, ${ahead.toFixed(3)} m ahead, planted ${planted.length}, speed ${body.velocity.length().toFixed(2)}`;
      }
    }
  });
  const log = playing.bodies.flatMap((body) => body.log.map((entry) => `${body.object.name}: ${JSON.stringify(entry).slice(0, 300)}`));
  console.log(`bodies ${playing.bodies.length}, time ${playing.time.toFixed(1)} s, ${((performance.now() - start) / (playing.time * 60)).toFixed(2)} ms/frame`);
  console.log(`finished ${playing.finished()} done ${playing.done()}; object-vs-position max ${worst.toFixed(3)} m; log ${log.length}; XCoM max from the feet line ${outside.toFixed(3)} m (${where})`);
  for (const check of new Set(log.map((line) => line.slice(0, 160)))) console.log(check);
});
