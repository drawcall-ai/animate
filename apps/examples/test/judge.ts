// The objective motion metrics: every metric over a run (`measure`) and the rules and per-scenario
// ratchets they are held to (`judge`), shared by metrics.test.ts and next.metrics.test.ts.
import { expect } from 'vitest';
import { Balance } from './balance';
import { Feet, FinalStance, Landings } from './body';
import type { Frame } from './frame';
import { GaitKinematics } from './gait';
import { ArmTurns, FreeArms } from './arms';
import { Headroom } from './headroom';
import { Flight } from './flight';
import { Climbing } from './climb';
import { Targets } from './targets';
import { Stairs } from './ground';
import { Vaulting } from './vault';
import { LadderClimbing } from './ladder';
import { Pushing } from './push';
import { Riding } from './ride';
import { JointRates, type JointClass } from './rates';
import { Boarding } from './board';
import { RangeOfMotion } from './rom';

/** ratchets: measured values, which may only go down */
export interface Limits {
  /** frames with the extrapolated centre of mass more than 10 cm outside the support */
  xcomFrames: number;
  /** centre of mass outside the feet while standing still (m) */
  com: number;
  /** frames with the ankles crossed (left right of right) */
  crossings: number;
  /** wrist error on full-weight targets within reach (m) */
  wrist: number;
  /** eye-midpoint error on full-weight head targets (m) */
  head: number;
  /**
   * setting off and stopping: the trunk's and pelvis's peak pitch rate over steady walking's
   * (a snap into or out of the walk shows as a spike; null: those windows hold more than a start and a stop)
   */
  startStop: number | null;
  /** two-footed jumps (both feet off the floor for longer than a running stride's flight) */
  jumps: number;
  /** climbs onto a ground box (the hands on its edge, then standing on top) */
  climbs: number;
  /** vaults over a wall (a hand on its top, the body over it) */
  vaults: number;
  /**
   * riding a mount: the most a foot is off its target (m), a limb reaches into the vehicle's
   * tubes or wheels (m) and a joint accelerates outside the vehicle's own jolts (m/s²)
   */
  ride?: { foot: number; into: number; spike: number };
  /** joint classes allowed past JOINT_SPEED or the teleport limit: their peak speed (°/s) and acceleration (k°/s²) */
  joints?: Partial<Record<JointClass, { speed?: number; accel?: number }>>;
  /** the ankle's angle (shank to foot, °) beyond ANKLE: what this scene reaches (known, to fix) */
  ankle?: [number, number];
  /** single joints (by bone) held to their own peak speed (°/s) and acceleration (k°/s²): what was fixed stays fixed */
  bones?: Record<string, { speed: number; accel: number }>;
  /**
   * getting on or into a vehicle: the most a hand or foot is off its target (m), a limb or the
   * head reaches into the vehicle's tubes or wheels (m), and a segment's peak angular
   * acceleration (°/s²: pops)
   */
  board?: { contact: number; into: number; accel: number };
  /** joints (by bone) allowed beyond their range of motion (the core's table; °): held limbs the solve takes past it (known, to fix) */
  rom?: Record<string, number>;
}

/**
 * Balance is a hard rule: the XCoM counts are known balance bugs to fix, not a budget, and
 * may only go down. (The chaotic sims move them by a few frames under tiny perturbations.)
 * walk-tray 7 → 9 and stroll 1 → 11 rose when the centre-of-mass estimate stopped scaling
 * with the distance from the world origin (balance.ts): the old counts were biased low.
 * fight's wrist error is back at 0.44 (round 1's value): its worst frame is a punch at a
 * target out of reach, which moves with where the fighters happen to stand.
 * vr's wrist error 0.093 → 0.145 with held hands kept a forearm out and the plan followed as
 * it moves off: diving to the floor (t ≈ 6 s) the hands trail the targets for a moment.
 * The strides (throw, sword, kick-ball) leave the XCoM up to 11 cm out for a frame or three
 * as a long stride is put down (the body falling onto the front foot, braked there) and on
 * one leg in the kick's backswing; their wrist errors are the striking hand trailing a
 * target faster than an arm (the slash's and the throw's follow-through) — throw 0.099 →
 * 0.139 and sword 0.158 → 0.179 since the chest's facing trails the pelvis's in a fast turn
 * (the hips lead): the shoulder comes round a little later behind the hand.
 * push's wrist error 0.02: as the pull builds (t ≈ 11.9 s) the arms are at full stretch.
 * Joints past the teleport limit, all in limbs held exactly on their ends (the joints'
 * dynamics leave a held end where the solve put it): step-over, stairs, vault and ladder's
 * knee straightening into its stop as a swing foot reaches out to its landing; fight's elbow
 * slamming straight punching at a target out of reach (its hand target's weight ramps in over
 * ~0.1 s); throw's and sword's stride and lunge foot turning flat as it is let go of a little
 * above the floor.
 * The ankle's range (ANKLE) was measured first in round 2, and these were already beyond it,
 * to fix: step-over's, vault's and vr's swinging feet flexed up ~80–90° (a level foot held
 * under a shank tilted back), aim-strafe's ~70° side-stepping; throw's and sword's stride and
 * lunge feet pointed ~50° as they are carried low and away.
 * `bones` hold what the joints' dynamics and the scripts fixed (measured, ~10% headroom; was):
 * kick-ball's arms going out for balance (2531°/s, 124k°/s²) and its foot set down after the
 * kick (1763°/s, 110k°/s²); the free arm tucking in and out in throw (5923°/s, 357k°/s²) and
 * sword (1975°/s, 199k°/s²); the throwing elbow slamming straight (5923°/s); in pickup-shelf
 * the thigh twisting as the knee swung round the box (1217°/s, 72k°/s²) and the elbows
 * flipping at full stretch (696°/s, 41k°/s²).
 * kick-ball's hip (rightUpperLeg) 720 → 880°/s in round 2: the backswing now extends the hip
 * ~20° and the thigh drives through from there (instep kicks flex the hip at ~600–900°/s).
 * `rom`: the joints' dynamics keep every joint in its range of motion but a held limb's (a hand
 * or foot on its target stays there): these are held limbs the solve takes past it, measured
 * (+1°), known, to fix — hands turned by their targets past what the forearm and wrist turn
 * (car's steering 135°, sword 134°, aim-strafe 97°, the push's and the ladder's grips 55–60°);
 * a hand target behind the shoulder (throw's wind-up 121°); legs keyed or stepped past the hip
 * (vault's and climb's legs swept over the top 84–140°, the horse's foot into the stirrup at hip
 * height 44°, reach's and vr's crossing and lunging steps 34–38°, sitting's thighs turned out
 * 23°, run's push-off extension 12–14°); planted ankles flexed up past the 40° of a lunge
 * (pickup-shelf's squat 44°, vr 46°, throw's and sword's long strides 36–48°); bicycle's riding
 * feet and grips 8–20° and the step-through's hip 6° (its abduction, flexed: clinically more
 * than the 45° of the neutral hip). horse's boarding acceleration 8400 → 8600°/s²: the forearm
 * reaching for the withers eases into the elbow's and wrist's ranges as its target comes in.
 */
