import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { leftOf, wrapAngle, handTo, headTo, lookAt, release, type Frame, type Humanoid, type Placement, type Target, yawOf } from '@drawcall/animate';
import { SHIFT, ask, type Asks, idle, reached } from '@drawcall/animate/rig';
import { destination, route, scalar, type Way } from '../keys';
import { Report, reported, reporting } from '../report';
import type { Prop, Scenario } from '../scenario';

const { smoothstep } = MathUtils;

// Keyframed trackers, as a VR headset and controllers record them: a hand, the head, or the head
// and both hands. Nobody scripts the body: it comes along under them.

/** the standing skull-centre height the head tracks were recorded at (m) */
const RECORDED = 1.6;
const UP = new Vector3(0, 1, 0);

/**
 * A recording played a little otherwise: faster (`pace` > 1) or slower, turned round the start
 * (rad), and what it goes to — the low points the head goes down to, the hands' targets (a
 * controller's in the air) — moved along the floor (m) and up or down (m).
 */
export interface Variation {
  pace?: number;
  turn?: number;
  shift?: { x: number; z: number };
  rise?: number;
}

/** how a variation plays a recording: its time at the body's `t`, a recorded point where it is played (in place) */
function playback({ pace = 1, turn = 0 }: Variation) {
  return {
    time: (t: number) => t * pace,
    place: (at: Vector3) => at.applyAxisAngle(UP, turn),
  };
}

/** keys whose points `which` says to (and their ways' via points) moved by `shift` and `rise` */
function moved(ways: Way[], { shift = { x: 0, z: 0 }, rise = 0 }: Variation, which: (y: number) => boolean): Way[] {
  const by = ([x, y, z]: [number, number, number]): [number, number, number] => [x + shift.x, y + rise, z + shift.z];
  return ways.map(([t, to, via]): Way => (which(to[1]) ? [t, by(to), via && by(via)] : [t, to, via]));
}

/** a headset's recorded skull centre's height scaled to this body (a headset is calibrated to its wearer) */
const heightScale = (h: Humanoid) => (h.proportions.eyeHeight - h.proportions.eyes.y + h.proportions.headCenter.y) / RECORDED;

/**
 * a headset recording as where the eyes are and the head is turned (into one placement): the skull
 * centre at `center`'s point, its height scaled to the body, turned `yaw` then pitched `pitch`
 */
function headset(h: Humanoid, v: Variation, center: (t: number, out: Vector3) => Vector3, yaw: (t: number) => number, pitch: (t: number) => number, out: Required<Placement>): (f: Frame) => Required<Placement> {
  const play = playback(v);
  const p = h.proportions;
  const k = heightScale(h);
  return (f) => {
    const t = play.time(f.time);
    center(t, out.position).y *= k;
    play.place(out.position);
    out.quaternion.setFromEuler(_euler.set(pitch(t), yaw(t) + (v.turn ?? 0), 0, 'YXZ'));
    out.position.add(_v.subVectors(p.eyes, p.headCenter).applyQuaternion(out.quaternion));
    return out;
  };
}

/** the eyes on the head's tracked placement at the end (m), the body come to rest facing as it does (rad) */
function underHead(h: Humanoid, head: Required<Placement>): boolean {
  const eyes = h.pose.point(h.rig.skeleton.index('head'), h.proportions.eyes, new Vector3());
  return eyes.distanceTo(head.position) < 0.03 && h.locomotion.settled && Math.abs(wrapAngle(yawOf(head.quaternion) - h.locomotion.facing)) < 0.3;
}

