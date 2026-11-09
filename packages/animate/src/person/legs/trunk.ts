// A person's trunk over its root: the asks eased, the hips and pelvis followed off it, and what the feet are told of them.
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Asks } from '../../kernel/asks';
import { follow, PointFollower, RotationFollower } from '../../kernel/follow';
import type { Frame } from '../../kernel/frame';
import { clampRotation } from '../../kernel/limits';
import { clamp, forwardOf, lerp, minimumJerk, quatYXZ, yawOf } from '../../kernel/math';
import type { LegGoal } from '../../step/leg-goal';
import type { Stepper } from '../../step/stepper';
import { xcomOfPoses } from '../../step/support';
import { INDEX, SIDES } from '../anatomy/bones';
import type { Person } from '../person';
import { QuietStance } from './quiet-stance';
import type { Seat } from './seat';
import { armsHeld } from './turn';
import type { Variation } from './variation';
import { LOWER, WalkPose, entrain, walkBlend, type TrunkPose, type WalkPoseState } from './walk-pose';
import type { Leg, Steering } from '../../step/types';

/**
 * How quickly a person's legs take it up to a pace and down from it (m/s²), which the trunk carries itself at — its lean into the
 * acceleration (`Inertia`) and its walking lean — however quick the root: read (Leteneur et al. 2013, PLoS ONE 8:e55256), setting off the
 * centre of mass is at 1.0 m/s by the first heel strike 0.96 s on, ~1 m/s², the trunk leaning ~7° over that step; read (Crenna, Cuong &
 * Brenière 2001, J Physiol, PMC2279001), stopping from a fast walk takes one stride in 98% of trials (30% from a natural one); recalled,
 * people brake about twice as hard as they speed up (the planner's `BRAKE_FACTOR` 2.2). Tuned: 1.5 and 3.3 — a player's 10 m/s² set-off
 * does not throw the trunk forward at ~100°/s, nor a stop back at ~45°/s; a planner's root, paced already, is carried as it goes.
 */
const PACE = { push: 1.5, brake: 3.3 };
/**
 * Tuned: the ankles' middle stands this far behind the centre of mass (m; walking, less leaves the extrapolated centre of mass past the
 * toes as the trailing foot lifts, more lowers the pelvis before contact)
 */
const OVER = 0.021;
/**
 * Tuned (rad): crouched with its hips sitting back behind its feet, the trunk bows this far forward at the deepest, bringing its mass
 * back over them — upright, a full crouch leaves the centre of mass ~1 cm behind the heels
 */
const CROUCH_LEAN = 0.3;
/**
 * Tuned: walking, a body lets its pelvis down at most this share of a squat (~0.26 m reaching low); a deeper ask waits for it to slow
 */
const WALKING_CROUCH = 0.5;
/**
 * Tuned (rad): walking, a story's posture bows the trunk at most this far (deeper, a 1.3 m/s walk's extrapolated centre of mass
 * leaves its feet by over 0.1 m at a 0.7 bow); it bows deeper as the walk slows, all of it standing
 */
const WALKING_BOW = 0.5;
/** Tuned: let down or up this far (m), the feet stay put but to catch a fall */
const LOWERED = 0.02;
/** how fast `lower` (m/s², m/s) and `bow` (rad/s², rad/s) are taken up and given back: a squat's pace */
const BOW = { accel: 6, speed: 1.2 };
/** how fast the pelvis (m/s²) and the trunk's joints (rad/s²) may change their motion: the gait's own oscillations, braked only at their kinks */
const PELVIS = { accel: 30 }, TURN = { accel: 60 };
/** Tuned (rad/s²): the trunk's joints turning after a look taken up at its own rate (`Asks.twistRate`), an aim tracking a turning view: at
 * `TURN`'s pace the chest would swing on past a quick turn that reverses, carrying what the body points with it off its line */
const AIMING = { accel: 300 };