export const LIMITS: Record<string, Limits> = {
  'walk-tray': { xcomFrames: 0, com: 0, crossings: 0, wrist: 0.002, head: 0, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  'pickup-shelf': { rom: { leftShoulder: 6, leftUpperArm: 28, leftUpperLeg: 10, rightShoulder: 5, rightUpperLeg: 10, rightFoot: 44 }, bones: { rightUpperLeg: { speed: 440, accel: 24 }, leftLowerArm: { speed: 570, accel: 34 }, rightLowerArm: { speed: 580, accel: 34 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.35, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  stroll: { xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  run: { rom: { leftUpperLeg: 14, rightUpperLeg: 12 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  sit: { rom: { leftUpperLeg: 23, leftFoot: 12, rightUpperLeg: 23, rightFoot: 10 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'step-over': { rom: { rightFoot: 4 }, ankle: [20, 147], joints: { knee: { accel: 90 } }, xcomFrames: 1, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  crouch: { xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  stairs: { joints: { knee: { accel: 92 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  vault: { rom: { leftUpperLeg: 125, leftFoot: 4, rightShoulder: 2, rightLowerArm: 8, rightHand: 35, rightUpperLeg: 140, rightLowerLeg: 13 }, ankle: [6, 148], joints: { knee: { accel: 98 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 1 },
  jump: { xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 1, climbs: 0, vaults: 0 },
  climb: { rom: { leftShoulder: 6, leftUpperArm: 43, leftHand: 63, leftUpperLeg: 84, rightShoulder: 10, rightUpperArm: 42, rightLowerArm: 2, rightHand: 38, rightUpperLeg: 122 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 1, vaults: 0 },
  ladder: { rom: { leftLowerArm: 7, leftHand: 32, leftUpperLeg: 5, rightShoulder: 9, rightUpperArm: 8, rightHand: 60, rightUpperLeg: 14 }, joints: { knee: { accel: 113 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  push: { rom: { leftShoulder: 4, leftHand: 55, leftFoot: 17, rightShoulder: 4, rightHand: 55, rightFoot: 17 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.02, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  reach: { rom: { leftUpperLeg: 3, leftFoot: 27, rightShoulder: 10, rightUpperArm: 28, rightUpperLeg: 38, rightFoot: 25 }, xcomFrames: 11, com: 0, crossings: 0, wrist: 0.647, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'look-around': { rom: { leftFoot: 2, rightFoot: 4 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0.055, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  vr: { rom: { leftShoulder: 6, leftUpperArm: 59, leftFoot: 46, rightShoulder: 6, rightUpperArm: 59, rightUpperLeg: 34 }, ankle: [20, 154], xcomFrames: 0, com: 0, crossings: 0, wrist: 0.145, head: 0.145, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  fight: { rom: { leftFoot: 2, rightUpperArm: 13, rightUpperLeg: 28, rightFoot: 14 }, joints: { elbow: { speed: 3500, accel: 210 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.44, head: 0.083, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'aim-strafe': { rom: { leftHand: 18, leftFoot: 23, rightHand: 97, rightFoot: 21 }, ankle: [20, 135], xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  throw: { rom: { leftFoot: 36, rightShoulder: 9, rightUpperArm: 121, rightLowerArm: 16 }, ankle: [10, 125], bones: { leftUpperArm: { speed: 260, accel: 23 }, leftLowerArm: { speed: 600, accel: 13 }, rightLowerArm: { speed: 1300, accel: 53 } }, joints: { ankle: { accel: 90 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.139, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  sword: { rom: { leftFoot: 48, rightShoulder: 3, rightUpperArm: 2, rightLowerArm: 44, rightHand: 134, rightFoot: 18 }, ankle: [12, 125], bones: { leftUpperArm: { speed: 500, accel: 23 }, leftLowerArm: { speed: 750, accel: 22 } }, joints: { ankle: { accel: 125 } }, xcomFrames: 1, com: 0, crossings: 0, wrist: 0.179, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'kick-ball': {
    bones: {
      leftUpperArm: { speed: 800, accel: 24 },
      rightUpperArm: { speed: 650, accel: 24 },
      leftLowerArm: { speed: 520, accel: 27 },
      rightLowerArm: { speed: 680, accel: 34 },
      rightUpperLeg: { speed: 880, accel: 38 },
      rightFoot: { speed: 1550, accel: 52 },
    },
    xcomFrames: 1, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  // bicycle: coming out of the turn the body's lean trails the bike's a little, and standing on the
  // pedals the pelvis passes close over the saddle (a step-through frame, no top tube: into
  // 0.054 → 0.028, its spike 63 → 34); skateboard: the peak is the pushing knee at full stretch;
  // car: the right knee comes up under the wheel's rim moving to the brake, the peak an arm going
  // round the wheel (push-pull); horse: the thighs lie against its sides. Getting on, the rides
  // start from a standstill: the horse's canter now meets its turn a moment later, its peak a
  // forearm on the reins there 45 → 64 (between 55 and 63 as the walk-off ramp shifts it).
  // Getting on: the horse's left arm lies along the neck holding the withers; the car's right thigh passes under the steering column; the driver's left hand
  // reaches out at full stretch for the door's pull (car wrist 0.018)
  bicycle: { rom: { leftHand: 10, leftFoot: 20, rightHand: 8, rightUpperLeg: 6, rightFoot: 19 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.012, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0.001, into: 0.028, spike: 34 }, board: { contact: 0.004, into: 0.011, accel: 7300 } },
  snowboard: { rom: { leftFoot: 5, rightFoot: 4 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0, into: 0, spike: 29 } },
  horse: { rom: { leftShoulder: 4, leftUpperArm: 46, leftLowerArm: 38, leftHand: 67, leftUpperLeg: 44, leftFoot: 31, rightShoulder: 8, rightUpperArm: 38, rightLowerArm: 17, rightHand: 66, rightUpperLeg: 31, rightFoot: 55 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.002, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0, into: 0.027, spike: 64 }, board: { contact: 0.008, into: 0.028, accel: 8600 } },
  car: { rom: { leftShoulder: 8, leftLowerArm: 84, leftHand: 135, leftUpperLeg: 25, rightShoulder: 7, rightLowerArm: 60, rightHand: 136, rightUpperLeg: 23, rightFoot: 17 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.018, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0, into: 0.029, spike: 77 }, board: { contact: 0.018, into: 0.01, accel: 21300 } },
  skateboard: { rom: { leftUpperLeg: 27, leftFoot: 14, rightFoot: 13 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0.004, into: 0, spike: 61 } },
};
/**
 * Each ride's references: [what, measured, [low, high]].
 * - cycling: the saddle set for a knee of 25–35° at the bottom of the stroke, ~110° at the top (Bini
 *   2011; Holmes 1994); the trunk 40–60° above horizontal on a road or hybrid bike
 * - boards (skate, snow): an athletic crouch, the knees soft (~30–70°), the trunk hinged forward
 *   over them ~15–35° (the shoulders over the feet)
 * - driving: knees ~50–70° and elbows ~60–80° bent, the trunk on a backrest reclined 20–25° (Park
 *   2000; Kyung & Nussbaum 2009)
 * - riding a horse: the legs long in the stirrups, knees ~60–80° bent, the trunk upright (Byström
 *   2009), elbows bent ~60–100°; rising ~5–10 cm out of the saddle trotting (posting)
 */
const RIDES: Record<string, (r: Riding) => [string, number, [number, number]][]> = {
  bicycle: (r) => [
    ['knee at the bottom of the stroke (°)', r.knee.seated.min, [25, 35]],
    ['knee at the top of the stroke (°)', r.knee.seated.max, [100, 120]],
    ['trunk above horizontal (°)', r.trunk.seated.mean, [40, 60]],
  ],
  skateboard: (r) => [
    ['knee (°)', r.knee.standing.mean, [30, 70]],
    ['trunk above horizontal (°)', r.trunk.standing.mean, [55, 75]],
  ],
  snowboard: (r) => [
    ['knee (°)', r.knee.standing.mean, [30, 70]],
    ['trunk above horizontal (°)', r.trunk.standing.mean, [55, 75]],
  ],
  car: (r) => [
    ['knee (°)', r.knee.seated.mean, [45, 75]],
    ['elbow (°)', r.elbow.mean, [50, 90]],
    ['trunk above horizontal (°)', r.trunk.seated.mean, [62, 75]],
  ],
  horse: (r) => [
    ['knee (°)', r.knee.seated.mean, [55, 85]],
    ['elbow (°)', r.elbow.mean, [50, 100]],
    ['trunk above horizontal (°)', r.trunk.seated.mean, [78, 90]],
    ['rising out of the saddle, most (m)', r.seatGap.max - r.seatGap.min, [0.05, 0.12]],
  ],
};

/**
 * The fastest each joint class turns in people (°/s; the joint's rotation in its parent's
 * frame): elite pitching peaks at ~1150 for the upper trunk, ~7500 for shoulder internal
 * rotation and ~2350 for elbow extension, each for the ~50 ms around release (Fleisig 1999);
 * a boxer's straight punch extends the elbow at ~2350 ± 540 (Cheraghi 2014); an instep kick's
 * knee extends at ~1000–1200 in youths (Kellis & Katis 2007), faster in adults; head turns in
 * gaze shifts stay under ~700. Distal joints are faster than proximal ones (Putnam 1993).
 * Everyday motion is far slower: reaching and handling peak at ~150–300 at the shoulder,
 * elbow and wrist (Herneth 2024), walking's knee at ~350–450.
 */
const JOINT_SPEED: Record<JointClass, number> = {
  trunk: 1200,
  neck: 700,
  clavicle: 1000,
  shoulder: 7500,
  elbow: 2900,
  wrist: 3000,
  hip: 2000,
  knee: 2500,
  ankle: 2500,
};
/**
 * A teleport: a joint getting up to its top speed faster than any human does — even an elite
 * throw's ~50 ms acceleration phase. A joint that jumps in a tick (1/60 s) peaks at ω·60 /s
 * against its own speed; nothing human gets there in under ~30 ms: α ≤ JOINT_SPEED / 0.03 s.
 */
const TELEPORT_TIME = 0.03;

/** for the target errors, which move a little with any change */
const HEADROOM = 0.02;
/**
 * The ankle's angle between the shank and the foot (knee → ankle, ankle → ball; °): ~60 standing,
 * the foot pointed ~40° at most (a kick's instep, a push-off), flexed up ~60° at most (a deep
 * squat's heels down; walking needs ~10–20°, AAOS)
 */
const ANKLE: [number, number] = [20, 125];
/** how far beyond the leg's length a planted foothold may be (m): rolled up onto the toes, a foot adds about its length */
const ON_TOES = 0.3;
/** how far a foot's sole points may sink into the floor (they roll on it) */
const FLOOR_SINK = 0.025;
/** the most a climb accelerates the root (m/s²: a hop's push-off, ~BOTTOM + g) and turns a joint (°/s: a countermovement jump's knee and arm swing peak at ~1000) */
const CLIMB_ACCEL = 25;
const CLIMB_RATE = 1000;
/** how far a landing may still move in the last 40% of a swing (m): later reads as a stumble */
const LATE_RETARGET = 0.03;

/** what `judge` reads of a scenario: its id (its limits) and whether its first actor stands its own way */
export interface Judged {
  id: string;
  actors: readonly { stance?: object }[];
}

/** the limits of scenario `id`; fails when it has none */
export function limitsOf(id: string): Limits {
  const limit = LIMITS[id];
  expect(limit, `no limits for ${id}`).toBeDefined();
  return limit;
}

/** every metric over a run of scenario `id`: `steps` gives each fixed step's frames, one per actor */
export function measure(id: string, steps: Iterable<readonly Frame[]>) {
  const feet = new Feet();
  const landings = new Landings();
  const balance = new Balance();
  // (the first actor's: the second fighter's targets are the first's defences, not a fit)
  const targets = new Targets();
  const gait = new GaitKinematics();
  const arms = new FreeArms();
  const stance = new FinalStance();
  const headroom = new Headroom();
  const flight = new Flight();
  const climbing = new Climbing();
  const stairs = new Stairs();
  const vaulting = new Vaulting();
  const ladders = new LadderClimbing();
  const pushing = new Pushing();
  const riding = new Riding();
  const rates = new JointRates();
  const boarding = new Boarding();
  const rom = new RangeOfMotion();
  const turns = new ArmTurns();
  let frames = 0;
  for (const step of steps) {
    frames++;
    step.forEach((f, i) => {
      feet.see(f);
      landings.see(f);
      balance.see(f);
      if (i === 0) targets.see(f);
      if (i === 0) gait.see(f);
      if (i === 0) arms.see(f);
      if (i === 0) stance.see(f);
      if (i === 0) headroom.see(f);
      if (i === 0) flight.see(f);
      if (i === 0) climbing.see(f);
      if (i === 0) stairs.see(f);
      if (i === 0) vaulting.see(f);
      if (i === 0) ladders.see(f);
      if (i === 0) pushing.see(f);
      if (i === 0) riding.see(f);
      if (i === 0) rates.see(f);
      if (i === 0) boarding.see(f);
      if (i === 0) rom.see(f);
      if (i === 0) turns.see(f);
    });
  }
  const report = [`== ${id} (${frames} frames)`, feet, landings, balance, targets, gait, arms, stance, headroom, flight, climbing, stairs, vaulting, ladders, pushing, riding, rates, boarding, rom, turns].join('\n');
  return { report, feet, landings, balance, targets, gait, arms, stance, headroom, flight, climbing, stairs, vaulting, ladders, pushing, riding, rates, boarding, rom, turns };
}

export type Measured = ReturnType<typeof measure>;

/** holds a run of `sc` (`m`) to the universal rules and its limits (`limit`, from `limitsOf`) */
export function judge(sc: Judged, m: Measured, limit: Limits) {
  expect(m.feet.slide, 'planted foot slide').toBeLessThan(1e-6);
  expect(m.feet.reach.value, `planted foothold out of the leg's reach (m, @${m.feet.reach.at.toFixed(2)}s)`).toBeLessThan(ON_TOES);
  expect(m.feet.hyper, 'knee-backward frames').toBe(0);
  const [ankleMin, ankleMax] = limit.ankle ?? ANKLE;
  expect(180 - m.feet.ankle.min.value, `ankle pointed (°, @${m.feet.ankle.min.at.toFixed(2)}s)`).toBeGreaterThanOrEqual(ankleMin - 1);
  expect(m.feet.ankle.max.value, `ankle flexed up (°, @${m.feet.ankle.max.at.toFixed(2)}s)`).toBeLessThanOrEqual(ankleMax + 1);
  expect(m.feet.inside, 'foot inside an obstacle (m)').toBeLessThan(0.005);
  expect(m.feet.lowest, 'foot below the floor (m)').toBeGreaterThan(-FLOOR_SINK);
  expect(m.landings.late.value, 'late landing retarget (m)').toBeLessThan(LATE_RETARGET);
  expect(m.feet.crossings, 'leg-crossing frames').toBeLessThanOrEqual(limit.crossings);
  expect(m.balance.xcomFrames, 'XCoM > 10 cm frames').toBeLessThanOrEqual(limit.xcomFrames);
  expect(m.balance.com, 'standing CoM outside the feet (m)').toBeLessThanOrEqual(limit.com + 1e-3);
  expect(m.targets.wrist, 'wrist error').toBeLessThanOrEqual(limit.wrist + HEADROOM);
  expect(m.targets.head, 'head error').toBeLessThanOrEqual(limit.head + HEADROOM);
  for (const [curve, run] of [[false, false], [false, true], [true, false], [true, true]]) {
    // (walking and running strides each against their own references)
    const g = m.gait.summary(curve, run);
    if (!g) continue;
    const where = `${curve ? 'curve' : 'straight'} ${run ? 'running' : 'walking'} strides`;
    // walking pelvis sway ~3–5 cm peak to peak (Orendurff 2004), a runner's less
    expect(g.pelvisLat, `${where}: pelvis lateral p2p (m)`).toBeGreaterThan(run ? 0.01 : 0.025);
    expect(g.pelvisLat, `${where}: pelvis lateral p2p (m)`).toBeLessThan(run ? 0.045 : 0.06);
    // the upper body rides the pelvis's sway, no wider, and stays near vertical over it
    expect(g.chestLat, `${where}: chest lateral p2p (m)`).toBeLessThan(g.pelvisLat + 0.005);
    expect(g.lean, `${where}: trunk lateral lean (°)`).toBeLessThan(2.5);
    expect(g.headRoll, `${where}: head roll (°)`).toBeLessThan(2);
    // smooth: one sway per stride, over the stance foot at mid-stance, no jitter
    expect(g.chestResidual, `${where}: chest sway beyond the stride frequency`).toBeLessThan(0.4);
    expect(g.chestJerk, `${where}: chest lateral jerk (m/s³)`).toBeLessThan(50);
    expect(g.phase, `${where}: pelvis over the stance foot at mid-stance`).toBeGreaterThan(0.7);
    // the whole body moves as in motion capture (CMU walks at 1.0–1.4 m/s, runs at 3.2–3.6):
    // the thorax rolls with its rotation, the forward shoulder up (corr ~0.95); the head goes
    // along with ~55% of that rotation; the trunk nods forward at each double support (±1.2°
    // walking, ±3° running); the ankle pushes off; the knee stays bent late into the swing
    expect(g.rollWithYaw, `${where}: thorax roll with its rotation`).toBeGreaterThan(0.7);
    expect(g.headCarry, `${where}: the head's share of the thorax rotation`).toBeGreaterThan(0.35);
    expect(g.headCarry, `${where}: the head's share of the thorax rotation`).toBeLessThan(0.8);
    expect(g.nod, `${where}: trunk nod (°)`).toBeGreaterThan(run ? 1 : 0.6);
    expect(g.nod, `${where}: trunk nod (°)`).toBeLessThan(run ? 3.5 : 3);
    expect(g.pushOff, `${where}: ankle push-off (°)`).toBeGreaterThan(run ? 30 : curve ? 8 : 15);
    expect(g.lateKnee, `${where}: knee at 3/4 of the swing (°)`).toBeGreaterThan(run ? 45 : 15);
    // free arms swing with the legs, one cycle per stride: each forward with the other leg,
    // a pendulum — one smooth sinusoid, turning back once at each end, no jolt there
    if (g.armRange > 10) {
      expect(g.armCycles, `${where}: arm swings per stride`).toBe(1);
      expect(g.armFit, `${where}: arm swing against one sinusoid (R²)`).toBeGreaterThan(0.97);
      expect(g.armTurns, `${where}: arm swing turning points per stride`).toBe(2);
      expect(g.armAcceleration, `${where}: arm swing peak acceleration (× the sinusoid's)`).toBeLessThan(2);
      expect(g.armCorrelation, `${where}: arm with the other leg`).toBeGreaterThan(0.7);
      expect(Math.abs(g.armLag), `${where}: arm lag (share of the stride)`).toBeLessThan(0.08);
    }
  }
  // setting off and stopping blend in and out of the walk: no pitch faster than walking's own
  const rates = m.gait.rates();
  if (limit.startStop !== null && rates) {
    for (const k of ['trunk', 'pelvis'] as const) {
      expect(rates.start[k], `setting off: ${k} pitch rate (°/s)`).toBeLessThanOrEqual(limit.startStop * rates.steady[k]);
      expect(rates.stop[k], `stopping: ${k} pitch rate (°/s)`).toBeLessThanOrEqual(limit.startStop * rates.steady[k]);
    }
  }
  // coming to rest in a relaxed stance: feet about hip-width apart (heels 0.10–0.15 H), turned
  // out a little, the pair centred under the body sideways and the pelvis over them (a slight
  // asymmetry at most); fore-aft the centre of mass stands over the feet's rear half
  const rest = m.stance.rest;
  if (m.stance.endsStanding && rest && !sc.actors[0].stance) {
    expect(rest.heels, 'at rest: heels apart (× height)').toBeGreaterThan(0.1);
    expect(rest.heels, 'at rest: heels apart (× height)').toBeLessThan(0.15);
    expect(Math.abs(rest.aside), "at rest: feet's midpoint off the CoM sideways (m)").toBeLessThan(0.02);
    expect(Math.abs(rest.pelvis), "at rest: pelvis off the feet's midpoint sideways (m)").toBeLessThan(0.02);
    expect(rest.ahead, "at rest: feet's midpoint ahead of the CoM (m)").toBeGreaterThan(0);
    expect(rest.ahead, "at rest: feet's midpoint ahead of the CoM (m)").toBeLessThan(0.065);
    for (const a of rest.toeOut) {
      expect(a, 'at rest: toe-out (°)').toBeGreaterThan(0);
      expect(a, 'at rest: toe-out (°)').toBeLessThan(12);
    }
  }
  // under a box overhead (a low ceiling, here 0.8 × height): nothing of the head or upper
  // trunk inside it, the head already under it as the eyes get there; a stoop, not a squat:
  // people duck mostly at the hips and lower back, the knees a little (O'Neill 2022 instruct
  // a bent-hip bent-knee walk as hip 50°, knee 30°, trunk 30° and measure the trunk at
  // 24–38°; restricted headroom flexes the lumbar spine most, Friedrich 2000), the head up
  // looking ahead, a little shorter steps, the arms swinging less, and no flight
  const { clip, entry, under, upright } = m.headroom;
  expect(clip.value, 'head or upper trunk inside a box (m)').toBeLessThan(0.01);
  if (under.frames) {
    expect(entry, 'head top under the box as the eyes reach it (m)').toBeGreaterThan(0.02);
    expect(under.knee.mean, 'under a box: mid-stance knee (°)').toBeGreaterThan(20);
    expect(under.knee.mean, 'under a box: mid-stance knee (°)').toBeLessThan(55);
    expect(under.trunk.mean, 'under a box: trunk forward (°)').toBeGreaterThan(35);
    expect(under.trunk.mean, 'under a box: trunk forward (°)').toBeLessThan(65);
    expect(under.gaze.max, 'under a box: head pitched down (°)').toBeLessThan(30);
    expect(under.step.mean / upright.step.mean, 'under a box: step over upright').toBeGreaterThan(0.8);
    expect(under.step.mean / upright.step.mean, 'under a box: step over upright').toBeLessThan(0.97);
    expect(under.speed.mean, 'under a box: speed (m/s)').toBeGreaterThan(0.7);
    expect(under.speed.mean, 'under a box: speed (m/s)').toBeLessThan(1.1);
    expect(under.armRange, 'under a box: arm swing (°)').toBeLessThan(0.95 * upright.armRange);
    expect(under.airborne, 'under a box: frames without a foot down').toBe(0);
  }
  // a standing jump (Linthorne 2001; Wakai & Linthorne 2005; Ashby & Heegaard 2002; Devita &
  // Skelly 1992; Norcross 2013): a countermovement of the pelvis by 0.2–0.35 m, lowest
  // 0.3–0.6 s into it, the arms swung back there and forward-up by takeoff; both feet leave
  // and land together, clear of what is jumped; a ballistic flight; a landing absorbed
  // by the knees, the pelvis back up within a second
  expect(m.flight.jumps.length, 'two-footed jumps').toBe(limit.jumps);
  for (const j of m.flight.jumps) {
    expect(j.landing - j.takeoff, 'jump: airborne (s)').toBeGreaterThan(0.3);
    expect(j.landing - j.takeoff, 'jump: airborne (s)').toBeLessThan(0.55);
    expect(j.gravity, 'jump: CoM vertical acceleration in flight (m/s²)').toBeGreaterThan(-9.81 * 1.15);
    expect(j.gravity, 'jump: CoM vertical acceleration in flight (m/s²)').toBeLessThan(-9.81 * 0.85);
    expect(j.apex, 'jump: CoM apex over standing (m)').toBeGreaterThan(0.15);
    expect(j.apex, 'jump: CoM apex over standing (m)').toBeLessThan(0.45);
    expect(j.depth, 'jump: countermovement depth (m)').toBeGreaterThan(0.2);
    expect(j.depth, 'jump: countermovement depth (m)').toBeLessThan(0.35);
    expect(j.toLowest, 'jump: lowest point after the load starts (s)').toBeGreaterThan(0.3);
    expect(j.toLowest, 'jump: lowest point after the load starts (s)').toBeLessThan(0.6);
    expect(j.backswing, 'jump: shoulder flexion near the lowest point (°)').toBeLessThan(-30);
    expect(j.armsUp, 'jump: shoulder flexion at takeoff (°)').toBeGreaterThan(90);
    expect(j.leave, 'jump: feet leaving apart (frames)').toBeLessThanOrEqual(1);
    expect(j.land, 'jump: feet landing apart (frames)').toBeLessThanOrEqual(1);
    expect(j.takeoffClear, 'jump: toes behind the near edge at takeoff (m)').toBeGreaterThan(0);
    expect(j.landingClear, 'jump: heels past the far edge on landing (m)').toBeGreaterThan(0);
    expect(j.landingKnee, 'jump: landing knee peak (°)').toBeGreaterThan(60);
    expect(j.landingKnee, 'jump: landing knee peak (°)').toBeLessThan(100);
    expect(j.landingKneeAt, 'jump: landing knee peak after contact (s)').toBeGreaterThan(0.08);
    expect(j.landingKneeAt, 'jump: landing knee peak after contact (s)').toBeLessThan(0.25);
    expect(j.recovery, 'jump: pelvis back within 3 cm of standing after contact (s)').toBeLessThan(1);
  }
  // climbing onto a box taller than the body (the parkour climb-up; UE5 Game Animation Sample
  // traversal): both hands stay on the edge from the grab until a foot is on top, nothing of
  // the body goes into the box, the hips are over the edge before the last foot comes up,
  // grab to standing takes a skilled climber 2–4 s, and the motion is continuous: no root
  // acceleration beyond the hop's push and catch, no joint faster than a jump's
  expect(m.climbing.climbs.length, 'climbs').toBe(limit.climbs);
  for (const c of m.climbing.climbs) {
    expect(c.handsOff, 'climb: frames a hand is off the edge before a foot is on top').toBe(0);
    for (const [part, depth] of Object.entries(c.depth)) expect(depth, `climb: ${part} into the box (m)`).toBeLessThan(part === 'sole' ? 0.005 : 0.01);
    expect(c.hipsOver, 'climb: hips over the edge as the last foot comes up (m)').toBeGreaterThan(0);
    expect(c.standing - c.grab, 'climb: grab to standing (s)').toBeGreaterThan(2);
    expect(c.standing - c.grab, 'climb: grab to standing (s)').toBeLessThan(4);
    expect(c.accel, 'climb: root acceleration (m/s²)').toBeLessThan(CLIMB_ACCEL);
    for (const [joint, rate] of Object.entries(c.rates)) expect(rate, `climb: ${joint} angular speed (°/s)`).toBeLessThan(CLIMB_RATE);
  }
  // walking up and down stairs (McFadyen & Winter 1988; Riener 2002; Protopapadaki 2007): each
  // planted foot flat on one tread, one riser a step, no sole in a step, the hips rising
  // steadily going up; going up the trunk a little forward, the knee meeting the step at
  // ~60° and lifted to 90–100° in the swing; going down, the knee nearly straight at contact
  // and the forefoot first; the toes clearing the noses by a few cm at 1.4–1.9 steps/s
  const st = m.stairs;
  for (const w of [st.up, st.down].filter((w) => w.steps)) {
    expect(st.tilt, 'stairs: planted ball off its tread (m)').toBeLessThan(0.02);
    expect(st.straddles, 'stairs: planted feet across a nose (frames)').toBe(0);
    expect(st.rise, 'stairs: a step rises (m)').toBeLessThan(0.18);
    expect(st.sink, 'stairs: sole into a step (m)').toBeLessThan(0.01);
    expect(st.dip, "stairs: hips' dip going up (m)").toBeLessThan(0.03);
    expect(st.accel.feet, 'stairs: feet peak acceleration (m/s²)').toBeLessThan(250);
    expect(w.cadence, 'stairs: cadence (steps/s)').toBeGreaterThan(1.4);
    expect(w.cadence, 'stairs: cadence (steps/s)').toBeLessThan(1.9);
    expect(w.clearance.mean, 'stairs: toe clearance mid-swing (cm)').toBeGreaterThan(3);
    expect(w.clearance.mean, 'stairs: toe clearance mid-swing (cm)').toBeLessThan(6);
  }
  if (st.up.steps) {
    expect(st.up.trunk.mean, 'stairs up: trunk forward (°)').toBeGreaterThan(4);
    expect(st.up.trunk.mean, 'stairs up: trunk forward (°)').toBeLessThan(12);
    expect(st.up.contactKnee.mean, 'stairs up: knee at contact (°)').toBeGreaterThan(50);
    expect(st.up.contactKnee.mean, 'stairs up: knee at contact (°)').toBeLessThan(70);
    expect(st.up.swingKnee.mean, 'stairs up: swing knee peak (°)').toBeGreaterThan(85);
    expect(st.up.swingKnee.mean, 'stairs up: swing knee peak (°)').toBeLessThan(105);
  }
  if (st.down.steps) {
    expect(st.down.contactKnee.mean, 'stairs down: knee at contact (°)').toBeLessThan(30);
    expect(st.down.strike.min, 'stairs down: foot at contact (° toes down)').toBeGreaterThan(8);
  }
  // vaulting a waist-high wall at a jog (a parkour speed vault; UE5 Game Animation Sample
  // traversal): a hand on the top, nothing of the body in the wall, the hips and feet over
  // it, the speed carried on, and the root continuous
  expect(m.vaulting.vaults.length, 'vaults').toBe(limit.vaults);
  for (const v of m.vaulting.vaults) {
    for (const [part, depth] of Object.entries(v.depth)) expect(depth, `vault: ${part} into the wall (m)`).toBeLessThan(0.01);
    expect(v.release - v.plant, 'vault: hand on the top (s)').toBeGreaterThan(0.15);
    expect(v.hipsOver, 'vault: hips over the top (m)').toBeGreaterThan(0.05);
    expect(v.feetOver, 'vault: soles over the top (m)').toBeGreaterThan(0.02);
    expect(v.speedOut / v.speedIn, 'vault: speed carried on').toBeGreaterThan(0.85);
    expect(v.accel, 'vault: root acceleration (m/s²)').toBeLessThan(CLIMB_ACCEL);
  }
  // climbing a ladder (OSHA's three points of contact; the contralateral pattern most climbers
  // use, Armstrong 2009): never fewer than three limbs on it, a hand always, nothing of the body
  // in the rungs, stiles or the wall behind, the trunk close to the rungs, a hand and the
  // opposite foot moving together, at a steady climbing speed
  for (const c of m.ladders.climbs) {
    expect(c.threePoint, 'ladder: frames with fewer than three limbs on it').toBe(0);
    expect(c.noHand, 'ladder: frames with no hand on it').toBe(0);
    for (const [part, depth] of Object.entries(c.depth)) expect(depth, `ladder: ${part} into the ladder or wall (m)`).toBeLessThan(0.01);
    expect(c.chest, 'ladder: chest out from the rungs (m)').toBeLessThan(0.45);
    expect(c.opposite, 'ladder: foot moves following the opposite hand').toBeGreaterThanOrEqual(0.8 * c.footMoves);
    expect(c.speed, 'ladder: climbing speed (m/s)').toBeGreaterThan(0.25);
    expect(c.speed, 'ladder: climbing speed (m/s)').toBeLessThan(0.6);
  }
  // pushing a heavy crate (Snook & Ciriello 1991; Hoffman 1993: hard pushes lean the body
  // 30–45° forward, the centre of mass well ahead of the feet, short steps, braced arms) and
  // pulling it back (the centre of mass behind the feet)
  const { push: pushed, pull } = m.pushing;
  if (pushed.frames) {
    expect(pushed.trunk.mean, 'pushing: trunk forward (°)').toBeGreaterThan(25);
    expect(pushed.trunk.mean, 'pushing: trunk forward (°)').toBeLessThan(50);
    expect(pushed.ahead.mean, 'pushing: CoM ahead of the feet (m)').toBeGreaterThan(0.2);
    expect(pushed.ahead.mean, 'pushing: CoM ahead of the feet (m)').toBeLessThan(0.45);
    expect(pushed.step.mean, 'pushing: stride (m)').toBeLessThan(0.8);
    expect(pushed.elbow.mean, 'pushing: elbow flexion (°)').toBeLessThan(90);
  }
  if (pull.frames) expect(pull.ahead.mean, 'pulling: CoM behind the feet (m)').toBeGreaterThan(0.05);
  if (pushed.frames || pull.frames) expect(m.pushing.inside, 'pushing: body into what is pushed (m)').toBeLessThan(0.01);
  // riding a mount: the feet on their targets, nothing into the vehicle, the whole body leaning
  // into its sideways acceleration as far as it balances itself (atan(a / g) × its lean share; the
  // lean trails fast changes a little), the head nearer level than the trunk, the eyes into the
  // turn, no joint accelerating in a spike, and each ride's own references (RIDES)
  const r = m.riding;
  expect(!!r.frames, 'rides a mount').toBe(!!limit.ride);
  if (limit.ride) {
    expect(r.foot.value, 'riding: foot off its target (m)').toBeLessThanOrEqual(limit.ride.foot + 0.005);
    expect(r.depth.value, 'riding: limb into the vehicle (m)').toBeLessThanOrEqual(limit.ride.into + 0.005);
    expect(r.soleDepth.value, 'riding: sole into the vehicle (m)').toBeLessThan(0.01);
    expect(r.spike.value, 'riding: joint acceleration (m/s²)').toBeLessThanOrEqual(limit.ride.spike);
    expect(Math.abs(r.leanError.mean), 'riding: body lean off balanced, mean (°)').toBeLessThan(2);
    expect(Math.max(-r.leanError.min, r.leanError.max), 'riding: body lean off balanced (°)').toBeLessThan(3 + 0.3 * r.leanMax.value);
    // (looking into a turn turns the head on a leaning trunk: its eyes' line tilts a little with it)
    expect(r.headRoll.mean, 'riding: head roll (°)').toBeLessThan(Math.max(2, 0.75 * r.trunkRoll.mean));
    // the eyes on the way ahead: into turns, and over the front shoulder standing sideways on a board
    if (r.gazeInto.n) expect(r.gazeInto.mean, 'riding: face turned into the turn (°)').toBeGreaterThan(5);
    if (r.faceOff.n) expect(r.faceOff.mean, 'riding sideways: face off the travel (°)').toBeLessThan(60);
    const refs = RIDES[sc.id];
    expect(refs, `no riding references for ${sc.id}`).toBeDefined();
    for (const [what, value, [lo, hi]] of refs(r)) {
      expect(value, `${sc.id}: ${what}`).toBeGreaterThan(lo);
      expect(value, `${sc.id}: ${what}`).toBeLessThan(hi);
    }
  }
  // no joint faster than people turn it, nor getting there faster than they can: no teleport
  for (const c of Object.keys(JOINT_SPEED) as JointClass[]) {
    const v = m.rates.velocity[c];
    const a = m.rates.acceleration[c];
    const own = limit.joints?.[c];
    expect(v.value, `${c} angular speed (°/s; ${v.joint} @${v.at.toFixed(2)}s)`).toBeLessThan(own?.speed ?? JOINT_SPEED[c]);
    expect(a.value, `${c} angular acceleration (°/s²; ${a.joint} @${a.at.toFixed(2)}s)`).toBeLessThan(own?.accel ? own.accel * 1000 : JOINT_SPEED[c] / TELEPORT_TIME);
  }
  for (const [bone, b] of Object.entries(limit.bones ?? {})) {
    const j = m.rates.joints[bone];
    expect(j, `no rates for ${bone}`).toBeDefined();
    expect(j.velocity.value, `${bone} angular speed (°/s; @${j.velocity.at.toFixed(2)}s)`).toBeLessThan(b.speed);
    expect(j.acceleration.value, `${bone} angular acceleration (°/s²; @${j.acceleration.at.toFixed(2)}s)`).toBeLessThan(b.accel * 1000);
  }
  // every joint within its range of motion (clinical norms, the core's table), but those a held
  // limb takes past it (rom)
  for (const [bone, j] of Object.entries(m.rom.joints)) {
    expect(j.value, `${bone} beyond its range of motion (°, @${j.at.toFixed(2)}s)`).toBeLessThan(limit.rom?.[bone] ?? 0.5);
  }
  // free arms swing as pendulums, setting off too (a runner's swing takes ~0.3 s): never back and forth quicker
  expect(m.turns.shortest.gap, `free arm swing: shortest between turns (s, @${m.turns.shortest.t.toFixed(2)}s)`).toBeGreaterThan(0.25);
  // getting on or into a vehicle: the contacts on their targets, nothing of the body (the head
  // too) into the vehicle, standing on its own feet balanced over them (and what the hands hold),
  // the soles not sliding on the floor, the segments turning at human speeds (limb peaks in
  // brisk everyday moves stay under ~650°/s: reaching, stepping up, a leg swung over a saddle)
  // and without pops
  const b = m.boarding;
  expect(!!b.frames, 'gets on a mount').toBe(!!limit.board);
  if (limit.board) {
    expect(b.contact.value, 'boarding: contact off its target (m)').toBeLessThanOrEqual(limit.board.contact + 0.005);
    expect(b.depth.value, 'boarding: body into the vehicle (m)').toBeLessThanOrEqual(limit.board.into + 0.005);
    expect(b.soles.value, 'boarding: sole into the vehicle (m)').toBeLessThan(0.02);
    expect(b.xcomFrames, 'boarding: XCoM > 10 cm frames standing').toBe(0);
    expect(b.slide.value, 'boarding: sole sliding on the floor (m/frame)').toBeLessThan(0.005);
    expect(b.rate.value, 'boarding: segment angular speed (°/s)').toBeLessThan(650);
    expect(b.accel.value, 'boarding: segment angular acceleration (°/s²)').toBeLessThanOrEqual(limit.board.accel);
  }
  const { standing, walking } = m.arms;
  // relaxed arms hang a little out from the side and swing clear of the thighs, never
  // in front of the pelvis (Collins 2009; Meyns 2013)
  for (const [what, a] of [['standing', standing], ['walking', walking]] as const) {
    if (!a.frames) continue;
    expect(a.handOut.min, `free arms ${what}: hand outside the hip joint`).toBeGreaterThan(a.hipHalf);
    expect(a.clearance.min, `free arms ${what}: hand clear of the thigh (m)`).toBeGreaterThan(0);
  }
  if (standing.frames) {
    expect(standing.abduction.min, 'free arms standing: abduction (°)').toBeGreaterThan(5);
    expect(standing.abduction.max, 'free arms standing: abduction (°)').toBeLessThan(12);
    expect(standing.elbow.max, 'free arms standing: elbow (°)').toBeLessThan(25);
  }
  if (walking.frames) {
    expect(walking.flexion.max, 'free arms walking: forward swing (°)').toBeGreaterThan(12);
    expect(walking.flexion.max, 'free arms walking: forward swing (°)').toBeLessThan(35);
    expect(walking.flexion.min, 'free arms walking: back swing (°)').toBeLessThan(-8);
    expect(walking.flexion.min, 'free arms walking: back swing (°)').toBeGreaterThan(-30);
  }
}
