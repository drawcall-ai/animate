import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Proportions } from '@prohuman/core';
import type { Effector, Part, Scenario } from '../scenario';
import { jointOf } from '../joints';
import { minimumJerk, quatYXZ, vec } from '../math';
import { bend, footRotation, GRAVITY, Travel } from './ride';

const { smoothstep, degToRad, lerp } = MathUtils;

/**
 * A street board (m), in its frame: the origin on the ground under the deck's middle, +z to
 * the nose, +x to the left. The deck's top, half its flat length, its kicks, its width; the
 * trucks' axles, the wheels' radius and half-track.
 */
const BOARD = { deck: 0.1, flat: 0.3, kick: 0.1, kickAngle: degToRad(20), width: 0.21, axle: 0.22, wheel: 0.027, track: 0.1 };
/**
 * A regular stance (left foot forward), the body sideways, facing the board's right: the
 * front foot over the front truck's bolts, turned ~70° from the board's line, the back foot
 * across the tail (~85°: the toes a little to the nose). Where along the board (m), and the
 * turn from square to it toward the nose (rad).
 */
const STANCE = { front: { at: 0.2, turn: degToRad(20) }, back: { at: -0.27, turn: degToRad(5) } };
/**
 * Pushing, the front foot turns along the board (75° from square) and the back foot pushes on
 * the ground beside it, on the toe side: set down beside the front foot (m along the board,
 * out from its line), pushed back to `lift`, rolling onto its ball (rad), and swung forward
 * again (s, m high). The board speeds up while it pushes (m/s²) and rolls on, slowing a little.
 */
const PUSH = { front: degToRad(75), touch: 0.12, aside: 0.2, lift: -0.12, heel: 0.5, swing: 0.4, rise: 0.12, accel: 3, roll: 0.04 };
/** standing beside the board, the front foot steps onto it (s), then the first push begins */
const START = { step: 0.5, push: 1.1 };
/** the feet take a riding stance after the last push (s) */
const TURN_FEET = 0.45;
/**
 * The ollie: a pelvis target crouches the body (s, × height) and lets go at the pop; the tail
 * pops the board up (m/s: ~0.3 m) over its first moment (s), nose up (rad) while it rises; the
 * front foot slides up toward the nose and both feet ride up with it (m); the pelvis rises with
 * the board by `rise` of its height, the legs tucking it up under the body.
 */
const OLLIE = { crouch: 0.35, depth: 0.1, pop: 2.4, strike: 0.06, tilt: 0.35, slide: 0.15, lift: 0.03, rise: 0.8 };
/** the ollie's flight (s) */
const FLIGHT = (2 * OLLIE.pop) / GRAVITY;

/** the script: the pushes, the carves (along the way, m; radius + = to the left), the ollie (s) */
const SCRIPT = {
  pushes: 4,
  carves: [
    { from: 11, to: 16, radius: -3 },
    { from: 18.5, to: 23.5, radius: 3 },
  ],
  ollie: 10.6,
};

const _v = new Vector3();
const _q = new Quaternion();

/** where a foot goes on the board: along it and across it (m), up off the deck (m), its turn from the board's line and pitch (rad, + = toes up) */
interface Place {
  along: number;
  across: number;
  up: number;
  yaw: number;
  pitch: number;
}

const place = (along: number, across: number, yaw: number, up = 0, pitch = 0): Place => ({ along, across, up, yaw, pitch });
const mix = (a: Place, b: Place, k: number): Place => ({
  along: lerp(a.along, b.along, k),
  across: lerp(a.across, b.across, k),
  up: lerp(a.up, b.up, k),
  yaw: lerp(a.yaw, b.yaw, k),
  pitch: lerp(a.pitch, b.pitch, k),
});

/** riding: the feet across the board, facing its right (a yaw of −π/2 from its line) */
const RIDING = [place(STANCE.front.at, 0, -Math.PI / 2 + STANCE.front.turn), place(STANCE.back.at, 0, -Math.PI / 2 + STANCE.back.turn)] as const;
/** pushing: the front foot along the board; the pushing foot turned out a little from it */
const PUSHING = { front: place(STANCE.front.at, 0.02, -Math.PI / 2 + PUSH.front), back: -Math.PI / 2 + PUSH.front - 0.25 };

