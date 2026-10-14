// The objective motion metrics: what a run measures (`measure`) and the rules and per-scenario
// ratchets it is held to (`checks`). The metrics of the scenarios rebuilt so far are measured —
// the feet, balance, held grips, gait and free arms, the rest stance, joint speeds and
// accelerations, ranges of motion; the rest come back with the behaviours they measure (git show
// 738b439:examples/test). The limits of every scenario id are kept as data, those of scenarios
// not yet rebuilt included: what they are to meet again.
import { ArmTurns, FreeArms } from './arms';
import { Balance } from './balance';
import { Clearance } from './clearance';
import { Feet, FinalStance, Landings } from './body';
import { Flow } from './flow';
import type { Frame } from './frame';
import { GaitKinematics, RUNNING } from './gait';
import { JointRates, type JointClass } from './rates';
import { RangeOfMotion } from './rom';
import { Targets } from './targets';

/** ratchets: measured values, which may only go down */
export interface Limits {
  /** the fewest steady walking strides judged, straight and on a curve: a run too short to show its gait fails rather than passing unjudged */
  strides?: { straight: number; curve: number };
  /** frames with the extrapolated centre of mass more than 10 cm outside the support */
  xcomFrames: number;
  /** centre of mass outside the feet while standing still (m) */
  com: number;
  /** frames with the ankles crossed (left right of right) */
  crossings: number;
  /** wrist error on held grips and tracked targets within reach (m): judged where something is held or tracked */
  wrist?: number;
  /** the eyes' error off a tracked head (m): judged where a head is tracked */
  head?: number;
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
  /** how deep the items handled reach into the body (m): judged where the scenario names what must keep out of it */
  clearance?: number;
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
 * look-around and reach are held to what the rebuilt runs measure: no joint past its range,
 * reach's centre of mass never 10 cm out (11 frames before), its wrist 0.647 → 0.15 (measured 0.10,
 * ≤ 0.13 over its variations: the hand reaching across the body and to the floor, its targets now
 * at a pace a calm hand follows and swung round the body rather than through it); look-around's
 * head error is the eyes over a bow setting in (measured 0.039, ≤ 0.062 over its variations). vr
 * keeps its old limits until its side-step passes (a strafe in `balance`).
 * pickup-shelf is held to what the rebuilt run measures: no joint past its range, no bone of its
 * own, the wrists within 2 cm of what they hold (measured ≤ 1.0 cm over its variations: the hands
 * carry the box, fitted to them, so only a sub-step's lag shows).
 * knight-arming is held to what its runs measure, in ~23 kg of harness, his gear's mass counted as
 * he bears it: his centre of mass never 10 cm out (≤ 9.4 cm over its variations, taking up the 5 kg
 * lance at arm's length); the wrists within 1 cm of what they hold — judged against 1 cm + HEADROOM
 * (2 cm, as every limit on the target errors), so 3 cm in effect (≤ 1.3 cm over its variations: the
 * hands at the chin strap lag the helm settling onto the head); what he
 * handles at most 1.5 cm into the body's capsules (≤ 1.3 cm: the scabbard by the left hand hanging
 * beside it; the capsules are themselves good to a cm or two); no joint past its range; his gait
 * judged on three steady strides bearing shield and lance.
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
  'hand-over': { xcomFrames: 0, com: 0, crossings: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'walk-tray': { xcomFrames: 0, com: 0, crossings: 0, wrist: 0.002, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  'pickup-shelf': { xcomFrames: 0, com: 0, crossings: 0, wrist: 0.02, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  stroll: { strides: { straight: 3, curve: 3 }, xcomFrames: 0, com: 0, crossings: 0, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  run: { rom: { leftUpperLeg: 14, rightUpperLeg: 12 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: 1.25, jumps: 0, climbs: 0, vaults: 0 },
  sit: { rom: { leftUpperLeg: 23, leftFoot: 12, rightUpperLeg: 23, rightFoot: 10 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'step-over': { rom: { rightFoot: 4 }, ankle: [20, 147], joints: { knee: { accel: 90 } }, xcomFrames: 1, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  crouch: { xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  stairs: { joints: { knee: { accel: 92 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  vault: { rom: { leftUpperLeg: 125, leftFoot: 4, rightShoulder: 2, rightLowerArm: 8, rightHand: 35, rightUpperLeg: 140, rightLowerLeg: 13 }, ankle: [6, 148], joints: { knee: { accel: 98 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 1 },
  jump: { xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 1, climbs: 0, vaults: 0 },
  climb: { rom: { leftShoulder: 6, leftUpperArm: 43, leftHand: 63, leftUpperLeg: 84, rightShoulder: 10, rightUpperArm: 42, rightLowerArm: 2, rightHand: 38, rightUpperLeg: 122 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 1, vaults: 0 },
  ladder: { rom: { leftLowerArm: 7, leftHand: 32, leftUpperLeg: 5, rightShoulder: 9, rightUpperArm: 8, rightHand: 60, rightUpperLeg: 14 }, joints: { knee: { accel: 113 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  push: { rom: { leftShoulder: 4, leftHand: 55, leftFoot: 17, rightShoulder: 4, rightHand: 55, rightFoot: 17 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.02, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  reach: { xcomFrames: 0, com: 0, crossings: 0, wrist: 0.15, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'knight-arming': { strides: { straight: 3, curve: 0 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.01, clearance: 0.015, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'look-around': { xcomFrames: 0, com: 0, crossings: 0, head: 0.055, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  vr: { rom: { leftShoulder: 6, leftUpperArm: 59, leftFoot: 46, rightShoulder: 6, rightUpperArm: 59, rightUpperLeg: 34 }, ankle: [20, 154], xcomFrames: 0, com: 0, crossings: 0, wrist: 0.145, head: 0.145, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  fight: { rom: { leftFoot: 2, rightUpperArm: 13, rightUpperLeg: 28, rightFoot: 14 }, joints: { elbow: { speed: 3500, accel: 210 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.44, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'aim-strafe': { rom: { leftHand: 18, leftFoot: 23, rightHand: 97, rightFoot: 21 }, ankle: [20, 135], xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  throw: { rom: { leftFoot: 36, rightShoulder: 9, rightUpperArm: 121, rightLowerArm: 16 }, ankle: [10, 125], bones: { leftUpperArm: { speed: 260, accel: 23 }, leftLowerArm: { speed: 600, accel: 13 }, rightLowerArm: { speed: 1300, accel: 53 } }, joints: { ankle: { accel: 90 } }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.139, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  sword: { rom: { leftFoot: 48, rightShoulder: 3, rightUpperArm: 2, rightLowerArm: 44, rightHand: 134, rightFoot: 18 }, ankle: [12, 125], bones: { leftUpperArm: { speed: 500, accel: 23 }, leftLowerArm: { speed: 750, accel: 22 } }, joints: { ankle: { accel: 125 } }, xcomFrames: 1, com: 0, crossings: 0, wrist: 0.179, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  'kick-ball': {
    bones: {
      leftUpperArm: { speed: 800, accel: 24 },
      rightUpperArm: { speed: 650, accel: 24 },
      leftLowerArm: { speed: 520, accel: 27 },
      rightLowerArm: { speed: 680, accel: 34 },
      rightUpperLeg: { speed: 880, accel: 38 },
      rightFoot: { speed: 1550, accel: 52 },
    },
    xcomFrames: 1, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 },
  // bicycle: coming out of the turn the body's lean trails the bike's a little, and standing on the
  // pedals the pelvis passes close over the saddle (a step-through frame, no top tube: into
  // 0.054 → 0.028, its spike 63 → 34); skateboard: the peak is the pushing knee at full stretch;
  // car: the right knee comes up under the wheel's rim moving to the brake, the peak an arm going
  // round the wheel (push-pull); horse: the thighs lie against its sides. Getting on, the rides
  // start from a standstill: the horse's canter now meets its turn a moment later, its peak a
  // forearm on the reins there 45 → 64 (between 55 and 63 as the walk-off ramp shifts it).
  // Getting on: the horse's left arm lies along the neck holding the withers; the car's right thigh passes under the steering column; the driver's left hand
  // reaches out at full stretch for the door's pull (car wrist 0.018)
  bicycle: { rom: { leftHand: 10, leftFoot: 20, rightHand: 8, rightUpperLeg: 6, rightFoot: 19 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.012, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0.001, into: 0.028, spike: 34 }, board: { contact: 0.004, into: 0.011, accel: 7300 } },
  snowboard: { rom: { leftFoot: 5, rightFoot: 4 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0, into: 0, spike: 29 } },
  horse: { rom: { leftShoulder: 4, leftUpperArm: 46, leftLowerArm: 38, leftHand: 67, leftUpperLeg: 44, leftFoot: 31, rightShoulder: 8, rightUpperArm: 38, rightLowerArm: 17, rightHand: 66, rightUpperLeg: 31, rightFoot: 55 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.002, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0, into: 0.027, spike: 64 }, board: { contact: 0.008, into: 0.028, accel: 8600 } },
  car: { rom: { leftShoulder: 8, leftLowerArm: 84, leftHand: 135, leftUpperLeg: 25, rightShoulder: 7, rightLowerArm: 60, rightHand: 136, rightUpperLeg: 23, rightFoot: 17 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0.018, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0, into: 0.029, spike: 77 }, board: { contact: 0.018, into: 0.01, accel: 21300 } },
  skateboard: { rom: { leftUpperLeg: 27, leftFoot: 14, rightFoot: 13 }, xcomFrames: 0, com: 0, crossings: 0, wrist: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0, ride: { foot: 0.004, into: 0, spike: 61 } },
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
/** the least share of the frames a wrist target is tracked that it is judged on (within reach) */
const TRACKED = 0.8;
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
/**
 * how far what the eyes are asked to look at may lie beyond what they turn comfortably in the head
 * (°, targets.ts EYES), once it stays put: where people's eyes still end a gaze shift — aside, the
 * customary ocular motor range, 44° wide (Stahl 1999: 2° past EYES' 20°); down, a near target's
 * preferred declination, 38° (Hill & Kroemer 1986: 8° past EYES' 30°)
 */
const GAZE = 5;
/** the widest a slow step lands the feet apart (× the stance's width) */
const WIDE = 1.5;
/** the most a steady stride's two step lengths differ (share of their mean) */
const ASYMMETRY = 0.05;
/** how far a planted ankle may be off its foothold beyond the foot's roll (m): the foot stands where it is said to */
const PLANTED = 0.01;

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
  const clearance = new Clearance();
  const flow = new Flow();
  let frames = 0;
  for (const step of steps) {
    frames++;
    step.forEach((f, i) => {
      feet.see(f);
      landings.see(f);
      balance.see(f);
      if (i > 0) return;
      for (const m of [targets, gait, arms, turns, stance, rates, rom, clearance, flow]) m.see(f);
    });
  }
  const report = [`== ${id} (${frames} frames)`, feet, landings, balance, targets, gait, arms, turns, stance, rates, rom, clearance].join('\n');
  return { report, feet, landings, balance, targets, gait, arms, turns, stance, rates, rom, clearance, flow };
}

export type Measured = ReturnType<typeof measure>;

/** a measure held to a bound: at most (`max`), at least (`min`) or exactly (`is`) `limit` */
export interface Check {
  what: string;
  value: number;
  bound: 'max' | 'min' | 'is';
  limit: number;
  /** what usually fixes it in a script */
  fix: string;
  /** when (s) and where (a bone, an item) its worst was */
  at?: number;
  where?: string;
  /** reported, not held to: no source sets its limit */
  advisory?: boolean;
}

export const failed = (c: Check) => !(c.bound === 'max' ? c.value <= c.limit : c.bound === 'min' ? c.value >= c.limit : c.value === c.limit);

/** how far a check is past its bound, relative to it (0: within it): to sort the worst first */
export const excess = (c: Check) => (failed(c) ? Math.abs(c.value - c.limit) / Math.max(Math.abs(c.limit), 1e-3) : 0);

/** what usually fixes each kind of failure, from the script's side */
const FIX = {
  balance: 'the body reaches or carries beyond its feet: let it walk nearer first (grab `stand`, walkTo `within`) or take the move slower',
  feet: "the legs' own solve (balance), seldom the script: a goal dragging the body (a hand target out of reach) — bring it within reach",
  turn: 'a turn on the spot or a sideways goal: give walkTo a `face` and let it turn as it walks',
  gait: 'the walk itself (balance), not the script: walk farther for steady strides to judge; otherwise report it with a minimal repro',
  free: "a hand at work judged as a free arm: report it busy (`reporting(report, ['leftHand', 'rightHand'], task)`) or let it go (`release`)",
  snap: 'a snap: a goal that jumps, a layer setting bones outright, or a task cut off mid-motion — move goals smoothly (`seconds`, `follow`) and hand over with `overlap`',
  target: 'the hand cannot stay on its target: out of reach or faster than an arm — walk nearer, slow it (`seconds`, `pace`) or brisken the arm (`turnAccel`)',
  head: 'the tracked head goes where the body cannot follow: slow it or keep it within a step',
  gaze: 'the eyes are asked to look too far aside or below the head: turn the body to it (`ask({ face })`, walkTo `face`) or bow',
  clearance: 'an item passes through the body: route its course out round the body (a waypoint in front) or hold it further out',
  rom: 'a joint turned past its range: turn the grip or target, or come at it from another side',
  done: "the scenario's `done()` is false at its end: a task never finished (an unreachable condition) or `duration` is too short",
  limits: 'add a LIMITS entry for the scenario (examples/test/judge.ts) holding what it measures',
} as const;

const UNIVERSAL: Limits = { xcomFrames: 0, com: 0, crossings: 0, startStop: null, jumps: 0, climbs: 0, vaults: 0 };

/**
 * the limits of scenario `id`, and whether they are its own: one without is held to the universal
 * rules, what it holds, tracks or handles judged at the defaults (the wrists and eyes within 2 cm,
 * items at most 1.5 cm into the body: the capsules are good to a cm or two)
 */
export function limitsFor(id: string, m: Measured): { limits: Limits; own: boolean } {
  const own = LIMITS[id];
  if (own) return { limits: own, own: true };
  return { limits: { ...UNIVERSAL, wrist: 0, head: m.targets.tracked.head ? 0 : undefined, clearance: m.clearance.frames ? 0.015 : undefined }, own: false };
}

/** a run (`m`) against the universal rules and its limits (`limit`, from `limitsFor`): every check, passed or failed */
export function checks(m: Measured, limit: Limits): Check[] {
  const out: Check[] = [];
  const add = (what: string, value: number, bound: Check['bound'], lim: number, fix: string, at?: number, where?: string) => void out.push({ what, value, bound, limit: lim, fix, at, where });
  add('planted foot slide (m)', m.feet.slide, 'max', 1e-6, FIX.feet);
  add('planted ankle off its foothold (m)', m.feet.off.value, 'max', PLANTED, FIX.feet, m.feet.off.at);
  add("planted foothold out of the leg's reach (m)", m.feet.reach.value, 'max', ON_TOES, FIX.feet, m.feet.reach.at);
  add('knee-backward frames', m.feet.hyper, 'max', 0, FIX.feet);
  const [ankleMin, ankleMax] = limit.ankle ?? ANKLE;
  add('ankle pointed (°)', 180 - m.feet.ankle.min.value, 'min', ankleMin - 1, FIX.feet, m.feet.ankle.min.at);
  add('ankle flexed up (°)', m.feet.ankle.max.value, 'max', ankleMax + 1, FIX.feet, m.feet.ankle.max.at);
  add('foot below the floor (m)', -m.feet.lowest, 'max', FLOOR_SINK, FIX.feet);
  add('late landing retarget (m)', m.landings.late.value, 'max', LATE_RETARGET, FIX.feet, m.landings.late.at);
  // stopping and standing, no wide catching steps: the feet land at most WIDE stances apart
  add('slow step width (× stance)', m.landings.wide.value, 'max', WIDE, FIX.balance, m.landings.wide.at);
  add('leg-crossing frames', m.feet.crossings, 'max', limit.crossings, FIX.turn);
  add('XCoM > 10 cm out of support (frames)', m.balance.xcomFrames, 'max', limit.xcomFrames, FIX.balance, m.balance.xcom.at);
  add('standing CoM outside the feet (m)', m.balance.com, 'max', limit.com + 1e-3, FIX.balance);
  // (what is held or tracked is judged: a head every frame it is asked, the wrists on most frames, out of reach only while walked to)
  if (limit.wrist !== undefined) add('wrist off its grip or target (m)', m.targets.wrist, 'max', limit.wrist + HEADROOM, FIX.target, m.targets.wristAt);
  else add('wrist error, unjudged (m)', m.targets.wrist, 'max', 0, FIX.limits);
  if (limit.head !== undefined) {
    add('eyes off the tracked head (m)', m.targets.head, 'max', limit.head + HEADROOM, FIX.head, m.targets.headAt);
    add('tracked head: frames judged', m.targets.tracked.head, 'min', 1, FIX.limits);
  } else add('tracked head, unjudged (frames)', m.targets.tracked.head, 'max', 0, FIX.limits);
  add('tracked wrists: frames judged (share of those asked)', m.targets.tracked.asked ? m.targets.tracked.judged / m.targets.tracked.asked : 1, 'min', TRACKED, FIX.target);
  add("gaze target beyond the eyes' comfortable turn (°)", m.targets.gaze, 'max', GAZE, FIX.gaze, m.targets.gazeAt);
  // (a gaze asked is judged somewhere: one always behind the body would pass unseen)
  if (m.targets.asked > 0) add('gaze: frames judged', m.targets.judged, 'min', 1, FIX.gaze);
  if (limit.strides) {
    const count = (curve: boolean) => m.gait.strides.filter((s) => s.curve === curve && s.speed <= RUNNING).length;
    add('steady straight walking strides judged', count(false), 'min', limit.strides.straight, FIX.gait);
    add('steady curve walking strides judged', count(true), 'min', limit.strides.curve, FIX.gait);
  }
  for (const [curve, run] of [[false, false], [false, true], [true, false], [true, true]]) {
    // (walking and running strides each against their own references)
    const g = m.gait.summary(curve, run);
    if (!g) continue;
    const gait = (what: string, value: number, bound: Check['bound'], lim: number) => add(`${curve ? 'curve' : 'straight'} ${run ? 'running' : 'walking'} strides: ${what}`, value, bound, lim, FIX.gait);
    // walking pelvis sway ~3–5 cm peak to peak (Orendurff 2004), a runner's less
    gait('pelvis lateral p2p (m)', g.pelvisLat, 'min', run ? 0.01 : 0.025);
    gait('pelvis lateral p2p (m)', g.pelvisLat, 'max', run ? 0.045 : 0.06);
    // the upper body rides the pelvis's sway, no wider, and stays near vertical over it
    gait('chest lateral p2p (m)', g.chestLat, 'max', g.pelvisLat + 0.005);
    gait('trunk lateral lean (°)', g.lean, 'max', 2.5);
    gait('head roll (°)', g.headRoll, 'max', 2);
    // smooth: one sway per stride, over the stance foot at mid-stance, no jitter
    gait('chest sway beyond the stride frequency', g.chestResidual, 'max', 0.4);
    // the steps alike: left and right as long, on a curve too
    gait('step length asymmetry', g.stepAsymmetry, 'max', ASYMMETRY);
    gait('chest lateral jerk (m/s³)', g.chestJerk, 'max', 50);
    gait('pelvis over the stance foot at mid-stance', g.phase, 'min', 0.7);
    // the whole body moves as in motion capture (CMU walks at 1.0–1.4 m/s, runs at 3.2–3.6):
    // the thorax rolls with its rotation, the forward shoulder up (corr ~0.95); the head goes
    // along with ~55% of that rotation; the trunk nods forward at each double support (±1.2°
    // walking, ±3° running); the ankle pushes off; the knee stays bent late into the swing
    gait('thorax roll with its rotation', g.rollWithYaw, 'min', 0.7);
    if (!Number.isNaN(g.headCarry)) {
      gait("the head's share of the thorax rotation", g.headCarry, 'min', 0.35);
      gait("the head's share of the thorax rotation", g.headCarry, 'max', 0.8);
    }
    gait('trunk nod (°)', g.nod, 'min', run ? 1 : 0.6);
    gait('trunk nod (°)', g.nod, 'max', run ? 3.5 : 3);
    gait('ankle push-off (°)', g.pushOff, 'min', run ? 30 : curve ? 8 : 15);
    gait('knee at 3/4 of the swing (°)', g.lateKnee, 'min', run ? 45 : 15);
    // free arms swing with the legs, one cycle per stride: each forward with the other leg,
    // a pendulum — one smooth sinusoid, turning back once at each end, no jolt there
    if (g.armRange > 10) {
      gait('arm swings per stride', g.armCycles, 'is', 1);
      gait('arm swing against one sinusoid (R²)', g.armFit, 'min', 0.97);
      gait('arm swing turning points per stride', g.armTurns, 'is', 2);
      gait("arm swing peak acceleration (× the sinusoid's)", g.armAcceleration, 'max', 2);
      gait('arm with the other leg', g.armCorrelation, 'min', 0.7);
      gait('arm lag (share of the stride)', Math.abs(g.armLag), 'max', 0.08);
    }
  }
  // setting off and stopping blend in and out of the walk: no pitch faster than walking's own
  const rates = m.gait.rates();
  if (limit.startStop !== null && rates) {
    for (const k of ['trunk', 'pelvis'] as const) {
      add(`setting off: ${k} pitch rate (°/s)`, rates.start[k], 'max', limit.startStop * rates.steady[k], FIX.gait);
      add(`stopping: ${k} pitch rate (°/s)`, rates.stop[k], 'max', limit.startStop * rates.steady[k], FIX.gait);
    }
  }
  // coming to rest in a relaxed stance: feet about hip-width apart (heels 0.10–0.15 H), turned
  // out a little, the pair centred under the body sideways and the pelvis over them (a slight
  // asymmetry at most); fore-aft the centre of mass stands over the feet's rear half
  const rest = m.stance.rest;
  if (m.stance.endsStanding && rest) {
    const stance = (what: string, value: number, bound: Check['bound'], lim: number) => add(`at rest: ${what}`, value, bound, lim, FIX.feet);
    stance('heels apart (× height)', rest.heels, 'min', 0.1);
    stance('heels apart (× height)', rest.heels, 'max', 0.15);
    stance("feet's midpoint off the CoM sideways (m)", Math.abs(rest.aside), 'max', 0.02);
    stance("pelvis off the feet's midpoint sideways (m)", Math.abs(rest.pelvis), 'max', 0.02);
    stance("feet's midpoint ahead of the CoM (m)", rest.ahead, 'min', 0);
    stance("feet's midpoint ahead of the CoM (m)", rest.ahead, 'max', 0.065);
    for (const a of rest.toeOut) {
      stance('toe-out (°)', a, 'min', 0);
      stance('toe-out (°)', a, 'max', 12);
    }
  }
  // free arms swing as pendulums, setting off too (a runner's swing takes ~0.3 s): never back and forth quicker
  // (no quicker: a half swing of exactly 15 frames is not)
  add('free arm swing: shortest between turns (s)', m.turns.shortest.gap, 'min', 0.25 - 1e-9, FIX.free, m.turns.shortest.t);
  // relaxed arms hang a little out from the side and swing clear of the thighs, never
  // in front of the pelvis (Collins 2009; Meyns 2013)
  const { standing, walking } = m.arms;
  for (const [what, a] of [['standing', standing], ['walking', walking]] as const) {
    if (!a.frames) continue;
    add(`free arms ${what}: hand outside the hip joint (m)`, a.handOut.min, 'min', a.hipHalf, FIX.free);
    add(`free arms ${what}: hand clear of the thigh (m)`, a.clearance.min, 'min', 0, FIX.free);
  }
  if (standing.frames) {
    add('free arms standing: abduction (°)', standing.abduction.min, 'min', 5, FIX.free);
    add('free arms standing: abduction (°)', standing.abduction.max, 'max', 12, FIX.free);
    add('free arms standing: elbow (°)', standing.elbow.max, 'max', 25, FIX.free);
  }
  if (walking.frames) {
    add('free arms walking: forward swing (°)', walking.flexion.max, 'min', 12, FIX.free);
    add('free arms walking: forward swing (°)', walking.flexion.max, 'max', 35, FIX.free);
    add('free arms walking: back swing (°)', walking.flexion.min, 'max', -8, FIX.free);
    add('free arms walking: back swing (°)', walking.flexion.min, 'min', -30, FIX.free);
  }
  // no joint faster than people turn it, nor getting there faster than they can: no teleport
  for (const c of Object.keys(JOINT_SPEED) as JointClass[]) {
    const v = m.rates.velocity[c];
    const a = m.rates.acceleration[c];
    const own = limit.joints?.[c];
    add(`${c} angular speed (°/s)`, v.value, 'max', own?.speed ?? JOINT_SPEED[c], FIX.snap, v.at, v.joint);
    add(`${c} angular acceleration (°/s²)`, a.value, 'max', own?.accel ? own.accel * 1000 : JOINT_SPEED[c] / TELEPORT_TIME, FIX.snap, a.at, a.joint);
  }
  for (const [bone, b] of Object.entries(limit.bones ?? {})) {
    const j = m.rates.joints[bone];
    if (!j) throw new Error(`no rates for ${bone}`);
    add(`${bone} angular speed (°/s)`, j.velocity.value, 'max', b.speed, FIX.snap, j.velocity.at, bone);
    add(`${bone} angular acceleration (°/s²)`, j.acceleration.value, 'max', b.accel * 1000, FIX.snap, j.acceleration.at, bone);
  }
  // what the body handles keeps out of it (the hands and arms holding or wearing it may touch it)
  if (limit.clearance !== undefined) {
    add('items: frames judged', m.clearance.frames, 'min', 1, FIX.limits);
    add('items into the body (m)', m.clearance.depth, 'max', limit.clearance, FIX.clearance, m.clearance.at, m.clearance.what);
  } else add('items handled, unjudged (frames)', m.clearance.frames, 'max', 0, FIX.limits);
  // every joint within its range of motion (clinical norms, the humanoid's ranges), but those a held
  // limb takes past it (rom)
  for (const [bone, j] of Object.entries(m.rom.joints)) add(`${bone} beyond its range of motion (°)`, j.value, 'max', limit.rom?.[bone] ?? 0.5, FIX.rom, j.at, bone);
  return out;
}

