import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Body } from '@drawcall/animate';
import { beat } from '../src/beats/droids';
import { runBeat } from './run';

// Plays the droids beat headless and prints, every half second, R2's dome yaw and barrel pitch (degrees, against its facing), how many
// times its feet lifted, C-3PO's head yaw and his wrists' height; then a summary of every body's dev log (by check and place).
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const yawOf = (body: Body, bone: string) => {
  const ahead = new Vector3(0, 0, 1).applyQuaternion(body.pose.rotation(body.species.skeleton.index(bone)));
  const yaw = Math.atan2(ahead.x, ahead.z) - body.facing;
  return deg(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
};
const pitchOf = (body: Body, bone: string) => {
  const up = new Vector3(0, 1, 0).applyQuaternion(body.pose.rotation(body.species.skeleton.index(bone))).applyAxisAngle(new Vector3(0, 1, 0), -body.facing);
  return deg(Math.asin(up.z));
};

it('droids beat', () => {
  let lifts = 0;
  let planted = [true, true];
  const playing = runBeat(beat, ({ scene, time, bodies }) => {
    const artoo = bodies[7]!, threepio = bodies[6]!;
    const now = artoo.feet.map((foot) => foot.planted);
    if (now.some((p, i) => !p && planted[i])) lifts++;
    planted = now;
    if (Math.round(time * 60) % 30 === 0) {
      const wrist = threepio.pose.position(threepio.species.skeleton.index('rightHand'));
      console.log(time.toFixed(1), 'R2 dome', yawOf(artoo, 'dome'), 'barrel pitch', pitchOf(artoo, 'barrel'), 'lifts', lifts,
        '| 3PO head', yawOf(threepio, 'head'), 'chest pitch', pitchOf(threepio, 'chest'), 'wrist y', wrist.y.toFixed(2), '| R2 y', artoo.object.position.y.toFixed(2), scene.children.length);
    }
  });
  const summary: Record<string, string> = {};
  for (const body of playing.bodies)
    for (const e of body.log) {
      const key = `${body.species.name ?? '?'} ${e.check} @ ${e.where}`;
      summary[key] = `${(Number(summary[key]?.split(' ')[0] ?? 0) + 1)} first ${e.time.toFixed(2)} worst ${e.value.toFixed(3)} > ${e.limit}`;
    }
  console.log(summary);
  expect(playing.finished()).toBe(true);
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
});
