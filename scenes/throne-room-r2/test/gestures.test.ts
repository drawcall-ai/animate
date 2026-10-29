import { type Object3D, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { Body } from '@drawcall/animate';
import { beat } from '../src/beats/gestures';
import { runBeat } from './run';

// The medal gestures read from a medium shot: each moves its joints visibly, Leia steps back without turning away, and every body
// stays in balance (its dev log empty).

/** a bone's turn in the body's own frame */
function turnOf(body: Body, bone: string): Quaternion {
  const world = (body.bones as Record<string, Object3D>)[bone].getWorldQuaternion(new Quaternion());
  return world.premultiply(body.object.getWorldQuaternion(new Quaternion()).invert());
}
/** the head's pitch in the body's frame (rad, + chin down) */
function headPitch(body: Body): number {
  const up = new Vector3(0, 1, 0).applyQuaternion(turnOf(body, 'head'));
  return Math.atan2(up.z, up.y);
}
/** the head's yaw in the body's frame (rad, + to its left) */
function headYaw(body: Body): number {
  const ahead = new Vector3(0, 0, 1).applyQuaternion(turnOf(body, 'head'));
  return Math.atan2(ahead.x, ahead.z);
}
/** a hand's height above the body's floor (m) */
function handHeight(body: Body): number {
  return (body.bones as Record<string, Object3D>).leftHand.getWorldPosition(new Vector3()).y - body.position.y;
}
/** how far a facing is from facing the doors (rad) */
const offDoors = (facing: number) => Math.abs(Math.atan2(Math.sin(facing - Math.PI), Math.cos(facing - Math.PI)));

it('plays the medal gestures visibly and in balance', async () => {
  const most = { lukeBow: -Infinity, hanTurn: Infinity, chewbaccaChinUp: Infinity, chewbaccaHands: -Infinity, leiaTurnedAway: 0 };
  let rest: { lukePitch: number; chewbaccaHands: number } | undefined;
  const playing = await runBeat(beat, ({ bodies }) => {
    const [luke, han, chewbacca, leia] = bodies;
    rest ??= { lukePitch: headPitch(luke), chewbaccaHands: handHeight(chewbacca) };
    most.lukeBow = Math.max(most.lukeBow, headPitch(luke));
    most.hanTurn = Math.min(most.hanTurn, headYaw(han)); // Leia is to his right
    most.chewbaccaChinUp = Math.min(most.chewbaccaChinUp, headPitch(chewbacca));
    most.chewbaccaHands = Math.max(most.chewbaccaHands, handHeight(chewbacca));
    most.leiaTurnedAway = Math.max(most.leiaTurnedAway, offDoors(leia.facing));
  });
  expect(playing.done()).toBe(true);
  // (R2-D2 is made outside this beat, by another part of the scene: its own log is its own)
  expect(playing.bodies.slice(0, 7).flatMap((body) => body.log)).toEqual([]);
  // Luke's head goes down a clear 30°, not onto his chest
  expect(most.lukeBow - rest!.lukePitch).toBeGreaterThan(0.5);
  expect(most.lukeBow - rest!.lukePitch).toBeLessThan(0.95);
  // Han's head comes round toward Leia
  expect(most.hanTurn).toBeLessThan(-0.3);
  // Chewbacca's chin goes well up and his hands rise
  expect(most.chewbaccaChinUp).toBeLessThan(-0.4);
  expect(most.chewbaccaHands - rest!.chewbaccaHands).toBeGreaterThan(0.05);
  // Leia steps to and from each hero facing the doors (her steps forward and back never turn her more than a quarter turn)
  expect(most.leiaTurnedAway).toBeLessThan(Math.PI / 2);
}, 120_000);
