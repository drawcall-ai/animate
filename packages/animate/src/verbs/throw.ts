import { Object3D, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { selfOf, type Body } from '../body/body';
import { personOf, type Person } from '../body/person';
import type { Frame } from '../kernel/frame';
import { during, type Request } from '../kernel/requests';
import { course, still } from '../kernel/course';
import { ChainTip } from '../kernel/tip';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import { handStep } from '../hands/person/arms';
import { INDEX, sideOf, type Side } from '../species/humanoid/bones';
import type { Asked } from '../kernel/poise';
import { letGo, type Released } from './release';
import { verb, type Verb } from './story';
import { smoothstep } from '../kernel/math';

/** How a throw goes. */
export interface ThrowOptions {
  /** the speed it leaves the hand at (m/s; default the least that carries it to the target on a 40° arc, at most 25): what `released`
   * reports, aimed at the target */
  speed?: number;
  /** the gravity your physics flies it under (m/s², down; default 9.81): what the aim at the target is worked out for */
  gravity?: number;
  /** called as the thing leaves the hand, ahead of the head on its way down, with how it is moving: the velocity aimed at the target
   * (or as the hand moved it, with no target) and the spin the hand gave it — give them to your physics. The thing is already let go:
   * attached under the scene's root where it is, its transform the world's */
  released?: (motion: Released) => void;
}

/**
 * Throws `thing`, held in one of a person's hands, overhand at `target` (a point, or an object; none: straight ahead), along the way the
 * body faces — turn it toward the target first. The hand swings out to the side and cocks the thing behind the ear at head height as the
 * trunk coils away, the hips with it, and the body sinks onto its back foot, the free arm pointing at the target; the hips and then the
 * trunk uncoil ahead of the arm and
 * the weight drives forward as the hand whips past the side of the head, the elbow up, and lets go ahead of it with the arm a little above
 * level; the hand follows through down past the other hip, the free arm pulled in, and the trunk settles. Every place is the body's own,
 * scaled to it. The thing is left in the world where it was let go (`release`); its flight is your physics', from what `released` is
 * given. Standing, the foot on the free side strides half a step ahead through the throw, and steps back after; walking or running, it
 * throws over its own gait, the hips left to it. It asks for the throwing hand, the
 * free arm (when its hand holds nothing) and the trunk, which it takes from a `lookAt` given `trunk` (a look without one keeps the eyes
 * beside it). A mover, it ends `true` once the body has come to rest after the follow-through, the stride stepped back: ready to take
 * hold of something.
 */
export function throwAt(body: Body, thing: Object3D, target?: Vector3 | Object3D, options: ThrowOptions = {}): Verb {
  const self = selfOf(body), held = Thing.of(thing), hands = handsOn(self, held);
  if (!body.species.person) throw new Error(`throwAt: a ${body.species.name ?? 'custom species'} has no arms to throw with`);
  if (hands.length !== 1) throw new Error(`throwAt: "${thing.name}" is held in ${hands.length} hands; throw what one hand holds`);
  const person = personOf(self), side = sideOf(hands[0]);
  return verb(body, 'throwAt', (request) => () => throwing(person, request, held, side, target, options));
}

/** where the throwing hand's wrist goes, from the head standing upright (the body's frame for a right hand, +X its left, × its scale;
 * a left hand mirrors it): out beside the shoulder, cocked behind the ear, past the side of the head, let go ahead of it, and on down
 * past the other hip */
const PATH = {
  aside: new Vector3(-0.42, -0.12, 0), cocked: new Vector3(-0.36, 0.02, -0.13), passing: new Vector3(-0.33, 0.07, 0.12),
  out: new Vector3(-0.25, 0.08, 0.42), through: new Vector3(0.25, -0.85, 0.5),
};
/** how long each part takes (s): the windup to the cock, held there, the whip and follow-through, the hand held at its end, the trunk
 * settling, the longest it waits for the body to come to rest after; how far ahead of the arm's whip the trunk's uncoil, and the free
 * arm's pull, set off (s) */
const TIMES = { windup: 0.32, cocked: 0.15, whip: 0.4, held: 0.05, settle: 0.25, rest: 1, lead: 0.05, pull: 0.25 };
/** the trunk (a right-handed throw's; `lower` and `shift`, m ahead, × scale): coiled, the chest 50° right and the hips 30°, sunk onto the
 * back foot; uncoiled, the chest 23° left and the hips 20°, bowed into the throw, the weight forward */
const COILED = { twist: -0.8, hips: -0.5, bow: -0.1, lower: 0.07, shift: -0.06 }, UNCOILED = { twist: 0.4, hips: 0.3, bow: 0.6, lower: 0.1, shift: 0.08 };
/** how fast the trunk turns and bows (rad/s), and how far ahead of the chest the hips uncoil (s) */
const TWISTING = 10, BOWING = 3, HIPS_LEAD = 0.03;
/** how far ahead the foot on the free side strides (× the leg's length: about half a stride, as far as the front leg reaches with the hips
 * let down and turned through the whip), from when in the windup (s) */
const STRIDE = { ahead: 0.33, from: 0.16 };
/** the free arm pointed at the target for the cock, pulled in across the body to the hip for the whip (rad, as `ArmPosture`) */
const OFF = { pointing: { forward: 1.4, out: 0.4, twist: 0, elbow: 0.2 }, pulled: { forward: 0.5, out: -0.3, twist: -0.9, elbow: 1.7 } };
/** where the throwing elbow points through the cock and whip (from the shoulder, the body's frame for a right hand): out and level */
const ELBOW = new Vector3(-1, -0.1, -0.4);
/** how briskly the hand keeps to its path: quick enough for a throw's 8–10 m/s */
const QUICK = { accel: 600, speed: 40, turnAccel: 2000, turnSpeed: 60 };
/** the fastest a default throw sets out (m/s) and the arc it sets out on (rad) */
const MOST = 25, ARC = (40 * Math.PI) / 180;

function* throwing(person: Person, request: Request, thing: Thing, side: Side, target: Vector3 | Object3D | undefined, options: ThrowOptions) {
  const off: Side = side === 'right' ? 'left' : 'right', x = side === 'right' ? 1 : -1, scale = person.proportions.scale, bone = person.hands[side];
  const facing = () => _turn.setFromAxisAngle(UP, person.locomotion.facing).clone();
  // (the body's frame as it stands — its root's ground point, turned as it faces — and where its head is standing upright: not where it
  // is as the throw begins, a body that took the thing up from low still bowed over it)
  const ground = () => {
    const root = person.pose.position(0);
    return new Vector3(root.x, person.floor(root.x, root.z), root.z);
  };
  const head = new Vector3(0, person.proportions.eyeHeight - person.proportions.eyes.y, 0);
  const local = (point: Vector3) => point.clone().sub(ground()).applyQuaternion(facing().invert()).sub(head);
  const at = (offset: Vector3) => () => ({ position: new Vector3(x * offset.x, offset.y, offset.z).multiplyScalar(scale).add(head).applyQuaternion(facing()).add(ground()) });
  const windup = course({ current: { position: person.pose.position(bone).clone(), quaternion: new Quaternion() } },
    [[TIMES.windup / 2, at(PATH.aside)], [TIMES.windup / 2, at(PATH.cocked)], [TIMES.cocked, still]]);
  const arm = new ChainTip(`${side}Arm`), free = !person.holding[off];
  // (the hand eased through the windup and the cock from how it held the thing, turned with the body, to straight on the forearm, the
  // turn the whip takes it in, not snapped there in a sub-step)
  const forearm = INDEX[`${side}LowerArm`], held = facing().invert().multiply(person.pose.rotation(bone));
  const wrist = (f: Frame) => _held.copy(held).premultiply(facing()).slerp(f.prev.rotation(forearm), smoothstep(0, TIMES.windup + TIMES.cocked, since(f))).clone();
  const elbow = () => person.pose.position(INDEX[`${side}UpperArm`]).clone().add(new Vector3(x * ELBOW.x, ELBOW.y, ELBOW.z).applyQuaternion(facing()));
  let whip: ReturnType<typeof course> | null = null, let_go = false, began = NaN;
  const since = (f: Frame) => f.time - (Number.isNaN(began) ? (began = f.time) : began);
  const uncoiled = (f: Frame) => since(f) >= TIMES.windup + TIMES.cocked - TIMES.lead;
  // (a body standing strides into the throw and turns its hips with it; one already walking or running throws over its own gait, whose
  // steps and pelvis a staggered stance or a coiled hip would cross)
  const ahead = STRIDE.ahead * person.proportions.legLength, stride = side === 'right' ? [ahead, 0] : [0, ahead], strides = !person.locomotion.moving;
  const trunk = (f: Frame): Asked => {
    const ask = uncoiled(f) ? UNCOILED : COILED, hips = since(f) >= TIMES.windup + TIMES.cocked - TIMES.lead - HIPS_LEAD ? UNCOILED.hips : COILED.hips;
    // (bowed into the throw as the hand lets go, not before, so the head does not run on past the hand)
    return {
      twist: x * ask.twist, hips: strides ? x * hips : 0, twistRate: TWISTING, bow: let_go ? UNCOILED.bow : COILED.bow, bowRate: BOWING, lower: ask.lower * scale,
      shift: new Vector3(0, 0, ask.shift * scale).applyQuaternion(facing()), ...(strides && since(f) >= STRIDE.from && { stagger: stride }),
    };
  };
  yield* parallel<Frame>('race',
    during(request, 'trunk', 'asked', (f) => person.poise.add(trunk(f))),
    free && during(request, `arm.${off}`, 'asked', (f) => {
      // (pulled in ahead of the trunk's uncoil, at an arm's pace, so the turn does not swing the raised arm out wide)
      const pose = since(f) >= TIMES.windup + TIMES.cocked - TIMES.pull ? OFF.pulled : OFF.pointing, to = person.armPose[off];
      for (const key of ['forward', 'out', 'twist', 'elbow'] as const) to[key] += pose[key];
    }),
    during(request, `hand.${side}`, 'asked', (f) => {
      if (since(f) < TIMES.windup + TIMES.cocked) return void handStep(person, f, side, { position: windup.to(f).position, quaternion: wrist(f) }, { ...QUICK, lead: false, pole: elbow() }, arm);
      whip ??= course({ current: { position: person.pose.position(bone).clone(), quaternion: new Quaternion() } },
        [[TIMES.whip * 0.25, at(PATH.passing)], [TIMES.whip * 0.25, at(PATH.out)], [TIMES.whip * 0.5, at(PATH.through)]]);
      handStep(person, f, side, { position: whip.to(f).position }, { ...QUICK, lead: false, ...(!let_go && { pole: elbow() }) }, arm);
      // (let go as it passes ahead of the head, or as the whip reaches where that is, whichever is first)
      if (let_go || (local(f.current.position(bone)).z < PATH.out.z * scale && since(f) < TIMES.windup + TIMES.cocked + TIMES.whip / 2)) return;
      let_go = true;
      const motion = letGo(person, thing, [side], undefined, false);
      if (target) motion.velocity.copy(aimed(thing.object.getWorldPosition(new Vector3()), target instanceof Object3D ? target.getWorldPosition(new Vector3()) : target, options.speed, options.gravity ?? G));
      options.released?.(motion);
    }, (f) => whip !== null && whip.over(f)));
  // (the trunk settling back from the follow-through, the hand held there a moment)
  const through = at(PATH.through);
  yield* parallel<Frame>('race',
    during(request, 'trunk', 'asked', () => person.poise.add({ twist: 0, hips: strides ? x * UNCOILED.hips : 0, twistRate: TWISTING, bow: 0, bowRate: BOWING / 2, ...(strides && { stagger: stride }) })),
    during(request, `hand.${side}`, 'asked', (f) => handStep(person, f, side, through(), { ...QUICK, lead: false }, arm), (f) => since(f) >= TIMES.windup + TIMES.cocked + TIMES.whip + TIMES.held),
    action<Frame>({ until: (f) => since(f) >= TIMES.windup + TIMES.cocked + TIMES.whip + TIMES.settle }));
  // (the stride stepped back and the body come to rest, ready for what follows)
  const rested = person.frame.time;
  yield* action<Frame>({ until: (f) => person.locomotion.settled || f.time - rested >= TIMES.rest });
  request.met();
}

/** the velocity from `from` that carries a thing to `to` under gravity `g`: at `speed`, on its lower arc (none: the least on `ARC`) */
function aimed(from: Vector3, to: Vector3, speed: number | undefined, g: number): Vector3 {
  const flat = new Vector3(to.x - from.x, 0, to.z - from.z), d = flat.length(), h = to.y - from.y;
  if (d < 1e-6) return new Vector3(0, speed ?? 0, 0);
  flat.divideScalar(d);
  let v = speed;
  if (v === undefined) {
    const lift = d * Math.tan(ARC) - h;
    v = lift > 0 ? Math.min(MOST, Math.sqrt((g * d * d) / (2 * Math.cos(ARC) ** 2 * lift))) : MOST;
  }
  // (the lower of the two arcs at that speed; out of its reach, 45°, as far as it goes)
  const root = v ** 4 - g * (g * d * d + 2 * h * v * v);
  const angle = root >= 0 ? Math.atan((v * v - Math.sqrt(root)) / (g * d)) : Math.PI / 4;
  return flat.multiplyScalar(v * Math.cos(angle)).setY(v * Math.sin(angle));
}

const G = 9.81, UP = new Vector3(0, 1, 0), _turn = new Quaternion(), _held = new Quaternion();
