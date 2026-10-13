// The objective motion metrics: what a run measures (`measure`) and the rules and per-scenario
// ratchets it is held to (`judge`). The metrics of the scenarios rebuilt so far are measured —
// the feet, balance, held grips, gait and free arms, the rest stance, joint speeds and
// accelerations, ranges of motion; the rest come back with the behaviours they measure (git show
// 738b439:examples/test). The limits of every scenario id are kept as data, those of scenarios
// not yet rebuilt included: what they are to meet again.
import { expect } from 'vitest';
import { ArmTurns, FreeArms } from './arms';
import { Balance } from './balance';
import { Feet, FinalStance, Landings } from './body';
import type { Frame } from './frame';
import { GaitKinematics } from './gait';
import { JointRates, type JointClass } from './rates';
import { RangeOfMotion } from './rom';
import { Targets } from './targets';

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
  /** joints (by bone) allowed beyond their range of motion (the humanoid's ranges; °): held limbs the solve takes past it (known, to fix) */
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
 * sword (1975°/s, 199k°/s²); the throwing elbow slamming straight (5923°/s).
 * pickup-shelf is held to what the rebuilt run measures: no joint past its range, no bone of its
 * own, the wrists within 2 cm of what they hold (measured ≤ 1.0 cm over its variations: the hands
 * carry the box, fitted to them, so only a sub-step's lag shows).
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
 * (vr 46°, throw's and sword's long strides 36–48°); bicycle's riding
 * feet and grips 8–20° and the step-through's hip 6° (its abduction, flexed: clinically more
 * than the 45° of the neutral hip). horse's boarding acceleration 8400 → 8600°/s²: the forearm
 * reaching for the withers eases into the elbow's and wrist's ranges as its target comes in.
 */
export const LIMITS: Record<string, Limits> = {
  'hand-over': { xcomFrames: 0, com: 0, crossings: 0, wrist: 0, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'walk-tray': { xcomFrames: 0, com: 0, crossings: 0, wrist: 0.002, head: 0, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  'pickup-shelf': { xcomFrames: 0, com: 0, crossings: 0, wrist: 0.02, head: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
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
/** how far a landing may still move in the last 40% of a swing (m): later reads as a stumble */
const LATE_RETARGET = 0.03;
/** how far the head may face off what the eyes are asked to look at, once it stays put (°): the eyes turn the rest in their sockets (~35° each way at most, the comfortable range half that) */
const GAZE = 35;
/** how far a planted ankle may be off its foothold beyond the foot's roll (m): the foot stands where it is said to */
const PLANTED = 0.01;

/** the limits of scenario `id`; fails when it has none */
export function limitsOf(id: string): Limits {
  const limit = LIMITS[id];
  expect(limit, `no limits for ${id}`).toBeDefined();
  return limit;
}

/** every metric over a run of scenario `id`: `steps` gives each fixed step's frames, one per actor (the feet and balance are every actor's, the rest the first's) */
export function measure(id: string, steps: Iterable<readonly Frame[]>) {
  const feet = new Feet();
  const landings = new Landings();
  const balance = new Balance();
  const targets = new Targets();
  const gait = new GaitKinematics();
  const arms = new FreeArms();
  const turns = new ArmTurns();
  const stance = new FinalStance();
  const rates = new JointRates();
  const rom = new RangeOfMotion();
  let frames = 0;
  for (const step of steps) {
    frames++;
    step.forEach((f, i) => {
      feet.see(f);
      landings.see(f);
      balance.see(f);
      if (i > 0) return;
      for (const m of [targets, gait, arms, turns, stance, rates, rom]) m.see(f);
    });
  }
  const report = [`== ${id} (${frames} frames)`, feet, landings, balance, targets, gait, arms, turns, stance, rates, rom].join('\n');
  return { report, feet, landings, balance, targets, gait, arms, turns, stance, rates, rom };
}

export type Measured = ReturnType<typeof measure>;

/** holds a run (`m`) to the universal rules and its limits (`limit`, from `limitsOf`) */
export function judge(m: Measured, limit: Limits) {
  expect(m.feet.slide, 'planted foot slide').toBeLessThan(1e-6);
  expect(m.feet.off.value, `planted ankle off its foothold (m, @${m.feet.off.at.toFixed(2)}s)`).toBeLessThan(PLANTED);
  expect(m.feet.reach.value, `planted foothold out of the leg's reach (m, @${m.feet.reach.at.toFixed(2)}s)`).toBeLessThan(ON_TOES);
  expect(m.feet.hyper, 'knee-backward frames').toBe(0);
  const [ankleMin, ankleMax] = limit.ankle ?? ANKLE;
  expect(180 - m.feet.ankle.min.value, `ankle pointed (°, @${m.feet.ankle.min.at.toFixed(2)}s)`).toBeGreaterThanOrEqual(ankleMin - 1);
  expect(m.feet.ankle.max.value, `ankle flexed up (°, @${m.feet.ankle.max.at.toFixed(2)}s)`).toBeLessThanOrEqual(ankleMax + 1);
  expect(m.feet.lowest, 'foot below the floor (m)').toBeGreaterThan(-FLOOR_SINK);
  expect(m.landings.late.value, 'late landing retarget (m)').toBeLessThan(LATE_RETARGET);
  expect(m.feet.crossings, 'leg-crossing frames').toBeLessThanOrEqual(limit.crossings);
  expect(m.balance.xcomFrames, 'XCoM > 10 cm frames').toBeLessThanOrEqual(limit.xcomFrames);
  expect(m.balance.com, 'standing CoM outside the feet (m)').toBeLessThanOrEqual(limit.com + 1e-3);
  expect(m.targets.wrist, 'wrist error').toBeLessThanOrEqual(limit.wrist + HEADROOM);
  expect(m.targets.gaze, 'gaze: head off the target asked (°)').toBeLessThan(GAZE);
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
    if (!Number.isNaN(g.headCarry)) {
      expect(g.headCarry, `${where}: the head's share of the thorax rotation`).toBeGreaterThan(0.35);
      expect(g.headCarry, `${where}: the head's share of the thorax rotation`).toBeLessThan(0.8);
    }
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
  if (m.stance.endsStanding && rest) {
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
  // free arms swing as pendulums, setting off too (a runner's swing takes ~0.3 s): never back and forth quicker
  expect(m.turns.shortest.gap, `free arm swing: shortest between turns (s, @${m.turns.shortest.t.toFixed(2)}s)`).toBeGreaterThan(0.25);
  // relaxed arms hang a little out from the side and swing clear of the thighs, never
  // in front of the pelvis (Collins 2009; Meyns 2013)
  const { standing, walking } = m.arms;
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
  // every joint within its range of motion (clinical norms, the humanoid's ranges), but those a held
  // limb takes past it (rom)
  for (const [bone, j] of Object.entries(m.rom.joints)) {
    expect(j.value, `${bone} beyond its range of motion (°, @${j.at.toFixed(2)}s)`).toBeLessThan(limit.rom?.[bone] ?? 0.5);
  }
}
