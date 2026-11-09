import { action, parallel } from '@pmndrs/timeline';
import { during, type Request } from '../kernel/requests';
import type { Frame } from '../kernel/frame';
import type { ArmPosture, Posture } from '../kernel/asks';
import { selfOf, type Body } from '../body';
import type { Self } from '../body/self';
import { comingToRest, STILL } from '../kernel/rest';
import { personOf } from './person-of';
import { verb, type Until, type Verb } from './story';
import { shapeOf } from '../fingers/shape';
import { clamp } from '../kernel/math';

/** How a pose goes. */
export interface PoseOptions {
  /** ends on this, `true`; with neither this nor `hold`, it holds the posture until its story moves on */
  until?: Until;
  /** ends this many seconds after the parts it poses have come to rest, as measured: however far they got (`lower: 3` stops where the legs
   * do). A walking body's stride never rests, so walking it takes them to have come 1.2 s on; other motion that keeps a part moving, 3 s on */
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
 * second and back to relaxed once the pose ends; a hand holding something keeps its grasp, and a `grab` begun after the pose takes the fingers until its hand lets go. A person's `stagger` has its feet step apart
 * fore and aft, and hold there until the pose ends, then square up as a cut-off walk does (a step or a few, in up to about 3 s); `hold` then counts from their settling.
 */
export function pose(body: Body, posture: Posture, options: PoseOptions = {}): Verb {
  const { head, arms, fingers, stagger, ...trunk } = posture;
  const angles = { ...trunk, ...(stagger !== undefined && { stagger }), ...head, ...Object.fromEntries(SIDES.flatMap((side) => Object.entries(arms?.[side] ?? {}).map(([name, value]) => [`${side} ${name}`, value]))) };
  for (const [name, value] of Object.entries(angles)) {
    if (!Number.isFinite(value)) throw new Error(`pose: ${name} ${value} is no number of radians or metres`);
  }
  const self = selfOf(body);
  // (each foot half of it off the root, which stands over the feet's middle)
  const most = stagger === undefined ? 0 : STAGGER * personOf(body, 'pose stagger').proportions.legLength, off = clamp(stagger ?? 0, -most, most) / 2;
  if (head && !self.gazer) throw new Error(`pose: a ${body.species.name ?? 'custom species'} has no head to turn (no gaze)`);
  const armPose = arms && personOf(body, 'pose arms').armPose;
  const shapes = fingers ? shapesOf(self, body, fingers) : [];
  const asked = { bow: trunk.bow ?? 0, twist: trunk.twist ?? 0, lean: trunk.lean ?? 0, lower: trunk.lower ?? 0 };
  const posed = Object.keys(trunk).length > 0, { until, hold } = options;
  if (until !== undefined && hold !== undefined) throw new Error('pose: give `until` or `hold`, not both');
  if (hold !== undefined && !(hold >= 0 && hold < Infinity)) throw new Error(`pose: a hold of ${hold} s`);
  return verb(body, 'pose', (request) => function* () {
    const posedArms = armPose ? SIDES.flatMap((side) => {
      const arm = arms?.[side];
      return arm ? [{ side, into: armPose[side], arm: { shrug: 0, forward: 0, out: 0, twist: 0, elbow: 0, ...arm } }] : [];
    }) : [];
    yield* parallel('all',
      coming(self, request, posture, hold),
      // (under a walk its stride is the walk's: it stands so once there)
      stagger !== undefined && action<Frame>({ update: () => { if (!self.claims.owner('legs')) self.asks.add({ stagger: [off, -off] }); } }),
      posed && during(request, 'trunk', 'asked', () => self.asks.add({ posture: asked })),
      head !== undefined && during(request, 'head', 'asked', () => self.headOffset.add(head)),
      ...posedArms.map(({ side, into, arm }) => during(request, `arm.${side}`, 'asked', () => add(into, arm))),
      ...shapes.map(({ side, shape, state }) => during(request, `fingers.${side}`, 'asked', () => state.ask(side, shape))));
  }, { until, kind: 'aimer' });
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

const SIDES = ['left', 'right'] as const;
const ARM = ['shrug', 'forward', 'out', 'twist', 'elbow'] as const satisfies readonly (keyof ArmPosture)[];

/** Measured: the widest stagger (× the leg's length) feet settle on, at 0.7, 1 and 1.3 times the default person; wider, they never stop stepping */
const STAGGER = 0.35;

/** Tuned: the most a posture is waited for (s). Walking, the stride moves every part, so it is taken to have come by the time a walker's
 * bow and arms take at their paces; standing, another verb may keep a part moving for good. */
const LONGEST = { walking: 1.2, standing: 3 };

/** until the feet have stepped where they are asked and settled, or have had `LONGEST.standing` s to */
function* settling(self: Self) {
  let elapsed = 0;
  yield* action<Frame>({ until: (f) => (elapsed += f.dt) >= LONGEST.standing || self.locomotion.settled });
}

/** Met `hold` s after the parts `posture` poses have come to rest (`comingToRest`), however far they got. Given no `hold`, it keeps the pose on till its story ends it. */
function* coming(self: Self, request: Request, posture: Posture, hold: number | undefined) {
  if (hold !== undefined) {
    const { head, arms, fingers, stagger, ...trunk } = posture, person = self.species.person !== undefined;
    yield* comingToRest([
      ...(Object.keys(trunk).length ? [0, ...(person ? [self.skeleton.index('chest')] : [])] : []),
      ...(head && self.gazer ? [self.gazer.head] : []),
      ...SIDES.flatMap((side) => arms?.[side] ? [self.skeleton.index(`${side}UpperArm`), self.skeleton.index(`${side}LowerArm`)] : []),
    ], () => self.locomotion.moving ? LONGEST.walking : LONGEST.standing, fingers ? STILL.fingers : STILL.soonest);
    // (the feet stepped into it too: however still the trunk stood as they did)
    if (stagger !== undefined) yield* settling(self);
    let elapsed = 0;
    if (hold > 0) yield* action<Frame>({ until: (f) => { const over = elapsed >= hold - 1e-9; elapsed += f.dt; return over; } });
    request.met();
  }
  yield* action<Frame>({});
}
