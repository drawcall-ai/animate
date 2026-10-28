import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { wait, type Body, type Verb } from '@drawcall/animate';
import { parallel } from '@pmndrs/timeline';
import { play } from '../src/play';
import { bowForMedal, cockyWink, roar, stepBackAndNod } from '../src/gestures';
import type { Beat } from '../src/beats';

// Plays each gesture on its own body and prints how far the head and chest turn (degrees) over time, so the gestures can be tuned
// by numbers before they are judged in the viewer. Every body must stay quiet in its dev log (balance included).
const deg = (r: number) => Math.round((r * 180) / Math.PI);
function angles(body: Body, name: string): string {
  const q = body.pose.rotation(body.species.skeleton.index(name));
  const ahead = new Vector3(0, 0, 1).applyQuaternion(q);
  const side = new Vector3(1, 0, 0).applyQuaternion(q);
  const yaw = Math.atan2(ahead.x, ahead.z) - body.facing;
  return `${name} down ${deg(-Math.asin(ahead.y))} yaw ${deg(Math.atan2(Math.sin(yaw), Math.cos(yaw)))} roll ${deg(Math.asin(side.y))}`;
}

it('gestures', () => {
  const results: Record<string, boolean> = {};
  let bodies: Record<'luke' | 'han' | 'chewbacca' | 'leia', Body> | undefined;
  const record = (name: string, verb: Verb) =>
    (function* () {
      results[name] = yield* verb;
    })();
  const beat: Beat = {
    id: 'gestures-probe',
    title: 'gestures probe',
    duration: 12,
    starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
    stage: ({ cast }) => {
      const { luke, han, chewbacca, leia } = cast;
      bodies = { luke, han, chewbacca, leia };
      return {
        done: () => Object.values(results).every(Boolean),
        story: function* () {
          yield* wait(0.5);
          yield* parallel(
            'all',
            record('bow', bowForMedal(luke, leia, { until: 1.5 })),
            record('wink', cockyWink(han, leia)),
            record('roar', roar(chewbacca)),
            record('step back', stepBackAndNod(leia, luke)),
          );
          yield* wait(1);
        },
      };
    },
  };
  const playing = play(beat);
  const { luke, han, chewbacca, leia } = bodies!;
  for (let frame = 0; frame < 60 * beat.duration && !playing.finished(); frame++) {
    playing.step(1 / 60);
    if (frame % 15 === 0)
      console.log(
        playing.time.toFixed(2),
        `\n  luke ${angles(luke, 'head')} | ${angles(luke, 'chest')}`,
        `\n  han  ${angles(han, 'head')} | ${angles(han, 'chest')}`,
        `\n  chew ${angles(chewbacca, 'head')} | ${angles(chewbacca, 'chest')} | ${angles(chewbacca, 'leftUpperArm')}`,
        `\n  leia ${angles(leia, 'head')} at ${leia.position.toArray().map((v) => v.toFixed(2))} facing ${deg(leia.facing)}`,
      );
  }
  console.log(results);
  expect(playing.finished()).toBe(true);
  expect(results).toEqual({ bow: true, wink: true, roar: true, 'step back': true });
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
});
