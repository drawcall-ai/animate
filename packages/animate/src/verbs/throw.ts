import { MathUtils, Object3D, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { selfOf, type Body } from '../body/body';
import { personOf, type Person } from '../body/person';
import type { Frame } from '../kernel/frame';
import { during, type Miss, type Request } from '../kernel/requests';
import { course, still } from '../kernel/course';
import { ChainTip } from '../kernel/tip';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import { handStep } from '../hands/person/arms';
import { INDEX, sideOf, type Side } from '../species/humanoid/bones';
import { crouchOf } from '../legs/person/legged';
import type { Asked } from '../kernel/poise';
import { letGo, type Released } from './release';
import { verb, type Verb } from './story';
import type { Target } from './targets';
import { lerp } from '../kernel/math';

/** How a throw goes. */
export interface ThrowOptions {
  /** the speed it leaves the hand at (m/s; default the least that carries it to the target on a 40° arc, at most 25): what `released`
   * reports, aimed at the target — out of reach at that speed, at 45°, as far as it goes, and the throw misses */
  speed?: number;
  /** the gravity your physics flies it under (m/s², down; default 9.81): what the aim at the target is worked out for */
  gravity?: number;
  /** called as the thing leaves the hand, ahead of the head on its way down, with how it is moving: the velocity aimed at the target
   * (or as the hand moved it, with no target) and the spin the hand gave it — give them to your physics. The thing is already let go:
   * attached under the scene's root where it is, its transform the world's */
  released?: (motion: Released) => void;
}

/**
 * Throws `thing`, held in one of a person's hands, overhand at `target` (a point, an object or a function of the body's time giving either, read as the thing is
 * let go; none: straight ahead), along the way the
 * body faces — turn it toward the target first. The hand swings out to the side and cocks the thing behind the ear at head height as the
 * trunk coils away, the hips with it, and the body sinks onto its back foot, the free arm pointing at the target; the hips and then the
 * trunk uncoil ahead of the arm and
 * the weight drives forward as the hand whips past the side of the head, the elbow up, and lets go ahead of it with the arm a little above
 * level; the hand follows through down past the other hip, the free arm pulled in. Every place is the body's own,
 * scaled to it. The thing is left in the world where it was let go (`release`); its flight is your physics', from what `released` is
 * given. Standing, the foot on the free side strides half a step ahead through the throw, and steps back after; walking or running, it
 * throws over its own gait, the hips left to it. It asks for the throwing hand, the
 * free arm (when its hand holds nothing) and the trunk, which it takes from a `lookAt` given `trunk` (a look without one keeps the eyes
 * beside it). A mover, it ends `true` once the follow-through is done (about 1 s after it starts): the throwing arm is free for the next
 * hand verb (taking a weapon back), and the trunk and the stride come back on their own meanwhile. A target out of reach at its speed
 * throws `Missed` after the follow-through, the thing already gone as `released` was told. It says only whether the aim reaches the target:
 * the flight is your physics'.
 */
export function throwAt(body: Body, thing: Object3D, target?: Target, options: ThrowOptions = {}): Verb {
  const self = selfOf(body), held = Thing.of(thing), hands = handsOn(self, held);
  if (!body.species.person) throw new Error(`throwAt: a ${body.species.name ?? 'custom species'} has no arms to throw with`);
  if (hands.length !== 1) throw new Error(`throwAt: "${thing.name}" is held in ${hands.length} hands; throw what one hand holds`);
  const person = personOf(self), side = sideOf(hands[0]);
  return verb(body, 'throwAt', (request) => () => throwing(person, request, held, side, target, options));
}

/** where the throwing hand's wrist goes, from the head standing upright, as low as its root crouches it (the body's frame for a right
 * hand, +X its left, × its scale; a left hand mirrors it): out beside the shoulder, cocked behind the ear, past the side of the head, and
 * let go ahead of it */
const PATH = {
  aside: new Vector3(-0.42, -0.12, 0), cocked: new Vector3(-0.36, 0, -0.22), passing: new Vector3(-0.33, 0.07, 0.12),
  out: new Vector3(-0.25, 0.08, 0.42),
};
/** where the follow-through ends, from the shoulder as the body stands, bowed into the throw (the body's frame for a right hand): down
 * and across toward the other thigh, `share` of the arm's length — nearly all of it, where the arm reaches — as `Body.armPoint` has it */
const THROUGH = { direction: new Vector3(0.6, -0.7, 0.45).normalize(), share: 0.95 };
/** how long each part takes (s): the windup to the cock, held there, the whip and follow-through, the hand held at its end; how far
 * ahead of the arm's whip the trunk's uncoil, and the free arm's pull, set off (s) */
const TIMES = { windup: 0.32, cocked: 0.15, whip: 0.4, held: 0.15, lead: 0.05, pull: 0.25 };
/** the trunk (a right-handed throw's; `lower` and `shift`, m ahead, × scale): coiled, the chest 50° right and the hips 30°, sunk onto the
 * back foot; uncoiled, the chest 23° left and the hips 20°, bowed into the throw, the weight forward */
const COILED = { twist: -0.8, hips: -0.5, bow: -0.1, lower: 0.07, shift: -0.06 }, UNCOILED = { twist: 0.4, hips: 0.3, bow: 0.6, lower: 0.1, shift: 0.08 };
/** how fast the trunk turns and bows (rad/s), and how far ahead of the chest the hips uncoil (s) */
const TWISTING = 10, BOWING = 3, HIPS_LEAD = 0.03;
/** how long the trunk's uncoil takes (s): 1.2 rad of twist on a smooth ramp, peaking under `TWISTING` */
const UNCOILING = 0.2;
/** how far ahead the foot on the free side strides (× the leg's length: about half a stride, as far as the front leg reaches with the hips
 * let down and turned through the whip), from when in the windup (s) */
const STRIDE = { ahead: 0.33, from: 0.16 };
/** the free arm pointed at the target for the cock, pulled in across the body to the hip for the whip (rad, as `ArmPosture`) */
const OFF = { pointing: { forward: 1.4, out: 0.4, twist: 0, elbow: 0.2 }, pulled: { forward: 0.5, out: -0.3, twist: -0.9, elbow: 1.7 } };
/** where the throwing elbow points through the cock and whip (from the shoulder, the body's frame for a right hand): out and level */
const ELBOW = new Vector3(-1, -0.1, -0.4);
/** how briskly the hand keeps to its path (m/s², m/s: quick enough for a throw's 8–10 m/s) and turns, the arm's joints with it (rad/s²,
 * rad/s: a throw's wrist peaks near 2000°/s), its turn's rate rising and falling within these all through the throw rather than braked at
 * the joints' cap where the windup or the swing over the shoulder turns the forearm fastest */
const QUICK = { accel: 600, speed: 40, turnAccel: 400, turnSpeed: 35 };
/** the fastest a default throw sets out (m/s) and the arc it sets out on (rad) */
const MOST = 25, ARC = (40 * Math.PI) / 180;

function* throwing(person: Person, request: Request, thing: Thing, side: Side, target: Target | undefined, options: ThrowOptions) {
  const off: Side = side === 'right' ? 'left' : 'right', x = side === 'right' ? 1 : -1, scale = person.proportions.scale, bone = person.hands[side];
  const facing = () => _turn.setFromAxisAngle(UP, person.locomotion.facing).clone();
  // (the body's frame as it stands — its root's ground point, turned as it faces, let down as far as its root crouches it — and where its
  // head is standing upright: not where it is as the throw begins, a body that took the thing up from low still bowed over it)
  const ground = () => {
    const root = person.pose.position(0);
    return new Vector3(root.x, person.floor(root.x, root.z) - crouchOf(person), root.z);
  };
  const head = new Vector3(0, person.proportions.eyeHeight - person.proportions.eyes.y, 0);
  const local = (point: Vector3) => point.clone().sub(ground()).applyQuaternion(facing().invert()).sub(head);
  // (`coil`: the offset turned with the trunk's coil, as far as that is in, so `behind` is behind the turned shoulders, as it looks)
  const at = (offset: Vector3, coil = 0) => () => ({ position: new Vector3(x * offset.x, offset.y, offset.z).applyAxisAngle(UP, coil * x * COILED.twist)
    .multiplyScalar(scale).add(head).applyQuaternion(facing()).add(ground()) });
  const windup = course({ current: { position: person.pose.position(bone).clone(), quaternion: new Quaternion() } },
    [[TIMES.windup / 2, at(PATH.aside, 0.25)], [TIMES.windup / 2, at(PATH.cocked, 0.5)], [TIMES.cocked, still]]);
  const arm = new ChainTip(`${side}Arm`), free = !person.holding[off];
  // (the hand eased through the windup and the cock from how it held the thing, turned with the body, to straight on the forearm, the
  // turn the whip takes it in, not snapped there in a sub-step)
  const forearm = INDEX[`${side}LowerArm`], held = facing().invert().multiply(person.pose.rotation(bone));
  const wrist = (f: Frame) => _held.copy(held).premultiply(facing()).slerp(f.prev.rotation(forearm), MathUtils.smoothstep(since(f), 0, TIMES.windup + TIMES.cocked)).clone();
  const through = () => ({ position: new Vector3(x * THROUGH.direction.x, THROUGH.direction.y, THROUGH.direction.z).multiplyScalar(THROUGH.share * person.proportions.armLength)
    .applyQuaternion(facing()).add(person.pose.position(INDEX[`${side}UpperArm`])) });
  const elbow = () => person.pose.position(INDEX[`${side}UpperArm`]).clone().add(new Vector3(x * ELBOW.x, ELBOW.y, ELBOW.z).applyQuaternion(facing()));
  let whip: ReturnType<typeof course> | null = null, gone = false, began = NaN;
  const since = (f: Frame) => f.time - (Number.isNaN(began) ? (began = f.time) : began);
  const uncoiled = (f: Frame) => since(f) >= TIMES.windup + TIMES.cocked - TIMES.lead;
  // (a body standing strides into the throw, sinks into it and turns its hips with it; one already walking or running throws over its
  // own gait, whose steps, pelvis and knees a staggered stance, a coiled hip or a sink would fight)
  const ahead = STRIDE.ahead * person.proportions.legLength, stride = side === 'right' ? [ahead, 0] : [0, ahead], strides = !person.locomotion.moving;
  const trunk = (f: Frame): Asked => {
    // (uncoiled along a smooth ramp, the hips a moment ahead of the chest, not asked all at once: at the trunk's top rate all the way, it
    // stopped dead at the end of its turn, a jolt the hand carried into the whip)
    const ask = uncoiled(f) ? UNCOILED : COILED, from = TIMES.windup + TIMES.cocked - TIMES.lead;
    const turn = (lead: number) => MathUtils.smoothstep(since(f), from - lead - UNCOILING / 5, from - lead + UNCOILING * 4 / 5);
    const twist = lerp(COILED.twist, UNCOILED.twist, turn(0)), hips = lerp(COILED.hips, UNCOILED.hips, turn(HIPS_LEAD));
    // (bowed into the throw as the hand lets go, not before, so the head does not run on past the hand)
    return {
      twist: x * twist, hips: strides ? x * hips : 0, twistRate: TWISTING, bow: gone ? UNCOILED.bow : COILED.bow, bowRate: BOWING,
      ...(strides && { lower: ask.lower * scale, shift: new Vector3(0, 0, ask.shift * scale).applyQuaternion(facing()) }), ...(strides && since(f) >= STRIDE.from && { stagger: stride }),
    };
  };
  const aiming: { short: Miss | null } = { short: null };
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
        [[TIMES.whip * 0.3, at(PATH.passing)], [TIMES.whip * 0.2, at(PATH.out)], [TIMES.whip * 0.5, through]]);
      // (the hand turned with the forearm through the whip)
      // (the elbow kept out and level through the follow-through as well: let loose after the release, a short arm's solve could pick the
      // elbow over the shoulder from one sub-step to the next)
      handStep(person, f, side, { position: whip.to(f).position, quaternion: f.prev.rotation(forearm) }, { ...QUICK, lead: false, pole: elbow() }, arm);
      // (let go as it passes ahead of the head, or as the whip reaches where that is, whichever is first)
      if (gone || (local(f.current.position(bone)).z < PATH.out.z * scale && since(f) < TIMES.windup + TIMES.cocked + TIMES.whip / 2)) return;
      gone = true;
      const motion = letGo(person, thing, [side], undefined, false);
      if (target) {
        const at = typeof target === 'function' ? target(f.time) : target;
        const aim = aimed(thing.object.getWorldPosition(new Vector3()), at instanceof Object3D ? at.getWorldPosition(new Vector3()) : at, options.speed, options.gravity ?? G);
        motion.velocity.copy(aim.velocity);
        if (aim.short) aiming.short = { ...aim.short, where: thing.object.name };
      }
      options.released?.(motion);
    }, (f) => whip !== null && whip.over(f)));
  // (the hand held at the end of its follow-through a moment, the trunk held there with it; then the arm is free, and the trunk and the
  // stride come back on their own as the next verb begins)
  yield* parallel<Frame>('race',
    during(request, 'trunk', 'asked', (f) => person.poise.add(trunk(f))),
    during(request, `hand.${side}`, 'asked', (f) => handStep(person, f, side, { ...through(), quaternion: f.prev.rotation(forearm) }, { ...QUICK, lead: false }, arm), (f) => since(f) >= TIMES.windup + TIMES.cocked + TIMES.whip + TIMES.held));
  if (aiming.short) request.fail(aiming.short);
  else request.met();
}