/** Only a head is tracked: looking round past the neck's range, down at something low behind, squatting to it. */
export function lookAround(v: Variation = {}): Scenario {
  const pace = v.pace ?? 1;
  const back = -2.6;
  const [bx, bz] = [Math.sin(back), Math.cos(back)];
  const center = route(
    moved(
      [
        [0, [0, 1.6, 0.05]],
        [7, [0, 1.6, 0.05]],
        [8.5, [bx * 0.3, 1.42, bz * 0.3]],
        [9.6, [bx * 0.3, 1.42, bz * 0.3]],
        [11.2, [bx * 0.28, 1.0, bz * 0.28]],
        [12.2, [bx * 0.28, 1.0, bz * 0.28]],
        [13.8, [bx * 0.05, 1.6, bz * 0.05]],
      ],
      v,
      (y) => y < 1.5,
    ),
  );
  const yaw = scalar([
    [0.5, 0],
    [2, 1.1],
    [3, 1.1],
    [4.5, -1.1],
    [5.2, -1.1],
    [6.8, back],
    [13.8, back],
    [15.5, 0],
  ]);
  const pitch = scalar([
    [7, 0],
    [8.5, 0.75],
    [9.6, 0.75],
    [11.2, 0.25],
    [12.2, 0.25],
    [13.8, 0],
  ]);
  return {
    id: 'look-around',
    title: 'Head tracking only',
    description:
      'Only a head pose is given (like a VR headset). Looking beyond the neck’s range turns the trunk and then the feet; lowering the head bows, then squats.',
    duration: 15.5 / pace + 3,
    actors: [{}],
    stage: () => {
      const report = new Report();
      const head = { position: new Vector3(), quaternion: new Quaternion() };
      let body: Humanoid | null = null;
      return {
        report,
        props: () => [],
        done: () => !!body && underHead(body, head),
        script: (h) =>
          function* () {
            body = h;
            yield* parallel<Frame>('all', idle(h), headTo(h, reported(report, 'head', headset(h, v, center, yaw, pitch, head)), { lead: true }));
          },
      };
    },
  };
}

/** controllers are followed briskly (m/s², m/s): they are where the hands are, only a jump braked; under a tracked head they only follow */
const CONTROLLER = { accel: 30, speed: 4, turnAccel: 200, turnSpeed: 15, lead: false };

/**
 * a controller recording as a wrist target (into `out`, with its velocity): the recorded point,
 * its height scaled to the body, `paint` added
 */
function controller(h: Humanoid, v: Variation, track: (t: number, out: Vector3) => Vector3, out: Target & { velocity: Vector3 }, paint: (t: number, out: Vector3) => Vector3 = (_, o) => o): (f: Frame) => Target {
  const play = playback(v);
  const k = heightScale(h);
  const at = (t: number, into: Vector3) => {
    paint(t, track(t, into));
    into.y *= k;
    return play.place(into);
  };
  return (f) => {
    const t = play.time(f.time);
    at(t, out.position);
    // (its velocity, as the recording moves on)
    out.velocity.subVectors(at(play.time(f.time + f.dt), _w), at(play.time(f.time - f.dt), _u)).divideScalar(2 * f.dt);
    return out;
  };
}

/** the right controller paints one and a half circles in front of the chest (m), between `from` and `to` (s), blended in and out */
function painting(from: number, to: number, radius: number) {
  return (t: number, out: Vector3) => {
    if (t <= from || t >= to) return out;
    const a = ((t - from) / (to - from)) * Math.PI * 2 * 1.5;
    const w = smoothstep(t, from, from + 0.5) * (1 - smoothstep(t, to - 0.5, to));
    return out.add(_paint.set(radius * Math.sin(a) * w, radius * (Math.cos(a) - 1) * w, 0));
  };
}