/**
 * The body carried over a root, as `WalkPose` has it, in two parts around the stepper's move: `steer` before it reads what is asked and
 * says where the hips stand, `pose` after it turns the pelvis and spine over where the feet took the facing.
 */
export class Trunk {
  private readonly state: WalkPoseState;
  private readonly walkPose: WalkPose;
  private readonly life: QuietStance;
  private readonly posedTrunk: TrunkPose = { chest: new Quaternion(), pelvisYaw: 0, thoraxYaw: 0 };
  /** what was asked as eased so far, each `[prev2, prev]` */
  private readonly asked = { lower: [0, 0], bow: [0, 0], twist: [0, 0], lean: [0, 0], hips: [0, 0] };
  private readonly hips = new PointFollower();
  private readonly rotation = new RotationFollower();
  private readonly back = [new RotationFollower(), new RotationFollower()];
  private readonly tilts = [new Quaternion(), new Quaternion()];
  private offsets: Vector3[] | null = null;
  private pace: Vector3 | null = null;
  private phase = 0;
  /** the pelvis's turn with the stride off the facing, this sub-step */
  private tilt = new Quaternion();
  /** how far the trunk is bowed, this sub-step */
  private bow = 0;

  constructor(
    private readonly person: Person, private readonly stepper: Stepper, private readonly variation: Variation, seed: number,
    /** the depth (× scale) a story's `lower` is a share of, as a walker crouches whoever drives it */
    private readonly depth: number,
    standing: readonly { position: Vector3 }[],
  ) {
    this.state = {
      p: person.proportions, stride: person.stride, root: new Vector3(), velocity: new Vector3(), offset: new Vector3(), yaw: person.yaw, walk: 0, run: 0, moving: false,
      // (where the feet stood as the sub-step began: the posture shifts the weight between them)
      feet: standing.map((foot) => ({ anchor: foot.position.clone() })),
      pelvis: new Vector3(), pelvisRotation: new Quaternion(), held: false, unloading: null,
    };
    this.walkPose = new WalkPose(person.species.inertia);
    this.life = new QuietStance(seed, variation.sway);
  }