/**
 * the velocity from `from` that carries a thing to `to` under gravity `g`: at `speed`, on its lower arc (none: the least on `ARC`, at
 * most `MOST`); and, where it cannot, what falls short — out of reach at that speed it goes at 45°, as far as it goes; straight above or
 * below with no speed it is dropped
 */
function aimed(from: Vector3, to: Vector3, speed: number | undefined, g: number): { velocity: Vector3; short: Omit<Miss, 'where'> | null } {
  const flat = new Vector3(to.x - from.x, 0, to.z - from.z), d = flat.length(), h = to.y - from.y;
  if (d < 1e-6) {
    const short = speed === undefined ? { off: Math.abs(h), limit: 0, why: 'the target is straight above or below, and there is no speed to throw it at: give `speed`' } : null;
    return { velocity: new Vector3(0, speed ?? 0, 0), short };
  }
  flat.divideScalar(d);
  let v = speed;
  if (v === undefined) {
    const lift = d * Math.tan(ARC) - h;
    v = lift > 0 ? Math.min(MOST, Math.sqrt((g * d * d) / (2 * Math.cos(ARC) ** 2 * lift))) : MOST;
  }
  const root = v ** 4 - g * (g * d * d + 2 * h * v * v);
  if (root < 0) {
    // (the least speed that reaches it: v² = g (h + √(h² + d²)))
    const least = Math.sqrt(g * (h + Math.hypot(h, d)));
    return { velocity: flat.multiplyScalar(v * Math.SQRT1_2).setY(v * Math.SQRT1_2), short: { off: v, limit: least, why: `the target is out of reach at ${v.toFixed(1)} m/s, in m/s: it takes at least ${least.toFixed(1)}` } };
  }
  const angle = Math.atan((v * v - Math.sqrt(root)) / (g * d));
  return { velocity: flat.multiplyScalar(v * Math.cos(angle)).setY(v * Math.sin(angle)), short: null };
}

const G = 9.81, UP = new Vector3(0, 1, 0), _turn = new Quaternion(), _held = new Quaternion();
