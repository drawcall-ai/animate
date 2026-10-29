import { expect, it } from 'vitest';
import { beat as entrance } from '../src/beats/procession';
import { beat as finale } from '../src/beats/finale';
import { runBeat } from './run';

// The entrance keeps its line abreast: the three side by side the whole way up the aisle (none more than 0.6 m ahead of another),
// each in its own lane, and takes about the film's half a minute to the foot of the steps.
it('walks up the aisle as a line abreast', async () => {
  let worstAhead = 0, worstLane = 0, atSteps = 0, slowest = Infinity;
  const playing = await runBeat(entrance, ({ bodies, time }) => {
    const [luke, han, chewbacca] = bodies;
    if (luke.position.z > 3 && luke.position.z < 33.6) slowest = Math.min(slowest, ...[luke, han, chewbacca].map((body) => body.velocity.length()));
    if (luke.position.z < 2.5 || luke.position.z > 32) return;
    const zs = [luke, han, chewbacca].map((body) => body.position.z);
    const ahead = Math.max(...zs) - Math.min(...zs);
    worstAhead = Math.max(worstAhead, ahead);
    worstLane = Math.max(worstLane, Math.abs(luke.position.x), Math.abs(han.position.x - 1.1), Math.abs(chewbacca.position.x + 1.22));
    if (!atSteps && luke.position.z > 31.5) atSteps = time;
  });
  console.log({ slowest, worstAhead, worstLane, atSteps, end: playing.time, log: playing.bodies.flatMap((b) => b.log).slice(0, 5) });
  expect(playing.done()).toBe(true);
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
  expect(worstAhead).toBeLessThan(0.6);
  expect(worstLane).toBeLessThan(0.15);
  // (no dead stop where the aisle walk hands over to the climb)
  expect(slowest).toBeGreaterThan(0.3);
  expect(atSteps).toBeGreaterThan(25);
  expect(atSteps).toBeLessThan(40);
});

it('turns to face the hall', async () => {
  const playing = await runBeat(finale);
  console.log({ end: playing.time, log: playing.bodies.flatMap((b) => b.log).slice(0, 5) });
  expect(playing.done()).toBe(true);
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
});
