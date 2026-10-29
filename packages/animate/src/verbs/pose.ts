import { action, parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
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
import { SWING } from '../hands/person/arms';
import { SIDES } from '../species/humanoid/bones';
import { verb, type Until, type Verb } from './story';

/** How a pose goes. */
export interface PoseOptions {
  /** ends on this; without it, it holds the posture until its story moves on */
  until?: Until;
}

/**
 * Poses `body` as `posture` has it, over whatever else it does (standing, walking, reaching, looking): a bow, a back arched with the chest
 * lifting, a turn or a sideways lean of the trunk, a nod or a tilt of the head, a person's arms raised, spread or bent. Each angle is added
 * onto what the body's own tasks ask (a reach's bow, a look's head, the arms' hang and swing), held in balance and within the joints, and
 * eased back out once the pose ends — so a nod is a short pose, and poses one after another flow into each other. Each eases in at its
 * part's own pace: a person's trunk at up to 1.2 rad/s (6 rad/s²; `lower` 0.6 m/s), its head and arms at up to 2.5 rad/s, so a 0.3 rad
 * nod is down in about a quarter second and back in as long; a creature's trunk closes about half the way in 0.3 s and 85% in 0.6 s, at
 * most 0.25 rad of bow and 0.15 of twist or lean (combined, they can still ask more than a big creature's legs follow). A pose that ends
 * before it has come two thirds of the way to an angle comes out that much smaller: hold it longer, or ask more within the joints;
 * `dev: { notes: true }` notes it. A walking person bows at most 0.5 rad. An aimer, it keeps on until `until`. It asks for the trunk's
 * posture with a trunk field, for the head's turn with `head` — not for the eyes: a look beside it keeps them, and the head turns over
 * where they look — and for each arm it poses; a hand verb or a held thing takes that arm over (`ArmPosture`).
 */
export function pose(body: Body, posture: Posture, options: PoseOptions = {}): Verb {
  const { head, arms, ...trunk } = posture;
  const angles = { ...trunk, ...head, ...Object.fromEntries(SIDES.flatMap((side) => Object.entries(arms?.[side] ?? {}).map(([name, value]) => [`${side} ${name}`, value]))) };
  for (const [name, value] of Object.entries(angles)) {
    if (!Number.isFinite(value)) throw new Error(`pose: ${name} ${value} is no number of radians or metres`);
  }
  const self = selfOf(body);
  if (head && !self.gazer) throw new Error(`pose: a ${body.species.name ?? 'custom species'} has no head to turn (no gaze)`);
  if (arms && !body.species.person) throw new Error(`pose: arms are a person's; a ${body.species.name ?? 'custom species'} has none to pose`);
  const asked = { bow: trunk.bow ?? 0, twist: trunk.twist ?? 0, lean: trunk.lean ?? 0, lower: trunk.lower ?? 0 };
  const posed = Object.keys(trunk).length > 0;
  return verb(body, 'pose', (request) => function* () {
    const posedArms = SIDES.flatMap((side) => {
      const arm = arms?.[side];
      return arm ? [{ side, arm: { shrug: 0, forward: 0, out: 0, twist: 0, elbow: 0, ...arm } }] : [];
    });
    yield* parallel('all',
      self.frame.dev !== undefined && pacing(self, posture),
      posed && during(request, 'trunk', 'asked', () => self.poise.add({ posture: asked })),
      head !== undefined && during(request, 'head', 'asked', () => self.headOffset.add(head)),
      ...posedArms.map(({ side, arm }) => during(request, `arm.${side}`, 'asked', () => add(personOf(self).armPose[side], arm))));
  }, options.until, true);
}

/** `arm` added onto `to` */
function add(to: Required<ArmPosture>, arm: Required<ArmPosture>): void {
  for (const key of ARM) to[key] += arm[key];
}

const ARM = ['shrug', 'forward', 'out', 'twist', 'elbow'] as const satisfies readonly (keyof ArmPosture)[];

/** how far of the way to an angle a pose must come before it ends for development to leave it unsaid, and the least angle worth saying
 * (rad; m for `lower`) */
const SHORT = 2 / 3, NOTED = { angle: 0.05, lower: 0.02 };

/**
 * development: how far each angle of `posture` has come, at its part's pace from where the last pose left off (the pose just before, if
 * it flowed into this one; else nothing), noted as the pose ends if it ended short of `SHORT` of the way — its part's pace foreseen, not
 * measured: what else the body does is left out
 */
function pacing(self: Self, posture: Posture) {
  const creature = !self.species.person, each: { name: string; asked: number; least: number; pace: string; ease: Easing }[] = [];
  const left = flowed.get(self), from = (name: string) => left && self.time - left.time <= 2 * self.frame.dt ? left.values.get(name) ?? 0 : 0;
  const field = (name: string, asked: number, least: number, pace: string, easing: (from: number) => Easing) => each.push({ name, asked, least, pace, ease: easing(from(name)) });
  for (const key of ['bow', 'twist', 'lean', 'lower'] as const) {
    const asked = posture[key];
    if (asked === undefined) continue;
    const least = key === 'lower' ? NOTED.lower : NOTED.angle;
    if (creature) field(key, asked, least, `a creature's trunk closes about half the way in 0.3 s${key === 'lower' ? '' : `, at most ${POSED[key]} rad`}`, damped(key === 'lower' ? Infinity : POSED[key]));
    else field(key, asked, least, key === 'lower' ? `a person lowers at up to ${LOWER.speed} m/s` : `a person's trunk turns at up to ${BOW.speed} rad/s`, paced(key === 'lower' ? LOWER : BOW));
  }
  for (const [key, asked] of Object.entries(posture.head ?? {})) field(`head ${key}`, asked, NOTED.angle, `a head turns at up to ${NOD.speed} rad/s`, paced(NOD));
  for (const side of SIDES) for (const [key, asked] of Object.entries(posture.arms?.[side] ?? {})) field(`${side} arm ${key}`, asked, NOTED.angle, `an arm turns at up to ${SWING.speed} rad/s`, paced(SWING));
  let began = NaN;
  return action<Frame>({
    init: () => () => {
      const values = new Map<string, number>();
      for (const { name, asked, least, pace, ease } of each) {
        values.set(name, ease.value);
        const share = ease.value / asked;
        if (Math.abs(asked) < least || share >= SHORT) continue;
        self.frame.dev?.note(self.time, { check: 'pose ended short of an angle (share of it come)', value: share, limit: SHORT, where: name,
          detail: `${ease.value.toFixed(3)} of ${asked} after ${(self.time - began).toFixed(2)} s: ${pace}; hold it longer or ask more` });
      }
      flowed.set(self, { time: self.time, values });
    },
    update: (f) => {
      if (Number.isNaN(began)) began = f.time - f.dt;
      for (const { asked, ease } of each) ease.step(asked, f.dt);
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
