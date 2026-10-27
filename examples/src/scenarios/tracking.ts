import { Euler, Group, MathUtils, Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { lookAt, reach, track, wait, walkTo } from '@drawcall/animate';
import { destination, route, scalar, type Way } from '../keys';
import type { Person, Scenario } from '../scenario';
import { ball, box } from '../things';

// Keyframed trackers, as a VR headset and controllers record them: a hand, the head, or the head and both hands. The body
// follows them; the reaching scene also leads its walk by the next recorded waypoint.

/** the standing skull-centre height the head and controller tracks were recorded at (m) */
const RECORDED = 1.6;
const UP = new Vector3(0, 1, 0);

/**
 * A recording played a little otherwise: faster (`pace` > 1) or slower, turned round the start (rad), and what it goes to — the low
 * points the head goes down to, the hands' targets (a controller's in the air) — moved along the floor (m) and up or down (m).
 */
export interface Variation {
  pace?: number;
  turn?: number;
  shift?: { x: number; z: number };
  rise?: number;
}

/** keys whose points `which` says to (and their ways' via points) moved by `shift` and `rise` */
function moved(ways: Way[], { shift = { x: 0, z: 0 }, rise = 0 }: Variation, which: (height: number) => boolean): Way[] {
  const by = ([x, y, z]: [number, number, number]): [number, number, number] => [x + shift.x, y + rise, z + shift.z];
  return ways.map(([time, to, via]): Way => (which(to[1]) ? [time, by(to), via && by(via)] : [time, to, via]));
}

/**
 * how `person` plays a recording varied by `variation`: its time at the body's `time`, and a recorded point where it is played (in
 * place: its height scaled to the body, as a headset is calibrated to its wearer, and turned round the start)
 */
function playback(person: Person, { pace = 1, turn = 0 }: Variation) {
  const proportions = person.species.person!;
  const heightScale = (proportions.eyeHeight - proportions.eyes.y + proportions.headCenter.y) / RECORDED;
  return {
    time: (time: number) => time * pace,
    place: (point: Vector3) => point.setY(point.y * heightScale).applyAxisAngle(UP, turn),
  };
}

/**
 * a headset recording as `device` where it is at the body's time: the eyes' middle, turned as the head is — the skull centre on
 * `centre`, turned `yaw` and pitched `pitch`
 */
function headset(person: Person, variation: Variation, device: Object3D, centre: (t: number, out: Vector3) => Vector3, yaw: (t: number) => number, pitch: (t: number) => number) {
  const play = playback(person, variation);
  const proportions = person.species.person!;
  const eyesFromCentre = proportions.eyes.clone().sub(proportions.headCenter);
  return (time: number) => {
    const recorded = play.time(time);
    play.place(centre(recorded, device.position));
    device.quaternion.setFromEuler(new Euler(pitch(recorded), yaw(recorded) + (variation.turn ?? 0), 0, 'YXZ'));
    device.position.add(eyesFromCentre.clone().applyQuaternion(device.quaternion));
    return device;
  };
}

/** a controller recording as `marker`'s point at the body's time: the recorded point on `keys`, `paint` added */
function controller(person: Person, variation: Variation, marker: Object3D, keys: (t: number, out: Vector3) => Vector3, paint = (_t: number, point: Vector3) => point) {
  const play = playback(person, variation);
  return (time: number) => play.place(paint(play.time(time), keys(play.time(time), marker.position)));
}

/** whether the eyes are on the headset (within 3 cm), the body come to rest facing `facing` (within 0.3 rad) */
function underHeadset(person: Person, device: Object3D, facing: number): boolean {
  const gaze = person.species.gaze;
  if (!gaze) throw new Error('tracking: the person needs eyes');
  const eyes = gaze.eyes(person.pose, new Vector3());
  return eyes.distanceTo(device.position) < 0.03 && person.settled && Math.abs(Math.atan2(Math.sin(person.facing - facing), Math.cos(person.facing - facing))) < 0.3;
}

/** a headset's shape (m) */
const HEADSET = new Vector3(0.17, 0.09, 0.1);

/** Only a head is tracked: looking round past the neck's range, down at something low behind, squatting to it. */
export function lookAround(variation: Variation = {}): Scenario {
  const pace = variation.pace ?? 1;
  const behind = -2.6;
  const [behindX, behindZ] = [Math.sin(behind), Math.cos(behind)];
  // (the skull centre, going down behind: its low points moved by the variation)
  const centre = route(moved([
    [0, [0, 1.6, 0.05]], [7, [0, 1.6, 0.05]],
    [8.5, [behindX * 0.3, 1.42, behindZ * 0.3]], [9.6, [behindX * 0.3, 1.42, behindZ * 0.3]],
    [11.2, [behindX * 0.28, 1.0, behindZ * 0.28]], [12.2, [behindX * 0.28, 1.0, behindZ * 0.28]],
    [13.8, [behindX * 0.05, 1.6, behindZ * 0.05]],
  ], variation, (height) => height < 1.5));
  // (round to the left, to the right, and round behind; then back)
  const yaw = scalar([[0.5, 0], [2, 1.1], [3, 1.1], [4.5, -1.1], [5.2, -1.1], [6.8, behind], [13.8, behind], [15.5, 0]]);
  const pitch = scalar([[7, 0], [8.5, 0.75], [9.6, 0.75], [11.2, 0.25], [12.2, 0.25], [13.8, 0]]);
  return {
    id: 'look-around',
    title: 'Head tracking only',
    description:
      'Only a head pose is given (like a VR headset). Looking beyond the neck’s range turns the trunk and then the feet; lowering the head bows, then squats.',
    duration: 15.5 / pace + 3,
    stage: (cast) => {
      const person = cast.person();
      const scene = new Group();
      const device = box(scene, 'headset', HEADSET, new Vector3());
      return {
        scene,
        bodies: [person],
        story: () => track(person, { head: headset(person, variation, device, centre, yaw, pitch) }, { until: Infinity }),
        // (upright under the headset, facing as it does at the end)
        done: () => underHeadset(person, device, variation.turn ?? 0),
      };
    },
  };
}

/** the right controller paints one and a half circles in front of the chest (m), between `from` and `to` (s), blended in and out */
function painting(from: number, to: number, radius: number) {
  return (t: number, point: Vector3) => {
    if (t <= from || t >= to) return point;
    const angle = ((t - from) / (to - from)) * Math.PI * 2 * 1.5;
    const blend = MathUtils.smoothstep(t, from, from + 0.5) * (1 - MathUtils.smoothstep(t, to - 0.5, to));
    return point.add(new Vector3(Math.sin(angle), Math.cos(angle) - 1, 0).multiplyScalar(radius * blend));
  };
}

/** Three-point tracking (a headset and two controllers): painting a circle, crouching to the floor, cheering, side-stepping. */
export function vr(variation: Variation = {}): Scenario {
  const pace = variation.pace ?? 1;
  const centre = route([
    [0, [0, 1.6, 0.04]], [1, [0, 1.58, 0.07]], [5, [0, 1.58, 0.07]], [6.3, [0, 0.9, 0.3]],
    [7.6, [0, 0.9, 0.3]], [8.8, [0, 1.62, 0.02]], [10, [0, 1.62, 0.02]], [12.7, [0.9, 1.6, 0.06]],
  ]);
  const pitch = scalar([[0, 0], [1, 0.2], [5, 0.2], [6.3, 0.6], [7.6, 0.6], [8.8, -0.35], [9.8, -0.35], [10.5, 0.1]]);
  // (the hands: raised, down to the floor, up in a cheer, out to the side-step; their targets in the air past where they start moved
  // by the variation, the floor's staying where it is)
  const hands = (keys: Way[]) => route([keys[0], ...moved(keys.slice(1), variation, (height) => height > 0.5)]);
  const left = hands([
    [0, [0.22, 0.88, 0.08]], [1, [0.25, 1.1, 0.3]], [5, [0.25, 1.1, 0.3]], [6.3, [0.17, 0.08, 0.46]], [7.6, [0.17, 0.08, 0.46]],
    [8.8, [0.3, 1.93, 0.1]], [10, [0.3, 1.93, 0.1]], [10.8, [0.2, 1.1, 0.35]], [12.7, [1.1, 1.1, 0.35]],
  ]);
  const right = hands([
    [0, [-0.22, 0.88, 0.08]], [1, [-0.1, 1.35, 0.45]], [5, [-0.1, 1.35, 0.45]], [6.3, [-0.17, 0.08, 0.46]], [7.6, [-0.17, 0.08, 0.46]],
    [8.8, [-0.3, 1.93, 0.1]], [10, [-0.3, 1.93, 0.1]], [10.8, [-0.2, 1.1, 0.35]], [12.7, [0.7, 1.1, 0.35]],
  ]);
  return {
    id: 'vr',
    title: 'VR: head + hands',
    description:
      'Three-point tracking like a VR headset and controllers: painting a circle, crouching to the floor, cheering, then side-stepping. Pelvis, spine, legs and steps are inferred.',
    duration: 12.7 / pace + 2,
    stage: (cast) => {
      const person = cast.person();
      const scene = new Group();
      const device = box(scene, 'headset', HEADSET, new Vector3());
      const controllers = { left: ball(scene, 'left controller', 0.03, new Vector3()), right: ball(scene, 'right controller', 0.03, new Vector3()) };
      const onController = (side: 'left' | 'right') => person.bones[`${side}Hand`].getWorldPosition(new Vector3()).distanceTo(controllers[side].position) < 0.03;
      return {
        scene,
        bodies: [person],
        story: () => track(person, {
          head: headset(person, variation, device, centre, () => 0, pitch),
          left: controller(person, variation, controllers.left, left),
          right: controller(person, variation, controllers.right, right, painting(1.3, 4.8, 0.22)),
        }, { until: Infinity }),
        // (stood under the headset where the side-step took it, the hands on the controllers)
        done: () => underHeadset(person, device, variation.turn ?? 0) && onController('left') && onController('right'),
      };
    },
  };
}

/** how far ahead of the hand the eyes go (s) */
const GLANCE = 0.35;

/** One hand reaching round: high, across the body, to the floor, behind, far ahead; the body comes along as it must. */
export function reaching(variation: Variation = {}): Scenario {
  const { pace = 1, turn = 0 } = variation;
  // (the targets, each reached at a pace a calm hand keeps up with (a minimum-jerk move of L m peaks at 1.875 L / T m/s), down to the
  // floor no faster than the body squats, swung round the body to behind it and back out: all moved by the variation)
  const ways = moved([
    [1.8, [-0.25, 1.95, 0.4]], [2.6, [-0.25, 1.95, 0.4]],
    [4.0, [0.3, 1.0, 0.4]], [4.7, [0.3, 1.0, 0.4]],
    [6.9, [-0.35, 0.06, 0.55]], [7.7, [-0.35, 0.06, 0.55]],
    [9.8, [-0.55, 1.2, -0.6], [-0.75, 0.7, 0.0]], [10.6, [-0.55, 1.2, -0.6]],
    [14.1, [0.0, 1.25, 1.8], [-0.95, 1.3, 0.5]],
  ], variation, () => true);
  /** when the target stops far ahead (s) */
  const stops = ways[ways.length - 1][0] / pace;
  return {
    id: 'reach',
    title: 'Reaching around (one hand)',
    description:
      'A single wrist target visits points high, across the body, on the floor, behind and far away. The body shrugs, bends, squats, turns and steps as needed; the eyes lead the hand.',
    duration: stops + 4,
    stage: (cast) => {
      const person = cast.person();
      const scene = new Group();
      const marker = ball(scene, 'target', 0.035, new Vector3());
      let reached = false;
      return {
        scene,
        bodies: [person],
        story: function* () {
          yield* wait(0.4 / pace);
          const hanging = person.bones.rightHand.getWorldPosition(new Vector3()).applyAxisAngle(UP, -turn);
          const wrist = route([[0.4, [hanging.x, hanging.y, hanging.z]], ...ways]);
          const target = (time: number, out: Vector3) => wrist(time * pace, out).applyAxisAngle(UP, turn);
          let time = 0;
          const followed = (now: number) => {
            time = now;
            return target(now, marker.position);
          };
          const next = destination(ways), stand = person.position.clone().setY(0);
          let facing = person.facing, turning = false;
          const proportions = person.species.person;
          if (!proportions) throw new Error('the reach recording needs a person');
          // (the body anticipates the next recorded waypoint: turn toward it and step before the arm runs out of reach)
          const comeAlong = (time: number) => {
            const ahead = next(time * pace).applyAxisAngle(UP, turn);
            const beside = new Vector3(-Math.cos(facing), 0, Math.sin(facing)).multiplyScalar(proportions.shoulderHalfWidth);
            const shoulder = stand.clone().add(beside);
            const toward = Math.atan2(ahead.x - shoulder.x, ahead.z - shoulder.z);
            const off = Math.abs(Math.atan2(Math.sin(toward - facing), Math.cos(toward - facing)));
            turning = off > (turning ? 0.3 : 0.7);
            if (turning) facing = toward;
            beside.set(-Math.cos(facing), 0, Math.sin(facing)).multiplyScalar(proportions.shoulderHalfWidth);
            shoulder.copy(stand).add(beside);
            if (Math.hypot(ahead.x - shoulder.x, ahead.z - shoulder.z) > 0.95 * proportions.armLength) {
              const back = shoulder.sub(ahead).setY(0).normalize();
              stand.copy(ahead).setY(0).addScaledVector(back, 0.55 * proportions.armLength).sub(beside);
            }
            return stand;
          };
          yield* parallel('race',
            function* () {
              // (follow the target until it stops far ahead, and the wrist is on it)
              reached = yield* reach(person, { right: followed }, { speed: 2,
                until: () => time >= stops && person.bones.rightHand.getWorldPosition(new Vector3()).distanceTo(marker.position) < 0.01 });
            },
            walkTo(person, comeAlong, { speed: 1.3 * pace, accel: 1.2 * pace ** 2, until: Infinity,
              face: () => person.position.clone().add(new Vector3(Math.sin(facing), 0, Math.cos(facing))) }),
            // (the eyes lead the hand: where it is going a moment on)
            lookAt(person, (time) => target(time + GLANCE / pace, new Vector3())),
          );
        },
        // (the hand on the far target once it stopped there)
        done: () => reached,
      };
    },
  };
}
