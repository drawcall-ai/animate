import { expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import type { Body } from '@drawcall/animate';
import { BEATS } from '../src/beats';
import { runBeat } from './run';

// The droids' beat as the film has them: R2-D2 rocks on its planted feet (harder when excited) and turns its dome to what is going on;
// C-3PO turns his head to it and fusses with his hands.

/** how far (rad, horizontally) `bone`'s +Z is turned off the way to `target`'s head */
function aimError(bone: import('three').Object3D, target: Body): number {
  const forward = new Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
  const to = target.bones.head.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3()));
  const error = Math.atan2(forward.x, forward.z) - Math.atan2(to.x, to.z);
  return Math.abs(Math.atan2(Math.sin(error), Math.cos(error)));
}

it('the droids rock, look and fuss through the ceremony', async () => {
  const beat = BEATS.find((each) => each.id === 'droids')!;
  let unplanted = 0;
  const roll = { calm: [Infinity, -Infinity], excited: [Infinity, -Infinity] };
  const roarAims = { artoo: [] as number[], threepio: [] as number[] };
  const wrist = { min: Infinity, max: -Infinity };
  const euler = new Euler();
  const playing = await runBeat(beat, (playing) => {
    const [, , chewbacca, , , , threepio, artoo] = playing.bodies;
    if (artoo.feet.some((foot) => !foot.planted)) unplanted++;
    euler.setFromQuaternion(artoo.bones.body.getWorldQuaternion(new Quaternion()), 'YXZ');
    const roaring = chewbacca.owners.trunk?.verb === 'pose' && playing.time > 20;
    // calm while the heroes are still well down the aisle (the first 8 s); excited as Chewbacca roars
    const range = roaring ? roll.excited : playing.time < 8 ? roll.calm : undefined;
    if (range) {
      range[0] = Math.min(range[0], euler.z);
      range[1] = Math.max(range[1], euler.z);
    }
    if (roaring) {
      roarAims.artoo.push(aimError(artoo.bones.dome, chewbacca));
      roarAims.threepio.push(aimError(threepio.bones.head, chewbacca));
    }
    // (once his hands have come up from hanging at his sides)
    if (playing.time < 3) return;
    const hand = threepio.bones.leftHand.getWorldPosition(new Vector3()).y;
    wrist.min = Math.min(wrist.min, hand);
    wrist.max = Math.max(wrist.max, hand);
  });
  const onTarget = (errors: number[]) => errors.slice(60).filter((error) => error < 0.3).length / (errors.length - 60);
  console.log({ roll, artooOnTarget: onTarget(roarAims.artoo), threepioOnTarget: onTarget(roarAims.threepio), wristLift: wrist.max - wrist.min });
  expect(playing.done()).toBe(true);
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
  // R2 rocks in place: its feet stay planted, its body rolls side to side, wider when excited
  expect(unplanted).toBe(0);
  expect(roll.calm[1] - roll.calm[0]).toBeGreaterThan(0.06);
  expect(roll.excited[1] - roll.excited[0]).toBeGreaterThan(roll.calm[1] - roll.calm[0]);
  // both turn to Chewbacca as he roars (after the turn's first second; R2's dome glances off now and then)
  expect(onTarget(roarAims.artoo)).toBeGreaterThan(0.5);
  expect(onTarget(roarAims.threepio)).toBeGreaterThan(0.8);
  // C-3PO's hands fuss: a hand lifts a few centimetres now and then
  expect(wrist.max - wrist.min).toBeGreaterThan(0.03);
  expect(wrist.max - wrist.min).toBeLessThan(0.15);
});