  /** The body carried off `root` for this sub-step, its hips told to the feet: returns what the stepper moves on. */
  steer(f: Frame, root: Steering, go: LegGoal | null, asks: Asks, seat: Seat | null): Steering {
    const { person, stepper, state, walkPose, life, posedTrunk, depth } = this, { proportions } = person, dt = f.dt, s = proportions.scale;
    // (the hips off the root first as they stand: off a scene's root, off the centre of mass a planner's starts at)
    if (!this.offsets) {
      const from = stepper.foreseen ? f.prev.com(new Vector3()).setY(0) : root.position;
      this.offsets = [f.prev2.position(0).clone().sub(from).setY(0), f.prev.position(0).clone().sub(from).setY(0)];
    }
    const offsets = this.offsets;
    // the hips carried off the root: swaying and turning with the stride, off a centre of mass's as far as the mass leans ahead of them
    const speed = root.velocity.length();
    state.walk = walkBlend(state.walk, speed, dt);
    state.moving = root.underway ?? person.locomotion.moving;
    state.yaw = stepper.yaw;
    state.held = armsHeld(person);
    const onto = stepper.onto(f.prev.com(_v));
    state.unloading = onto && { onto, lifted: !!stepper.legs[stepper.unloading ?? 0].swing };
    state.root.copy(root.position);
    state.velocity.copy(this.paced(root, dt));
    state.run = stepper.run;
    if (stepper.foreseen) state.offset.copy(walkPose.center(f));
    // (its quiet life: motion blends it out, the hands' too, as balance's: a quick turn of what they hold is not breathed through)
    const activity = Math.max(speed, ...[INDEX.leftHand, INDEX.rightHand].map((tip) =>
      f.prev.position(tip).distanceTo(f.prev2.position(tip)) / dt));
    life.update(dt, life.quiet(go, asks, person), activity, asks.steady);
    const requested = this.eased(asks, speed, stepper.settled, dt);
    const swing = stepper.legs.find((leg) => leg.swing)?.swing;
    // (the stride's phase pulled into step with the feet's, never jumping as a foot lifts; running, the stance leg compresses toward
    // mid-stance, as the stepper lets the pelvis down)
    this.phase = entrain(this.phase, stepper.phase, 2 * Math.PI / stepper.cycle, dt);
    const compressed = (leg: Leg) => leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / stepper.Ts)) ** 2;
    const compression = Math.min(1, stepper.legs.reduce((sum, leg) => sum + compressed(leg), 0));
    // (crouched over a root at its hips — sitting back behind the feet, the mass not held over the root — the trunk bows over them by
    // `CROUCH_LEAN`, as the legs take the crouch; on a seat, its weight borne there, it sits up)
    const stoop = stepper.foreseen ? 0 : CROUCH_LEAN * stepper.crouch * (1 - (seat?.share ?? 0));
    const cycle = { phase: this.phase, bob: swing ? Math.sin(Math.PI * swing.u) : 0, nod: swing ? Math.cos(2 * Math.PI * swing.u) : 1, compression, stance: stepper.Ts / stepper.cycle };
    const bow = this.bow = requested.bow + stoop;
    walkPose.place(f, state, { ...requested, bow }, posedTrunk, life, cycle);
    const carried = state.pelvis.clone().sub(state.root).setY(0);
    if (seat) carried.lerp(_v.copy(seat.seating.hips).sub(state.root).setY(0), seat.share);
    const offset = this.hips.follow(offsets[0], offsets[1], carried, PELVIS, dt, new Vector3());
    [offsets[0], offsets[1]] = [offsets[1], offset];
    // (the pelvis's turn with the stride followed off the facing; running, the legs are told of it before they reach from its hips —
    // reversed, it swings the stance hip back off its foot; walking, they reach from a pelvis square to its facing, as a walker's do)
    const { tilts } = this;
    const square = new Quaternion().setFromAxisAngle(UP, -state.yaw).multiply(state.pelvisRotation);
    const tilt = this.tilt = this.rotation.follow(tilts[0], tilts[1], square, asks.hips !== 0 ? AIMING : TURN, dt, new Quaternion());
    [tilts[0], tilts[1]] = [tilts[1], tilt.clone()];
    stepper.turn = yawOf(tilt) * state.run;
    this.toldHips(requested.hips);
    // (the stepper given the feet's middle — a centre of mass's `behind` it, the hips that far ahead of it again; let down as asked or
    // as the root crouches it, the feet staying put; balance read off the body as it last stood, as the checks read it)
    const behind = stepper.foreseen ? feetBehind(stepper, s) : ZERO, forecast = root.forecast;
    const lowered = crouchFor(requested.lower / (depth * s));
    const walkingMost = lerp(1, WALKING_CROUCH, MathUtils.smoothstep(speed, 0.2, 0.8));
    return {
      ...root,
      position: root.position.clone().sub(behind),
      forecast: forecast && ((t) => {
        const at = forecast(t);
        return { position: at.position.clone().sub(behind), yaw: at.yaw };
      }),
      // Remove the pelvis compensation from its offset: only the remaining sway and tracking lag displace the mass. The weight shifted onto a
      // foot standing, or off one to lift it, is a moment's: the feet step as from without it.
      hips: offset.clone().sub(walkPose.shifted).add(behind),
      shifted: walkPose.shifted,
      com: stepper.foreseen ? offset.clone().sub(state.offset).sub(walkPose.shifted).add(behind) : undefined,
      crouch: Math.max(root.crouch ?? 0, Math.min(lowered, walkingMost)),
      tiptoe: Math.max(0, -requested.lower),
      stagger: asks.stagger ?? undefined,
      still: !!seat || (!state.moving && Math.abs(requested.lower) > LOWERED * s && !asks.stagger),
      seated: !!seat,
      xcom: xcomOfPoses(f.prev, f.prev2, dt, proportions.legLength, new Vector3()),
    };
  }

  /** The pelvis turned with the stride over the stepper's facing; the lower back and thorax each take half the turn up to the chest. */
  pose(f: Frame, asks: Asks, yaw: number): void {
    const { state, person } = this;
    f.current.setLocal(0, this.tilt.premultiply(new Quaternion().setFromAxisAngle(UP, yaw)));
    const chest = new Quaternion().setFromAxisAngle(UP, yaw - state.yaw).multiply(this.posedTrunk.chest);
    const half = f.current.local(0).clone().invert().multiply(chest).slerp(new Quaternion(), 0.5);
    const impact = person.impact;
    impact.step(f.dt);
    [INDEX.spine, INDEX.chest].forEach((bone, k) => {
      const local = half.clone(), limit = f.current.skeleton.limits[bone];
      if (limit) clampRotation(local, limit);
      // Follow posture intent in its own history; the impulse already has physical recovery.
      const prev2 = f.prev2.local(bone).clone(), prev = f.prev.local(bone).clone();
      if (impact.active) {
        prev2.multiply(impact.prev2.clone().invert());
        prev.multiply(impact.prev.clone().invert());
      }
      const turned = this.back[k].follow(prev2, prev, local, asks.twistRate > 0 ? AIMING : TURN, f.dt, new Quaternion());
      if (impact.active) turned.multiply(impact.rotation);
      // (within the joint's range however quickly it was followed there: an aim's quick turn on top of a throw's hips overshot it)
      if (limit) clampRotation(turned, limit);
      f.current.setLocal(bone, turned);
    });
  }

  /** Where the feet stand now, for the next sub-step's posture to shift the weight between; what the stride tells the arms and eyes. */
  settle(legs: readonly Leg[]): void {
    const { stepper, posedTrunk } = this;
    legs.forEach((leg, i) => this.state.feet[i].anchor.copy(leg.anchor));
    Object.assign(this.person.gaitState, { phase: stepper.phase, walk: stepper.moving, run: stepper.run, pelvisYaw: posedTrunk.pelvisYaw, thoraxYaw: posedTrunk.thoraxYaw, bow: this.bow, arms: this.variation.arms });
  }

  /** the requested quiet stance displacement from the centred stance (m, world) */
  get quiet(): Readonly<Vector3> { return this.walkPose.quiet; }

  /** the pace the trunk carries itself at — leaning, running — that its legs could have taken it to, within `PACE`: a player's quicker root does not throw it; spawned on the move, at that pace */
  private paced(root: Steering, dt: number): Vector3 {
    const pace = this.pace ??= new Vector3(root.velocity.x, 0, root.velocity.z);
    const change = _v.set(root.velocity.x, 0, root.velocity.z).sub(pace);
    const most = (change.dot(pace) < 0 ? PACE.brake : PACE.push) * dt;
    if (change.length() <= most) pace.set(root.velocity.x, 0, root.velocity.z);
    else pace.addScaledVector(change, most / change.length());
    return pace;
  }

  /**
   * What is asked, eased: lowered, bowed and bent sideways at a squat's pace, twisted at the asked rate and the pelvis turned off the
   * facing with it, the story's posture added onto what the parts ask; tiptoe waits for settled feet so landing cannot drop the pelvis.
   */
  private eased(asks: Asks, speed: number, settled: boolean, dt: number) {
    const { asked } = this, posed = asks.posture, lower = asks.lower + posed.lower;
    const twist = atRate(asked.twist, asks.twist + posed.twist, asks.twistRate * dt, dt);
    const hips = atRate(asked.hips, asks.hips, asks.twistRate * dt, dt);
    const bowed = Math.min(asks.bow + Math.min(posed.bow, WALKING_BOW + Math.PI * (1 - MathUtils.smoothstep(speed, 0.2, 0.8))), asks.bowLimit);
    return {
      lower: followed(asked.lower, lower < 0 && !settled ? 0 : lower, LOWER, dt),
      // (bowed at the asked rate — a throw's — else at a squat's pace)
      bow: atRate(asked.bow, bowed, asks.bowRate * dt, dt),
      lean: followed(asked.lean, posed.lean, BOW, dt),
      twist,
      hips,
    };
  }

  /**
   * Rotate the hip offsets below the pelvis with its bow; lateral spacing and gait yaw remain the stepper's. Each hip's height takes the
   * pelvis's roll onto a foot as the weight shifts too: that hip rises and its leg must reach from there (else it stands over-reached,
   * its foot rolled up off its sole, and a foot stepped in place beside it lands on a straight knee that snaps bent). The walking list
   * turns the pelvis about the stance hip (recalled: Perry 1992, the swing side drops ~4°), where the stepper already plans the leg from.
   */
  private toldHips(hipsTurn: number): void {
    const { person: { proportions }, stepper, state, tilt } = this;
    const shift = quatYXZ(0, 0, this.walkPose.shiftRoll, _shift);
    stepper.feet.legs.forEach((leg, i) => {
      const offset = proportions.offsets[`${SIDES[i]}UpperLeg`];
      const hip = offset.clone().setX(0).applyQuaternion(tilt).applyAxisAngle(UP, -stepper.turn);
      // (a pelvis turned off the facing carries its hips round with it, as far as the stepper is not told of it, `stepper.turn`: reached for from square, a throw's planted foot slid)
      const across = _v.set(offset.x, 0, 0).applyAxisAngle(UP, hipsTurn * (1 - state.run));
      leg.hip = (across.x + hip.x) * leg.sign;
      leg.ahead = hip.z + across.z;
      leg.up = hip.y + _v.copy(offset).applyQuaternion(shift).y - offset.y;
    });
  }
}