/** a cubic Hermite curve at `s` (0..1): from `a` leaving at rate `va` to `b` arriving at rate `vb` (per unit of `s`) */
const hermite = (a: number, va: number, b: number, vb: number, s: number) =>
  (2 * s ** 3 - 3 * s ** 2 + 1) * a + (s ** 3 - 2 * s ** 2 + s) * va + (-2 * s ** 3 + 3 * s ** 2) * b + (s ** 3 - s ** 2) * vb;

/** the board's height and nose-up tilt `air` s after the pop (0 on the ground) */
function flight(air: number) {
  if (air < 0 || air > FLIGHT) return { height: 0, tilt: 0 };
  // (the tail strike speeds it up over its first moment, not in an instant)
  const height = (OLLIE.pop * air - 0.5 * GRAVITY * air * air) * smoothstep(air, 0, OLLIE.strike);
  return { height, tilt: OLLIE.tilt * smoothstep(air, 0, OLLIE.strike) * (1 - smoothstep(air, 0.1, 0.3)) };
}

export const skateboard: Scenario = {
  id: 'skateboard',
  title: 'Skateboarding',
  drives: 'the board (a mount) + both feet (+ the pelvis for the ollie’s crouch)',
  description:
    'The script moves the board and places the feet: four pushes with the back foot (onto the ground beside the board, pushing back onto its ball, swinging forward again), the feet turning into a sideways stance, a carve one way and back the other, and an ollie (its crouch given by a pelvis target for a moment). Everything else is inferred: the body facing the way the feet do, the weight kept over the board while the back foot pushes, crouched relaxed with the arms out, leaning into the carves and with the pushes, the head looking where the board goes, the legs tucking under the pop and absorbing the landing.',
  duration: 15,
  actors: [{ position: { x: 0, y: 0, z: 0 }, yaw: 0 }],
  cameraDistance: 4.2,
  create() {
    const travel = new Travel();
    const frame = new Quaternion();
    /** the pushing foot's spot on the ground (its ball), in the world */
    const contact = new Vector3();
    let pushes = 0;
    let phase: 'push' | 'swing' | 'ride' = 'push';
    let since = 0;
    let lifted = place(0, 0, 0);
    /** the pelvis's height riding, as the ollie's crouch begins */
    let rideHeight: number | null = null;
    const at = (x: number, y: number, z: number) => vec(x, y, z).applyQuaternion(frame).add(travel.position);
    /** a foot's target on its place: standing on its middle, or (`ball` 1) rolling on its ball */
    const foot = (p: Proportions, f: Place, ball = 0): Effector => {
      const rot = footRotation(frame, f.yaw, f.pitch);
      const back = lerp(0.06 * p.scale, p.offsets.leftToes.z, ball);
      return { position: at(f.across, BOARD.deck + f.up, f.along).add(_v.set(0, p.ankleHeight, -back).applyQuaternion(rot)), quaternion: rot };
    };
    return {
      inputs(t, dt, [h]) {
        const p = h.proportions;
        since += dt;
        // the board: pushed, rolling, carving, popped
        const pushing = phase === 'push' && t > START.push;
        const speed = Math.max(0, travel.speed + (pushing ? PUSH.accel : -PUSH.roll) * dt);
        travel.step(speed, SCRIPT.carves.reduce((k, c) => k + bend(travel.s, c.from, c.to, c.radius, 2), 0), dt);
        const air = t - SCRIPT.ollie;
        const { height, tilt } = flight(air);
        // (the trucks let the deck roll a little into a carve; nose up, the tail stays down)
        quatYXZ(travel.yaw, -tilt, -0.5 * travel.lean, frame);
        travel.position.y = height + Math.sin(tilt) * (BOARD.flat + BOARD.kick);
        if (t === 0) contact.copy(at(-PUSH.aside, 0, PUSH.touch));

        // the back foot pushes (on the ground, then swinging forward to the next push), then steps onto the tail
        let front = mix(PUSHING.front, RIDING[0], phase === 'ride' ? minimumJerk(since / TURN_FEET) : 0);
        let back = RIDING[1];
        /** the back foot stands on its ball off the board */
        let ball = phase === 'push' ? 1 : 0;
        if (phase === 'push') {
          const rel = _v.copy(contact).sub(travel.position).applyQuaternion(_q.copy(frame).invert());
          const k = 1 - smoothstep(rel.z, PUSH.lift, PUSH.touch);
          back = place(rel.z, rel.x, PUSHING.back, rel.y - BOARD.deck, -PUSH.heel * k);
          if (pushing && rel.z < PUSH.lift) {
            pushes++;
            phase = 'swing';
            since = 0;
            lifted = back;
          }
        } else if (phase === 'swing') {
          const last = pushes >= SCRIPT.pushes;
          const to = last ? RIDING[1] : place(PUSH.touch, -PUSH.aside, PUSHING.back, -BOARD.deck);
          const s = Math.min(1, since / PUSH.swing);
          const k = minimumJerk(s);
          back = mix(lifted, to, k);
          // (along the board it comes off the ground and down onto it near the ground's pace: nearly still in the
          // world)
          const ground = -speed * PUSH.swing;
          back.along = hermite(lifted.along, ground, to.along, last ? 0 : 0.6 * ground, s);
          ball = last ? 1 - k : 1;
          back.up += PUSH.rise * Math.sin(Math.PI * k);
          if (since >= PUSH.swing) {
            since = 0;
            phase = last ? 'ride' : 'push';
            contact.copy(at(to.across, 0, to.along));
          }
        }

        // the ollie: the pelvis crouches for the pop and is driven up with it (the legs tucking the board up
        // under it), then let go for the landing; the front foot slides up to the nose, both ride up with the board
        let pelvis: Effector | undefined;
        const crouching = minimumJerk((air + OLLIE.crouch + 0.1) / OLLIE.crouch);
        const held = air < 0 ? crouching : 1 - smoothstep(air, FLIGHT - 0.15, FLIGHT - 0.03);
        if (held > 0) {
          rideHeight ??= jointOf(h, 'hips').y;
          const dip = OLLIE.depth * p.height * (air < 0 ? crouching : 1 - smoothstep(air, 0, 0.12));
          // (only its height: the hips stay free to go back over the feet)
          pelvis = { position: jointOf(h, 'hips').setY(rideHeight - dip + OLLIE.rise * height), weight: held };
        }
        if (height > 0) {
          const k = Math.sin((Math.PI * height) / 0.3) * smoothstep(air, 0, 0.1);
          front = { ...front, along: front.along + OLLIE.slide * smoothstep(air, 0, 0.15) * (1 - smoothstep(air, 0.3, 0.45)), up: OLLIE.lift * k };
          back = { ...back, up: OLLIE.lift * k };
        }
        const on = smoothstep(t, 0, START.step);
        return [{ mount: { position: travel.position.clone(), quaternion: frame.clone() }, leftFoot: { ...foot(p, front), weight: on }, rightFoot: { ...foot(p, back, ball), weight: on }, hips: pelvis }];
      },
      props: () => [{ kind: 'vehicle', position: travel.position.clone(), quaternion: frame.clone(), parts: parts() }],
    };
  },
};

/** the board's parts */
function parts(): Part[] {
  const { deck, flat, kick, kickAngle, width, axle, wheel, track } = BOARD;
  const out: Part[] = [{ kind: 'box', center: vec(0, deck - 0.007, 0), size: vec(width, 0.014, 2 * flat) }];
  for (const end of [1, -1]) {
    const c = vec(0, deck - 0.007 + (Math.sin(kickAngle) * kick) / 2, end * (flat + (Math.cos(kickAngle) * kick) / 2));
    out.push({ kind: 'box', center: c, size: vec(width, 0.014, kick), quaternion: quatYXZ(0, -end * kickAngle, 0) });
    out.push({ kind: 'box', center: vec(0, (wheel + deck) / 2, end * axle), size: vec(0.06, deck - wheel - 0.02, 0.05) });
    for (const side of [1, -1]) out.push({ kind: 'wheel', center: vec(side * track, wheel, end * axle), radius: wheel, tube: 0.03 });
  }
  return out;
}