/** Three-point tracking (a headset and two controllers): painting a circle, crouching to the floor, cheering, side-stepping. */
export function vr(v: Variation = {}): Scenario {
  const pace = v.pace ?? 1;
  const center = route([
    [0, [0, 1.6, 0.04]],
    [1, [0, 1.58, 0.07]],
    [5, [0, 1.58, 0.07]],
    [6.3, [0, 0.9, 0.3]],
    [7.6, [0, 0.9, 0.3]],
    [8.8, [0, 1.62, 0.02]],
    [10, [0, 1.62, 0.02]],
    [12.7, [0.9, 1.6, 0.06]],
  ]);
  const pitch = scalar([
    [0, 0],
    [1, 0.2],
    [5, 0.2],
    [6.3, 0.6],
    [7.6, 0.6],
    [8.8, -0.35],
    [9.8, -0.35],
    [10.5, 0.1],
  ]);
  // (the hands' targets in the air, past where they start, moved by the variation: the floor stays where it is)
  const hands = (keys: Way[]) => route([keys[0], ...moved(keys.slice(1), v, (y) => y > 0.5)]);
  const left = hands([
    [0, [0.22, 0.88, 0.08]],
    [1, [0.25, 1.1, 0.3]],
    [5, [0.25, 1.1, 0.3]],
    [6.3, [0.17, 0.08, 0.46]],
    [7.6, [0.17, 0.08, 0.46]],
    [8.8, [0.3, 1.93, 0.1]],
    [10, [0.3, 1.93, 0.1]],
    [10.8, [0.2, 1.1, 0.35]],
    [12.7, [1.1, 1.1, 0.35]],
  ]);
  const right = hands([
    [0, [-0.22, 0.88, 0.08]],
    [1, [-0.1, 1.35, 0.45]],
    [5, [-0.1, 1.35, 0.45]],
    [6.3, [-0.17, 0.08, 0.46]],
    [7.6, [-0.17, 0.08, 0.46]],
    [8.8, [-0.3, 1.93, 0.1]],
    [10, [-0.3, 1.93, 0.1]],
    [10.8, [-0.2, 1.1, 0.35]],
    [12.7, [0.7, 1.1, 0.35]],
  ]);
  return {
    id: 'vr',
    title: 'VR: head + hands',
    description:
      'Three-point tracking like a VR headset and controllers: painting a circle, crouching to the floor, cheering, then side-stepping. Pelvis, spine, legs and steps are inferred.',
    duration: 12.7 / pace + 2,
    actors: [{}],
    stage: () => {
      const report = new Report();
      const head = { position: new Vector3(), quaternion: new Quaternion() };
      const wrists = { left: { position: new Vector3(), velocity: new Vector3() }, right: { position: new Vector3(), velocity: new Vector3() } };
      let body: Humanoid | null = null;
      return {
        report,
        props: () => [wrists.left, wrists.right].map((w): Prop => ({ kind: 'ball', position: w.position.clone(), radius: 0.03 })),
        // (stood under the head where the side-step took it, the hands on the controllers)
        done: () => !!body && underHead(body, head) && (['left', 'right'] as const).every((s) => body!.pose.position(body!.rig.skeleton.index(`${s}Hand`)).distanceTo(wrists[s].position) < 0.03),
        script: (h) =>
          function* () {
            body = h;
            yield* parallel<Frame>(
              'all',
              idle(h),
              headTo(h, reported(report, 'head', headset(h, v, center, () => 0, pitch, head)), { lead: true }),
              handTo(h, 'left', reported(report, 'leftWrist', controller(h, v, left, wrists.left)), CONTROLLER),
              handTo(h, 'right', reported(report, 'rightWrist', controller(h, v, right, wrists.right, painting(1.3, 4.8, 0.22))), CONTROLLER),
            );
          },
      };
    },
  };
}

/**
 * How a hand's target leads the body (example-only: the reach's own choreography): once it is round
 * beside, across or behind the body (rad off its facing, from the shoulder), the body turns after it
 * (rad/s) until it faces it (rad); once it is out of the shoulder's reach across the floor (× the
 * arm's length), the body walks to stand with the shoulder that far from it (× the arm's length), at
 * a walk (m/s, m/s², at the recording's pace).
 */
// Follow before full extension so offset reach targets stay within wrist range while the trunk turns.
const LEADS = { round: 0.7, faced: 0.3, turn: 2.0, out: 0.95, stand: 0.55, speed: 1.3, accel: 1.2 };

/** what a hand's target `target` asks of the body for hand `side` (see LEADS), every sub-step */
function comeAlong(h: Humanoid, side: 'left' | 'right', target: (f: Frame) => Vector3, pace: number): (f: Frame) => Partial<Asks> {
  const p = h.proportions;
  const sign = side === 'left' ? 1 : -1;
  const go = { to: new Vector3(NaN, 0, 0), speed: LEADS.speed * pace, accel: LEADS.accel * pace ** 2 };
  const face = { yaw: NaN, rate: LEADS.turn * pace };
  let turning = false;
  return (f) => {
    const spot = go.to;
    if (Number.isNaN(face.yaw)) [face.yaw, spot.x, spot.z] = [h.locomotion.facing, f.prev.com(_w).x, _w.z];
    const at = target(f);
    // (round as the shoulder sees it: across the body is round too)
    const toward = Math.atan2(at.x - spot.x - leftOf(face.yaw, _u).x * sign * p.shoulderHalfWidth, at.z - spot.z - _u.z * sign * p.shoulderHalfWidth);
    const off = Math.abs(wrapAngle(toward - face.yaw));
    turning = off > (turning ? LEADS.faced : LEADS.round);
    if (turning) face.yaw = toward;
    const beside = leftOf(face.yaw, _u).multiplyScalar(sign * p.shoulderHalfWidth);
    const shoulder = _w.copy(spot).add(beside);
    if (Math.hypot(at.x - shoulder.x, at.z - shoulder.z) > LEADS.out * p.armLength) {
      const back = shoulder.sub(at).setY(0).normalize();
      spot.set(at.x, 0, at.z).addScaledVector(back, LEADS.stand * p.armLength).sub(beside);
    }
    return { go, face };
  };
}