/** where the feet's middle stands from the centre of mass (`OVER` behind it, facing as the stepper does; × `scale`) */
export const feetBehind = (stepper: Pick<Stepper, 'yaw'>, scale: number) => forwardOf(stepper.yaw).multiplyScalar(OVER * scale);

/**
 * A scalar taken to `goal` from its history (`[prev2, prev]`, shifted on): no further than `rate` a sub-step if one is asked, else at a
 * squat's pace, its older value first moved so it says no faster a motion than that pace's top speed: what a part taken at an asked rate
 * (a throw's bow) hands on once the rate is no longer asked — the trunk checked by the hips, not carried on at the asked rate into the
 * slower pace's braking, which would bow it far past where the asked motion ends.
 */
function atRate(history: number[], goal: number, rate: number, dt: number): number {
  if (rate > 0) {
    const next = history[1] + clamp(goal - history[1], -rate, rate);
    [history[0], history[1]] = [history[1], next];
    return next;
  }
  history[0] = history[1] - clamp(history[1] - history[0], -BOW.speed * dt, BOW.speed * dt);
  return followed(history, goal, BOW, dt);
}

/** a scalar followed to `goal` from its history (`[prev2, prev]`, shifted on) */
function followed(history: number[], goal: number, motion: { accel: number; speed: number }, dt: number): number {
  const next = follow(history[0], history[1], goal, motion, dt);
  [history[0], history[1]] = [history[1], next];
  return next;
}

/** the crouch (0 … 1) that lets the pelvis down `share` of the stepper's depth (its `minimumJerk` easing undone) */
function crouchFor(share: number): number {
  if (share <= 0 || share >= 1) return clamp(share, 0, 1);
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 24; k++) [lo, hi] = minimumJerk((lo + hi) / 2) < share ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  return (lo + hi) / 2;
}

const UP = new Vector3(0, 1, 0), ZERO = new Vector3(), _v = new Vector3(), _shift = new Quaternion();
