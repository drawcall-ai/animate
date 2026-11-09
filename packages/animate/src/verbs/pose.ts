import { action, parallel } from '@pmndrs/timeline';
import { during, type Request } from '../kernel/requests';
import type { Frame } from '../kernel/frame';
import { follow } from '../kernel/follow';
import type { ArmPosture, Posture } from '../kernel/poise';
import { selfOf, type Body } from '../body/body';
import { personOf } from '../body/person';
import type { Self } from '../body/runtime';
import { NOD } from '../look/offset';
import { BOW } from '../legs/person/balance';
import { LOWER } from '../legs/person/posture';
import { EASING, POSED } from '../legs/creature';
import { SWING } from '../hands/person/hang';
import { SIDES } from '../species/humanoid/bones';
import { verb, type Until, type Verb } from './story';
import { shapeOf } from '../fingers/shape';

/** How a pose goes. */
export interface PoseOptions {
  /** ends on this, `true`; with neither this nor `hold`, it holds the posture until its story moves on */
  until?: Until;
  /** ends this many seconds after the posture has come, by its parts' paces: how a pose says it has finished */
  hold?: number;
}

/**
 * Poses `body` as `posture` has it, over whatever else it does (standing, walking, reaching, looking): a bow, a back arched with the chest
 * lifting, a turn or a sideways lean of the trunk, a nod or a tilt of the head, a person's arms raised, spread or bent. Each angle is added
 * onto what the body's own tasks ask (a reach's bow, a look's head, the arms' hang and swing), held in balance and within the joints, and
 * eased back out once the pose ends — so a nod is a short pose, and poses one after another flow into each other. Each eases in at its
 * part's own pace: a person's trunk at up to 1.2 rad/s (6 rad/s²; `lower` 0.6 m/s), its head and arms at up to 2.5 rad/s, so a 0.3 rad
 * nod is down in about a quarter second and back in as long; a creature's trunk closes about half the way in 0.3 s and 85% in 0.6 s, at
 * most 0.25 rad of bow and 0.15 of twist or lean (combined, they can still ask more than a big creature's legs follow). A pose that ends
 * before it has come two thirds of the way to an angle comes out that much smaller, so give `hold` to end it once it has come. A walking
 * person bows at most 0.5 rad. An aimer, it keeps on until `until` or `hold`. It asks for the trunk's
 * posture with a trunk field (taking the trunk from a `lookAt` given a `trunk` share, or giving it up to a newer one), for the head's
 * turn with `head` — not for the eyes: a look beside it keeps them, and the head turns over where they look — and for each arm it poses; a hand verb or a held thing takes that arm over (`ArmPosture`). A person's `fingers`
 * (a skeleton with finger bones) take each hand's shape as asked rather than adding onto anything, easing in within about a quarter
 * second and back to relaxed once the pose ends; a hand holding something keeps its grasp.
 */
export function pose(body: Body, posture: Posture, options: PoseOptions = {}): Verb {
  const { head, arms, fingers, ...trunk } = posture;
  const angles = { ...trunk, ...head, ...Object.fromEntries(SIDES.flatMap((side) => Object.entries(arms?.[side] ?? {}).map(([name, value]) => [`${side} ${name}`, value]))) };
  for (const [name, value] of Object.entries(angles)) {
    if (!Number.isFinite(value)) throw new Error(`pose: ${name} ${value} is no number of radians or metres`);
  }
  const self = selfOf(body);
  if (head && !self.gazer) throw new Error(`pose: a ${body.species.name ?? 'custom species'} has no head to turn (no gaze)`);
  if (arms && !body.species.person) throw new Error(`pose: arms are a person's; a ${body.species.name ?? 'custom species'} has none to pose`);
  const shapes = fingers ? shapesOf(self, body, fingers) : [];
  const asked = { bow: trunk.bow ?? 0, twist: trunk.twist ?? 0, lean: trunk.lean ?? 0, lower: trunk.lower ?? 0 };
  const posed = Object.keys(trunk).length > 0, { until, hold } = options;
  if (until !== undefined && hold !== undefined) throw new Error('pose: give `until` or `hold`, not both');
  if (hold !== undefined && !(hold >= 0 && hold < Infinity)) throw new Error(`pose: a hold of ${hold} s`);
  return verb(body, 'pose', (request) => function* () {
    const posedArms = SIDES.flatMap((side) => {
      const arm = arms?.[side];
      return arm ? [{ side, arm: { shrug: 0, forward: 0, out: 0, twist: 0, elbow: 0, ...arm } }] : [];
    });
    yield* parallel('all',
      pacing(self, request, posture, hold),
      posed && during(request, 'trunk', 'asked', () => self.poise.add({ posture: asked })),
      head !== undefined && during(request, 'head', 'asked', () => self.headOffset.add(head)),
      ...posedArms.map(({ side, arm }) => during(request, `arm.${side}`, 'asked', () => add(personOf(self).armPose[side], arm))),
      ...shapes.map(({ side, shape, state }) => during(request, `fingers.${side}`, 'asked', () => state.ask(side, shape))));
  }, until, true, false, hold !== undefined);
}

