import { expect } from 'vitest';
import { Group, Vector3 } from 'three';
import { reach } from '@drawcall/animate';
import { lookAround, reaching, vr } from '../src/scenarios/tracking';
import type { Cast, Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { route } from '../src/keys';
import { run } from '../scripts/run';
import { cases } from '../../packages/animate/test/open';

// Open (expected to fail: each one fixed comes off the list), library defects:
// - a following reach (`until` given) whose target is out of reach on tiptoe as it sets off ends `false` in its first sub-step
//   (0.57 m over the shoulders, the limit 0.55 m), though `until` should end it, and never follows the target as it comes in reach: the
//   reach with its targets 10 cm higher stands with its hand down all through;
// - a following reach neither turns nor steps after its target as that leaves the arm's reach: its target going from beside the chest
//   to 1.8 m ahead over 3.5 s, the body stays where it stands, the hand 0.9 m short of it;
// - a tracked controller rising from the floor to over the head (0.08 → 1.93 m in 1.2 s, the headset rising from a crouch with it) is
//   left behind: the vr's left hand is 0.65–0.70 m below it at 8.5 s;
// - a reach to a point 6 cm off the floor stops with the wrist 8–10 cm above it, the body settled in a squat (the reach scene, 7–7.7 s);
// - looking round, the body turning back from behind brings its left upper arm 1.0–1.1 cm into the trunk at 15 s (dev log, limit 1 cm);
// - the reach's walk up to its far target sets off with the XCoM 10.5 cm outside the support at 15.0 s (dev log, limit 10 cm), at life seeds 0 and 3.
const test = cases([
  'a following reach whose target starts out of reach follows it once it comes in reach',
  'a following reach steps after a target leaving its reach',
  'tracked controllers rising from the floor to a cheer are followed',
  'reaches a point 6 cm off the floor',
  'looks around with an empty dev log',
  ['reaches round with an empty dev log', [0, 3]],
]);

/** a person reaching its right hand to `target` (a function of its time) until `until` s */
function following(target: (time: number) => Vector3, until: number, duration: number): Scenario {
  return {
    id: 'following', title: 'A following reach', duration,
    stage: (cast: Cast) => {
      const person = cast.person();
      return { scene: new Group(), bodies: [person], done: () => true, story: () => reach(person, { right: target }, { until }) };
    },
  };
}

/** the distance of the first person's `hand` (its wrist) from `target` at `time` s into `scenario` */
function offAt(scenario: Scenario, time: number, target: (sim: Simulation) => Vector3, hand: 'leftHand' | 'rightHand' = 'rightHand'): number {
  const sim = new Simulation(scenario);
  sim.advanceTo(time);
  return sim.people[0].bones[hand].getWorldPosition(new Vector3()).distanceTo(target(sim));
}

test('a following reach whose target starts out of reach follows it once it comes in reach', () => {
  const target = (time: number) => new Vector3(-0.25, time < 1 ? 2.05 : 1.4, 0.4);
  expect(offAt(following(target, 3, 3), 2.5, () => target(2.5))).toBeLessThan(0.03);
});

test('a following reach steps after a target leaving its reach', () => {
  const way = route([[0, [-0.25, 1.25, 0.45]], [3.5, [0, 1.25, 1.8]]]);
  expect(offAt(following((time) => way(time), 6, 6), 5.5, () => way(5.5))).toBeLessThan(0.05);
});

test('tracked controllers rising from the floor to a cheer are followed', () => {
  expect(offAt(vr(), 8.5, (sim) => sim.stage.scene.getObjectByName('left controller')!.position, 'leftHand')).toBeLessThan(0.15);
});

test('reaches a point 6 cm off the floor', () => {
  expect(offAt(reaching(), 7.5, (sim) => sim.stage.scene.getObjectByName('target')!.position)).toBeLessThan(0.03);
});

test('looks around with an empty dev log', () => {
  expect(run(lookAround())).toEqual([]);
});

test('reaches round with an empty dev log', () => {
  expect(run(reaching())).toEqual([]);
});