/** the reaching hand: as calm to set off as `handTo` has it, but quicker and its joints brisk enough to keep it on its way while the body turns under it (rad/s², rad/s) */
const REACHING = { speed: 2, turnAccel: 200, turnSpeed: 15 };

/** One hand reaching round: high, across the body, to the floor, behind, far ahead; the body comes along as it must. */
export function reach(v: Variation = {}): Scenario {
  const pace = v.pace ?? 1;
  /** how far ahead of the hand the eyes go (s) */
  const GLANCE = 0.35;
  // (the targets — the first where the hand hangs — each reached at a pace a calm hand
  // keeps up with (a minimum-jerk move of L m peaks at 1.875 L / T m/s), down to the floor no faster
  // than the body squats, and swung round the body to behind it and back out)
  const ways: Way[] = [
    [0.4, [-0.25, 0.9, 0.2]],
    [1.8, [-0.25, 1.95, 0.4]],
    [2.6, [-0.25, 1.95, 0.4]],
    [4.0, [0.3, 1.0, 0.4]],
    [4.7, [0.3, 1.0, 0.4]],
    [6.9, [-0.35, 0.06, 0.55]],
    [7.7, [-0.35, 0.06, 0.55]],
    [9.8, [-0.55, 1.2, -0.6], [-0.75, 0.7, 0.0]],
    [10.6, [-0.55, 1.2, -0.6]],
    [14.1, [0.0, 1.25, 1.8], [-0.95, 1.3, 0.5]],
    [14.9, [0.0, 1.25, 1.8]],
  ];
  const LAST = 14.1;
  // (from where the wrist hangs as the reach sets off; the rest moved by the variation)
  const played = [ways[0], ...moved(ways.slice(1), v, () => true)];
  let wrist = route(played);
  const going = destination(played);
  const setOff = (hanging: Vector3) => {
    const [x, y, z] = hanging.clone().applyAxisAngle(UP, -(v.turn ?? 0)).toArray();
    played[0] = [ways[0][0], [x, y, z]];
    wrist = route(played);
  };
  const play = playback(v);
  const point = (t: number, out: Vector3) => play.place(wrist(play.time(t), out));
  return {
    id: 'reach',
    title: 'Reaching around (one hand)',
    description:
      'A single wrist target visits points high, across the body, on the floor, behind and far away. The body shrugs, bends, squats, turns and steps as needed; the eyes lead the hand.',
    duration: 14.9 / pace + 1.5,
    actors: [{}],
    stage: () => {
      const report = new Report();
      const hand = { position: new Vector3(), velocity: new Vector3() };
      const ahead = new Vector3();
      const look = new Vector3();
      let released = false;
      return {
        report,
        props: (t) => [{ kind: 'ball', position: point(t, new Vector3()), radius: 0.035 }],
        // (the hand on the far target, and let go of it)
        done: () => released,
        script: (h) =>
          function* () {
            let set = false;
            const target = (f: Frame) => {
              if (!set) {
                set = true;
                setOff(f.prev.position(h.rig.skeleton.index('rightHand')).clone());
              }
              point(f.time, hand.position);
              hand.velocity.subVectors(point(f.time + f.dt, _w), point(f.time - f.dt, _u)).divideScalar(2 * f.dt);
              return hand;
            };
            // (on the far target, once it has stopped there)
            const there = (f: Frame) => f.time >= LAST / pace && reached(f, h.rig.skeleton.index('rightHand'), target(f));
            yield* parallel<Frame>('all', idle(h), function* () {
              yield* action({ until: timePassed(0.4 / pace, 'seconds') });
              yield* parallel<Frame>(
                'race',
                handTo(h, 'right', reported(report, 'rightWrist', target), { ...REACHING, until: there }),
                // (the body ahead of the hand: turned and stepped to where it is going)
                ask(h, comeAlong(h, 'right', (f) => play.place(going(play.time(f.time), ahead)), pace)),
                // (the eyes lead the hand: where it is going a moment on)
                lookAt(h, reported(report, 'gaze', (f) => point(f.time + GLANCE / pace, look)), SHIFT),
              );
              yield* reporting(report, ['rightHand'], release(h, ['right'], { away: { right: new Vector3(0, -0.3, -0.3) } }))();
              released = true;
            });
          },
      };
    },
  };
}

const _euler = new Euler();
const _w = new Vector3();
const _u = new Vector3();
const _paint = new Vector3();
const _v = new Vector3();