/** each hand's shape `fingers` asks of `self`, with the fingers it is written to; a skeleton without finger bones has none to pose */
function shapesOf(self: Self, body: Body, fingers: NonNullable<Posture['fingers']>) {
  const state = self.fingers;
  if (!state) throw new Error(`pose: a ${body.species.name ?? 'custom species'} skeleton has no finger bones to pose`);
  return SIDES.flatMap((side) => {
    const asked = fingers[side];
    return asked ? [{ side, shape: shapeOf(asked), state }] : [];
  });
}

/** `arm` added onto `to` */
function add(to: Required<ArmPosture>, arm: Required<ArmPosture>): void {
  for (const key of ARM) to[key] += arm[key];
}

const ARM = ['shrug', 'forward', 'out', 'twist', 'elbow'] as const satisfies readonly (keyof ArmPosture)[];

/** how near an angle a pose has come (rad; m for `lower`), and how long fingers take to, as far as `hold` is concerned (s) */
const COME = { angle: 0.02, lower: 0.01, fingers: 0.25 };

/**
 * How far each angle of `posture` has come, at its part's pace from where the last pose left off (the pose just before, if it flowed into
 * this one; else nothing) — its part's pace foreseen, not measured: what else the body does is left out. Met once it has come, `hold` s on.
 */
function pacing(self: Self, request: Request, posture: Posture, hold: number | undefined) {
  const creature = !self.species.person, each: { name: string; asked: number; near: number; ease: Easing }[] = [];
  const left = flowed.get(self), from = (name: string) => left && self.time - left.time <= 2 * self.frame.dt ? left.values.get(name) ?? 0 : 0;
  const field = (name: string, asked: number, near: number, easing: (from: number) => Easing) => each.push({ name, asked, near, ease: easing(from(name)) });
  for (const key of ['bow', 'twist', 'lean', 'lower'] as const) {
    const asked = posture[key];
    if (asked === undefined) continue;
    const near = key === 'lower' ? COME.lower : COME.angle;
    if (creature) field(key, key === 'lower' ? asked : Math.max(-POSED[key], Math.min(POSED[key], asked)), near, damped(key === 'lower' ? Infinity : POSED[key]));
    else field(key, asked, near, paced(key === 'lower' ? LOWER : BOW));
  }
  for (const [key, asked] of Object.entries(posture.head ?? {})) field(`head ${key}`, asked, COME.angle, paced(NOD));
  for (const side of SIDES) for (const [key, asked] of Object.entries(posture.arms?.[side] ?? {})) field(`${side} arm ${key}`, asked, COME.angle, paced(SWING));
  let elapsed = 0, come = NaN;
  return action<Frame>({
    init: () => () => flowed.set(self, { time: self.time, values: new Map(each.map(({ name, ease }) => [name, ease.value])) }),
    update: (f) => {
      elapsed += f.dt;
      for (const { asked, ease } of each) ease.step(asked, f.dt);
      if (hold === undefined) return;
      if (Number.isNaN(come) && each.every(({ asked, near, ease }) => Math.abs(ease.value - asked) <= near) && (!posture.fingers || elapsed >= COME.fingers)) come = elapsed;
      if (elapsed >= come + hold - 1e-9) request.met();
    },
  });
}

/** where each body's last pose left its angles as it ended, as `pacing` foresaw them, and when */
const flowed = new WeakMap<Self, { time: number; values: Map<string, number> }>();

/** an angle taken up at a part's pace: its value now, and a sub-step on toward `goal` */
interface Easing {
  readonly value: number;
  step(goal: number, dt: number): void;
}

/** an angle followed at `motion`'s pace (`follow`), from `from` at rest */
const paced = (motion: { accel: number; speed: number }) => (from: number): Easing => {
  const history = [from, from];
  return {
    get value() { return history[1]; },
    step(goal, dt) { [history[0], history[1]] = [history[1], follow(history[0], history[1], goal, motion, dt)]; },
  };
};

/** an angle eased critically damped at a creature's `EASING`, within ±`most`, from `from` at rest */
const damped = (most: number) => (from: number): Easing => {
  let x = from, v = 0;
  return {
    get value() { return x; },
    step(goal, dt) {
      v += (EASING ** 2 * (Math.max(-most, Math.min(most, goal)) - x) - 2 * EASING * v) * dt;
      x += v * dt;
    },
  };
};
