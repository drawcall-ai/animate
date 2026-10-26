// A reactive stepper: the scene moves the root, the legs step to keep up.
// Recalled: the procedural stepping of games (e.g. Rain World, Overgrowth, Unreal "Control Rig"
// foot placement): each foot has a home under its hip; it steps when it falls too far from it,
// landing where the home will be.
import { Quaternion, Vector3 } from 'three';
import { STEP as SUB_STEP, type Frame } from '../frame';
import type { ReadonlyPose } from '../pose';
import { follow } from '../follow';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, smoothstep, softMin, softplus, wrapAngle, yawOf } from '../math';
import { quintic } from './swing';
import { hullOf, outside, xcomOf, type Spot } from './support';
import { offsetAt, strideAt, type Gait } from './gait';

/**
 * The root a scene drives: its point on the floor, its velocity over it (m/s), its facing (rad about +Y), how far it crouches
 * (0 standing … 1 a deep crouch).
 */
export interface DrivenRoot {
  position: Vector3;
  velocity: Vector3;
  yaw: number;
  crouch?: number;
}

/** A root as the stepper takes it: a scene's (`DrivenRoot`), or the planner's and a walker's, who know more of the body over it. */
export interface RootGoal extends DrivenRoot {
  /** where the hips are over the floor from the root, if not over it (m): swaying, sitting back or leaning over the toes from it; by
   * default the hips are the root */
  hips?: Vector3;
  /** where the centre of mass is over the floor from the root, if the body keeps it there (m; a walker's: a little ahead of its feet's
   * middle, the root); by default over the root — the hips swaying about it, not the mass — the feet a crouch's `ahead` of the hips
   * as they sit back */
  com?: Vector3;
  /** how far up on the balls of its feet (m): the planted feet roll onto them as the hips rise */
  tiptoe?: number;
  /** the feet stay where they stand but to keep the balance or even out a staggered stance (a body let down or up to reach) */
  still?: boolean;
  /** the extrapolated centre of mass on the floor now, if the body knows it better than its root's (a pose's: its centre of mass carried
   * on at its speed for √(l/g)) */
  xcom?: Vector3;
  /** where it will be and face `ahead` s on, if it knows (a planner's root): a landing foresees that, not a straight run at its turning rate */
  forecast?: (ahead: number) => { position: Vector3; yaw: number };
  /** the turn (rad/s) it would make if its legs kept up, when they hold it back (a planner's): a gait's feet step to make way for it */
  turning?: number;
}

/**
 * A species' stepping, in metres of its default body (× `scale`) and seconds: each leg's place in the cycle (`offsets`, 0 … 1: a leg
 * follows the one just before it); the feet's `toeOut` (rad, × side);
 * the `cadence` (cycle 2 / (base + perSpeed v)); `duty` walking, side-stepping, running (`run`: between these speeds); the most `travel`
 * of a stance; the landing's `lead`; half the feet's spread (`width.stand` already scaled); the pelvis' `bob` and `drop`; the swing's
 * `lift` (a runner's ∝ u^`arc` (1 − u)³); the heel `strike`; the most a planted foot rolls (`pitch`, rad) and the ankle bends
 * (`dorsiflexion`); the `crouch`; the leg's `reach` (× length, a swinging leg's easing off from `swingReach`); the sole's `clearance`.
 */
export interface Stepping {
  scale: number; offsets: readonly number[]; toeOut: number; cadence: { base: number; perSpeed: number; side?: number };
  duty: { walk: number; side: number; run: number }; run: readonly [number, number]; travel: { forward: number; run: number; back: number; side: number };
  lead: { share: number; side: number; most: number; run: number }; width: { stand: number; walk: number; run: number; narrowest: number };
  bob: number; drop: { walk: number; side: number; run: number }; lift: { walk: number; run: number; jump: number }; arc: number;
  strike: { walk: number; run: number; ahead: number }; pitch: { heel: number; ball: number }; dorsiflexion: number;
  crouch: { depth: number; wider: number; ahead: number; travel: number; lift: number }; reach: number; swingReach: number; clearance: number;
  /** how far past the feet (m) the extrapolated centre of mass is caught by a step; none: the legs only follow the root (a player's) */
  capture?: number;
  /** how far the ankle plantarflexes just after the toes leave the floor (rad); none: it follows the foot */
  push?: number;
  /** the most the ankle points away from its shank (rad); none: no pointing limit */
  plantarflexion?: number;
  /** a gait whose cadence and duty the steps keep (a four-legged one's), in place of `cadence` and `duty` */
  gait?: Gait;
  /** the most the body turns from a planted foot (rad; default a person's): a leg that hardly twists steps sooner turning */
  twist?: number;
}

/**
 * A species' feet: each leg's side (+1 left) and bones, its hip's half width and the leg's lengths (m), the knee's most bend; where the
 * ankle is for a foot planted at `anchor` turned `yaw` and rolled `pitch`, the foot's turn, its sole's lowest point posed so, the shank's
 * lean over it in a pose.
 */
export interface Feet {
  /**
   * each leg's side (+1 left), its foot (and toes) and top bones; the leg across from it on its girdle (`partner`; default the one
   * before it in the gait); how far its top stands ahead of the root and out from it (m; default 0 and the hip's half width) and its home
   * ahead of it (m; default as its top), how far its
   * top joint is above the root standing (m; default 0) and the leg's length (m; default `length`)
   */
  legs: readonly {
    sign: 1 | -1; foot: number; toes?: number; top: number; partner?: number;
    ahead?: number; home?: number; hip?: number; up?: number; length?: number;
    /** how far below its top the leg reaches its foot (m) at an offset across (+ out from the body) and ahead of it (m), its joints'
     * ranges as they allow; none: a sphere of its length */
    depth?: (out: number, ahead: number, pitch?: number) => number;
    /** how far a planted foot may stray across from where it stands under its hip (m; none: a person's, inward only) */
    stray?: number;
    /** how far fore and aft together a planted foot reaches from under its hip, standing, its hip let down `drop` (m) */
    span?: (drop: number) => number;
  }[];
  hip: number; length: number; thigh: number; shin: number; ankleHeight: number;
  /** the knee's most bend (rad) */
  fold: number;
  ankle(i: number, anchor: Readonly<Vector3>, yaw: number, pitch: number, out: Vector3): Vector3;
  rotation(yaw: number, pitch: number, out: Quaternion): Quaternion;
  sole(i: number, ankle: Vector3, foot: Quaternion, toes: Quaternion): number;
  lean(i: number, pose: ReadonlyPose, yaw: number): number;
  /** the corners of the sole standing flat with its ankle at `anchor`, heading `yaw`, on the floor */
  print(i: number, anchor: Readonly<Vector3>, yaw: number): Spot[];
  /** a foot that pivots on the floor (a hoof, a paw): its ankle `anchor` standing flat turned from heading `from` to `to` about where it
   * stands, rolled `pitch`, in place */
  turnAbout?(i: number, anchor: Vector3, from: number, to: number, pitch: number): void;
}

export interface FootPose { ankle: Vector3; foot: Quaternion; toes: Quaternion; yaw: number }
interface Swing {
  capture: boolean; u: number; age: number; rest: number; T: number;
  x: Vector3; v: Vector3; a: Vector3; turn: { x: number; v: number; a: number };
  fromPitch: number; toes: Quaternion; strike: number; lift: number; run: number;
  rel: { x: number; v: number; a: number } | null;
}
export interface Leg {
  i: number; leapt?: boolean; sign: 1 | -1; anchor: Vector3; yaw: number; pitch: number; heel: boolean; free: boolean;
  planted: number; lifted: number; strike: number; landed: boolean; swing: Swing | null;
}
type Leap = {
  phase: 'ground' | 'launch' | 'air' | 'landed' | 'down' | 'up';
  since: number; speed: number; land: number; bottom: number; rise: number; vy: number; a: number;
};

/** The root as a sub-step reads it, and the pelvis' own rise and fall over it. */
interface Root {
  f: Frame;
  r: RootGoal;
  dt: number;
  /** its speed over the floor (m/s) and how far it runs (0 … 1) */
  v: number;
  run: number;
  /** how fast its velocity changes (m/s²) */
  accel: Vector3;
  /** how far down the legs have it crouched (0 … 1), the hips sitting back by it (m), how far up on its toes (m) */
  crouch: number;
  sitting: number;
  tiptoe: number;
  /** the pelvis' rise (m) and its speed (m/s): a leap's; in the air, the time (s) left till it lands */
  rise: number;
  vy: number;
  airborne: boolean;
  air: number;
  /** the facing it asks (rad, unwrapped near the pelvis'), its turn rate (rad/s), the turn a gait's feet step for and whether it is held back */
  wanted: number;
  spin: number;
  pressed: number;
  held: boolean;
}

/** A sub-step's stepping time: the cycle and its stance and swing (s), how far a stance travels (m) and a landing leads (s). */
interface Timing {
  /** the speed the cadence steps for (m/s), and how much of the root's motion is sideways (−1 … 1, + to the left) */
  pacing: number;
  across: number;
  C: number;
  duty: number;
  Ts: number;
  Tsw: number;
  most: number;
  lead: number;
}

/** The body over the feet this sub-step: its facing (rad), half the feet's spread (m), how far it walks (0 … 1), its standing height (m). */
interface Body extends Root, Timing {
  yaw: number;
  width: number;
  moving: number;
  standing: number;
  /** where the centre of mass is over the floor from the root (m) */
  over: Vector3;
}

/** A sub-step as its phases share it: the body, and the height a landing must hold the hip at (m) and how far out each foot may land so (m). */
interface Now extends Body {
  holding: number;
  reaches: number[];
}

/** What prompts a foot to step this sub-step: the one that catches a fall, how far a foot may be turned off the facing (rad) and where
 * the body turns to (rad). */
interface Cues {
  catcher: Leg | undefined;
  turn: number;
  turningTo: number;
}

/** Tuned: how far ahead (s) a gait's cadence takes the speed it will be going */
const PACING = 0.4;
/** Tuned: a root foreseen to move less than this (m) by a landing is all but standing */
const SETTLED_ROOT = 0.05;
/** how soon after its offset comes round a gait's foot lifts, and how long it stands first (shares of a cycle) */
const SLOT = 0.25;
/** the fewest feet a gait's body leaves on the floor */
const STANDING = 2;
/** how long a gait's foot bears weight once down before it lifts again (share of a cycle) */
const SETTLING = 0.1;
/** Derived: a gait's feet whose footfalls are within `TOGETHER` of a cycle leave the floor together (a trot's diagonals, 0.02 apart in
 * Clayton-Hobbs' offsets), the others at least that far apart (a walk's neighbours are 0.25 apart: half of that and more is clear of both) */
const TOGETHER = 0.1;
/** Derived: a walk's swing quickened by a turn is at most this share of its stance — its feet half a cycle apart on a girdle never in the
 * air together (Hildebrand's walk: more than half a cycle on the floor), the one landing `SETTLING` of a cycle before the other lifts */
const PAIRED = (0.5 - SETTLING) / (0.5 + SETTLING);
/** Tuned: a quickened walk lets go of the turn it quickened for no faster than this (rad/s²): held back and let go by the planner sub-step
 * by sub-step, its cadence would flicker, a swing quickened mid-air slamming down */
const SWEEPING = 4;
/** Tuned: walking, a planted foot is kept within reach toward its own turn this share of a cycle at most: the planner holds the root for
 * it rather than the foot stepping out of turn, and not so long the walk holds back a cycle for a foot that is nearly due */
const AWAIT = 0.1;
/** Tuned: a sole this far (m) above the floor in a final pose has left it (planted, it stands within 0.1 mm of it) */
const LIFTED = 0.005;
/** how much further behind than its stance takes it a gait's foot falls before it steps out of turn (share of a stance's travel) */
const BEHIND = 0.5;
/** Tuned: moving, a foot lifts whatever the others do once it has stood `DUE` stances or is `DUE` stances' travel off its home */
const DUE = 1.5;
/**
 * Tuned: a foot steps once it is due (its gait share of a cycle after the leg before it lifted; standing, after `square` s) and is
 * `distance` (m; standing still and upright: `still`, the stance squared up evenly) off its home, or turned `turn` (rad; still: `squared`)
 * off it; at once if it would hold the pelvis `short` (m) below its height, or is `medial` (m) in from its hip under the body, or a whole
 * stance's travel behind it
 */
const STEP = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/** Tuned: a step that would end `BLOCKED` (m) across the other foot waits for the other to step first (a walker's — a foreseen root's —
 * instead closes beside it) */
const BLOCKED = 0.05;
/** Tuned: a walker's foot closing beside the other needs no gap from it once `SPAN` (m) or more ahead or behind */
const SPAN = 0.25;
/** Tuned: a walker opens a side-step with the foot on the side it goes, moving more than `SIDE` of its speed sideways */
const SIDE = 0.5;
/** Tuned: a walker's foot lands flat but `BACKSTEP` (m) or more behind its hip */
const BACKSTEP = 0.1;
/** Tuned: still, the feet step only to even out feet `STAGGERED` (m) apart fore and aft */
const STAGGERED = 0.08;
/** Tuned: the pelvis turns at most `PELVIS_TURN` (rad) from a planted foot's facing (the trunk and gaze take the rest) */
const PELVIS_TURN = (50 * Math.PI) / 180;
/** Tuned: the pelvis turns toward its facing at most at `TURN` (rad/s², rad/s) */
const TURN = { accel: 80, speed: 8 };
/** Tuned: a landing foresees at most `SPIN` (rad/s) of the root's turn */
const SPIN = 1.5;
/** Tuned: turning steps as quick as walking `TURNING` m/s per rad/s turned or rad behind */
const TURNING = 0.5;
/** Tuned: a walker's pelvis never turns back past its root against the way the root turns `SENSING` s on */
const SENSING = 0.3;
/** Tuned: nor for `PAUSE` s after it stops turning */
const PAUSE = 0.5;
/** Tuned: slower than `SHUFFLING` (m/s), a walker's feet alternate */
const SHUFFLING = 0.6;
/** Tuned: a gait's footfalls shift toward another gait's at most this share of a cycle a cycle: a change of gait over a stride or two */
const SHIFT = 0.5;
/** Tuned: a strike rolls flat in `ROLL` s */
const ROLL = 0.1;
/** Tuned: the heel's lift eases in over `BEND` (rad) of a lean past the ankle's bend */
const BEND = 0.15;
/** Tuned: within `PIVOT` (m) of being over a planted foot the hip lets it settle flat to change the end it rolls on */
const PIVOT = 0.03;
/** Tuned: a root rising (getting up from a landing) asks `RISING` s sooner for a foot out of reach: it steps before its leg goes straight */
const RISING = 0.5;
/** Tuned: the feet let the pelvis down at most `LOWEST` (m: a foot past reach leaves the leg straight instead) */
const LOWEST = 0.12;
/** Tuned: the pelvis takes its height up again within `RISE` (m/s²) */
const RISE = { accel: 20 };
/** Tuned: a landing is kept within the leg's reach with the pelvis let down `drop` (m) more, never nearer than `least` (m) */
const LANDING = { drop: 0.06, least: 0.15 };
/** Tuned: a swing's duration grows with the gait's at most `PACE` (s/s) */
const PACE = 1;
/** Tuned: past `SETTLE` of a swing even a hard stop no longer moves its landing */
const SETTLE = 0.8;
/** Tuned: a walker's landing moves no more past `AIMED` of its swing */
const AIMED = 0.55;
/** Tuned: landing a leap, the foot comes down at `TOUCH` of the body's fall */
const TOUCH = 0.85;
/** Recalled (Perry 1992): the push-off peaks just after toe-off, gone by mid-swing; tuned: it eases in and out over the first `PUSHED` of a swing */
const PUSHED = 0.5;
/** a bend a foot lands on is read off the root's forecast `BEND_SPAN` s either side of its landing */
const BEND_SPAN = 0.1;
/** Tuned (the old balance shuffled hip-wide steps): a walker's slow step lands at most `WIDE.stances` standing stances aside of the other
 * foot, as balance lets it (1.1: within the metrics' 0.15 H for a straight stop), its extrapolated centre of mass kept within `within` (m) */
const WIDE = { stances: 1.1, within: 0.03 };
/** Tuned (shares of the crouch's depth /s², /s): how fast the legs take a crouch and rise from it — as a 0.25 s minimum-jerk crouch at its
 * peak, whatever the root asks (a crouch key pressed: a step) — so the feet keep to the floor as the pelvis drops and rises */
const CROUCHING = { accel: 90, speed: 7.5 };
/** Tuned (m/s): stepping sideways this fast, a body steps at its side-stepping cadence (slower, toward it) */
const SIDE_SPEED = 0.3;
/** Tuned: the least share of the narrowest stance a foot landing well ahead of or behind the other keeps from it sideways: walking, the feet
 * pass but never cross */
const PASSING = 0.4;
/**
 * Tuned leap: the dip and push before take-off (s; recalled: games leave the floor within ~0.1 s of
 * the press); how far below standing the feet meet the floor (m); the knees taking the landing over
 * `down` s, as deep as `depth` × the fall's speed × `down` (half that running), rising over `up` s.
 */
const JUMP = { launch: 0.1, contact: 0.02, down: 0.15, depth: 0.25, up: 0.3 };

/**
 * Legs under a root the scene drives (`move`, read every sub-step): the pelvis exactly over it,
 * facing its yaw (within a set turn of a planted foot), bobbing with the steps and let down by
 * `crouch`; each foot stays where it stands until it falls too far from its home under its hip
 * (or is turned too far from it), then steps — after the leg before it in the gait, with a flight running — to
 * where its home will be as it lands: re-aimed through the first half of the swing, frozen after;
 * heel first, rolling flat. Asked to `jump`, the legs dip, push off, follow the body's ballistic arc
 * (the root steering it over the floor) and land it, the knees taking up the fall.
 *
 * A root that foresees where it goes (a walker's, a planner's `forecast`) and one that does not (a player's, followed) step
 * the same way but where a walker's knows more: its landings, its pelvis' turn and the order its feet take (`yields`).
 */
export class Stepper {
  readonly legs: Leg[];
  /** the pelvis' facing (rad), how far it walks and runs (0 … 1), the gait's phase (rad), the stance's and cycle's durations (s); still
   * and squared up; off the floor (a leap's flight) */
  yaw: number; moving = 0; run = 0; phase = 0; Ts = 1; cycle = 2; settled = true; airborne = false;
  /** the pelvis' height its planted feet alone hold it at (m): its swinging ones not holding it down — what a running body's ride is let down from */
  held = 0;
  /** how far down it is crouched (0 … 1): the root's `crouch`, eased in and out no faster than legs bend and straighten */
  crouch = 0;
  /** the pelvis turned off its facing (rad, + to the left) as the body has it with the stride: the hips the legs reach from turned with it */
  turn = 0;
  private readonly crouches = [0, 0];
  /** the pelvis' turn motion, its velocity the root's turn rate this sub-step */
  private readonly turning = { ...TURN, velocity: 0 };
  /** each leg's one before it in the gait and its share of a cycle after it; the leg across its girdle and its share after that */
  private readonly before: number[]; private readonly gap: number[];
  private readonly pair: number[]; private readonly apart: number[];
  /** the pelvis' last two facings (rad) */
  private readonly yaws: number[];
  private asked: number | undefined; private stand = NaN; private last: number; private rootYaw: number;
  private readonly jumping: Leap = { phase: 'ground', since: 0, speed: 0, land: 0, bottom: 0, rise: 0, vy: 0, a: 0 };
  private low = NaN; private most = Infinity; private sense = 0; private paused = 0; private readonly hips = new Vector3();
  /** a gait's clock (cycles, 0 … 1): with a `gait`, each foot lifts in its turn as it passes the foot's offset */
  private clock = 0;
  /** how many of the other feet the gait has down as each lifts */
  private scheduled: number[] = [];
  /** where in the gait's cycle each foot lifts */
  private lifts: number[] = [];
  /** each foot's footfall in the gait's cycle (0 … 1), as it shifts toward the gait's at its pace */
  private footfalls: number[];
  /** whether each gait's foot let its turn pass held down, and steps as soon as it may */
  private owed: boolean[] = [];
  /** whether a gait's cycle is under way */
  private going = false;
  /** how far a gait's clock has run since it set off from standing (cycles): a foot is in its turn only for a turn that has come round
   * since, and overdue only for a stance it has stood since — standing, every foot has stood long, and the one before the first in the
   * gait is still in its turn as the clock starts */
  private since = 0;
  /** the turn (rad/s) a walk's stride is quickened for: let go of no faster than `SWEEPING` (rad/s²) */
  private sweeping = 0;
  /** which soles were off the floor in the last final pose `check` read */
  private aloft: boolean[] | null = null;
  /** how fast (1/m … per rad) a gait's turn uses up its feet's stray: the hips' furthest from the root over the feet's narrowest sweep */
  private readonly sweep: number;
  /** where the pelvis stands this sub-step, and a hip's place worked out from it: kept for `pose`, which plants feet after `move` */
  private readonly pelvis = new Vector3(); private readonly hipScratch = new Vector3();
  private readonly heights = [0, 0]; private readonly velocity = new Vector3(); private poses: (FootPose | null)[] = [];
  /** the last `move`'s sub-step: what `pose` plants the feet by and `reachable` re-aims their landings for */
  private now: Now | undefined;

  constructor(private readonly st: Stepping, private readonly feet: Feet, at: readonly { position: Vector3; yaw: number }[], yaw: number) {
    this.legs = at.map((foot, i) => ({
      i, sign: feet.legs[i].sign, anchor: foot.position.clone(), yaw: foot.yaw, pitch: 0, heel: true, free: true,
      planted: 1, lifted: 1, strike: 0, landed: false, swing: null,
    }));
    // (each leg's one before it: the one whose offset comes round last before its own)
    const sooner = (o: number, p: number, best: number) => best < 0 || mod(o - p) < mod(o - st.offsets[best]);
    this.before = st.offsets.map((o, i) => st.offsets.reduce((best, p, j) => j !== i && sooner(o, p, best) ? j : best, -1));
    this.gap = st.offsets.map((o, i) => mod(o - st.offsets[this.before[i]]));
    this.pair = feet.legs.map((leg, i) => leg.partner ?? this.before[i]);
    this.apart = st.offsets.map((o, i) => mod(o - st.offsets[this.pair[i]]));
    this.yaw = this.last = this.rootYaw = yaw;
    this.yaws = [yaw, yaw];
    this.footfalls = [...st.offsets];
    const strays = feet.legs.map((leg) => leg.stray);
    const furthest = Math.max(...feet.legs.map((leg) => Math.hypot(leg.hip ?? feet.hip, leg.ahead ?? 0)));
    const sweeps = st.gait && strays.every((stray) => stray !== undefined && stray > 0);
    this.sweep = sweeps ? furthest / (2 * Math.min(...strays.map((stray) => stray ?? Infinity))) : Infinity;
  }

  /** Ask for a leap at `speed` (m/s up): taken up on the next sub-step standing or rising from a landing. */
  jump(speed: number) { this.asked = speed; }

  /**
   * Step for this sub-step under `r` and set the root's position; the swinging feet's poses are planned now, the planted ones by `pose`
   * once the hips are placed. A sub-step reads the root, times the stance, faces the pelvis; carries the swings on, cues and clocks the
   * steps and lifts the feet that are due; then places the pelvis as high as the feet let it.
   */
  move(f: Frame, r: RootGoal) {
    const { st, legs } = this, s = st.scale;
    const root = this.read(f, r);
    const timing = this.timing(root);
    const yaw = this.face(root);
    const { v, crouch: k, run, tiptoe } = root;
    const timed = { ...root, ...timing };
    const body: Body = {
      ...timed, yaw, width: this.widthAt(timed, v), moving: smoothstep(0, 1, v),
      standing: this.stand - st.crouch.depth * s * k + tiptoe, over: _over.copy(r.com ?? ZERO).setY(0),
    };
    const now: Now = { ...body, ...this.landingReach(body) };
    this.now = now;
    this.carry(now);
    const cues = this.cue(now);
    this.keepTime(now, cues);
    this.liftFeet(now, cues);
    this.placePelvis(now);
    const stepping = legs.some((leg) => leg.swing);
    this.phase += Math.PI * now.dt / (now.C / 2) * Number(stepping);
    [this.yaw, this.moving, this.run, this.Ts, this.cycle] = [yaw, now.moving, run, now.Ts, now.C];
    const still = !(v > 0.05 || stepping) && legs.every((leg) => leg.planted > 0.4);
    this.settled = still && legs.every((leg) => !this.wants(now, cues, leg));
    // (a gait's body as low as its running lets it down)
    const drop = this.clocked ? lerp(st.drop.walk, st.drop.run, run) : 0;
    [this.low, this.most] = [now.standing - (drop + st.bob + STEP.short) * s, now.most];
  }

  /**
   * Development check of the last final pose (`f.prev`): a gait's feet leave the floor one by one, in its order — only those whose
   * footfalls it has within `TOGETHER` of a cycle (a trot's diagonals) together; a leap's all at once — and, walking, two whose turns are a
   * swing or more apart (a girdle's) are never in the air together.
   */
  check(f: Frame) {
    if (!f.dev || !this.clocked) return;
    const { feet, legs } = this, was = this.aloft;
    const aloft = legs.map((leg) => {
      const { foot, toes } = feet.legs[leg.i], rotation = f.prev.rotation(foot);
      return feet.sole(leg.i, f.prev.position(foot), rotation, toes === undefined ? rotation : f.prev.rotation(toes)) > LIFTED;
    });
    this.aloft = aloft;
    if (!was || this.airborne) return;
    const name = (leg: Leg) => f.prev.skeleton.bones[feet.legs[leg.i].foot].name, now = this.now;
    // (a walk — more than half a cycle on the floor as it steps now, each foot in a turn of its own — never has two whose footfalls are half
    // a cycle apart in the air together: a girdle's; a walk's stance cut short past half the cycle is a run's)
    if (now && now.Ts / now.C >= 0.5 && this.walking()) for (const a of legs) for (const b of legs) {
      const d = mod(this.footfalls[a.i] - this.footfalls[b.i]), value = Math.min(d, 1 - d);
      if (b.i <= a.i || !aloft[a.i] || !aloft[b.i] || value < 0.5 - TOGETHER) continue;
      f.dev.append(f.time - f.dt, { check: 'walk pair in the air together (cycle apart)', value, limit: 0.5 - TOGETHER, where: `${name(a)} with ${name(b)}` });
    }
    const left = legs.filter((leg) => aloft[leg.i] && !was[leg.i]);
    for (const a of left) for (const b of left) {
      if (b.i <= a.i || this.together(a, b)) continue;
      const apart = this.footfalls[a.i] - this.footfalls[b.i], value = Math.abs(apart - Math.round(apart));
      f.dev.append(f.time - f.dt, { check: 'gait lift-off together (cycle apart)', value, limit: TOGETHER, where: `${name(a)} with ${name(b)}` });
    }
  }

  /** whether the feet keep a gait's clock (a four-legged one's) */
  private get clocked() { return !!this.st.gait; }
  /** the most the pelvis turns from a planted foot (rad) */
  private get pelvisTurn() { return this.st.twist ?? PELVIS_TURN; }

  /** The root read for this sub-step: the crouch eased in, the leap moved on, the root's speed, acceleration and turn. */
  private read(f: Frame, r: RootGoal): Root {
    const { st, jumping: jump, yaws, heights, velocity } = this, s = st.scale, dt = f.dt;
    // (first moved: standing where it is, moving as the root already does — a body spawned on the move gets no jolt)
    if (Number.isNaN(this.stand)) { this.stand = heights[0] = heights[1] = f.prev.position(0).y; velocity.copy(r.velocity); }
    const v = Math.hypot(r.velocity.x, r.velocity.z);
    // (crouched: lower, the feet wider and a little ahead of the hips — the hips sit back — shorter, lower steps)
    const k = clamp(follow(this.crouches[0], this.crouches[1], minimumJerk(clamp(r.crouch ?? 0, 0, 1)), CROUCHING, dt), 0, 1);
    [this.crouches[0], this.crouches[1], this.crouch] = [this.crouches[1], k, k];
    const sitting = r.com ? 0 : st.crouch.ahead * s * k, tiptoe = Math.max(0, r.tiptoe ?? 0);
    const hips = this.hips.copy(r.hips ?? ZERO).setY(0);
    this.pelvis.copy(r.position).add(hips);
    // (the pelvis' own rise and fall: a leap's dip, flight and landing)
    leap(jump, this.asked, smoothstep(st.run[0], st.run[1], v), s, dt);
    this.asked = undefined;
    const air = jump.phase === 'air' ? Math.max(0, jump.land - jump.since) : jump.phase === 'landed' ? 0 : undefined;
    this.airborne = air !== undefined;
    // (how its speed changes: how far a hard stop or turn leaves a landing)
    const accel = _accel.subVectors(r.velocity, velocity).divideScalar(dt);
    velocity.copy(r.velocity);
    const run = smoothstep(st.run[0], st.run[1], v);
    const wanted = yaws[1] + wrapAngle(r.yaw - yaws[1]);
    // (the root's turn rate, to foresee its facing as a foot lands)
    const spin = clamp(wrapAngle(r.yaw - this.rootYaw) / dt, -SPIN, SPIN);
    // (a gait's feet step for the turn the body would make, held back by them: else it waits on feet that wait on it)
    const pressed = this.clocked && r.turning !== undefined ? clamp(r.turning, -SPIN, SPIN) : spin;
    this.rootYaw = r.yaw;
    return {
      f, r, dt, v, run, accel, crouch: k, sitting, tiptoe, rise: jump.rise, vy: jump.vy,
      airborne: air !== undefined, air: air ?? 0, wanted, spin, pressed, held: pressed !== spin,
    };
  }

  /** The stance's duration (quicker turning), its travel kept within reach in the direction of travel. */
  private timing(root: Root): Timing {
    const { st, yaws } = this, s = st.scale, { r, v, run, crouch: k, pressed, wanted } = root;
    const forward = forwardOf(yaws[1]), left = leftOf(yaws[1]);
    // (a gait's cadence as fast as it will be going by mid-stance: setting off, it steps as quickly as it is about to go, not as it stood)
    const coming = this.clocked && r.forecast ? Math.max(v, this.pace(root, PACING, _x).length()) : v;
    const pacing = Math.max(coming, TURNING * s * (Math.abs(pressed) + Math.abs(wanted - yaws[1]))), stride = st.gait && strideAt(st.gait, pacing, 0);
    const along = v > 1e-6 ? r.velocity.dot(forward) / v : 1, across = v > 1e-6 ? r.velocity.dot(left) / v : 0;
    // (side-stepping, quicker: short open-and-close steps rather than long straddles)
    const { base, perSpeed } = st.cadence, sideways = Math.abs(across) * smoothstep(0, SIDE_SPEED * s, v);
    let C = stride ? 1 / stride.frequency : 2 / (lerp(base, st.cadence.side ?? base, sideways) + perSpeed * pacing);
    const duty = stride ? stride.duty : lerp(lerp(st.duty.walk, st.duty.side, Math.abs(across)), st.duty.run, run);
    const travel = along > 0 ? lerp(st.travel.forward, st.travel.run, run) : st.travel.back;
    const most = (1 - st.crouch.travel * k) * s / Math.hypot(along / travel, across / st.travel.side);
    // (a stance travelling further than it may is cut short: a gait's swing keeps its time, a person's whole stride quickens)
    const swingTime = (1 - duty) * C;
    if (v * duty * C > most) C = stride ? most / v + swingTime : most / (v * duty);
    // (a gait's stance turning cut short too as its hips sweep across their feet: each foot from as far one way as it strays to as far
    // the other, the hips swinging round at the turn's rate about the root — a run's swing keeping its time; a walk's whole stride
    // quickening, quicker smaller steps, its swing no more than `PAIRED` of its stance: its feet half a cycle apart never in the air together)
    let swing = swingTime;
    const walking = this.walking(), turn = this.sweeping = walking ? Math.max(Math.abs(pressed), this.sweeping - SWEEPING * root.dt) : Math.abs(pressed);
    if (stride && this.sweep < Infinity && turn * this.sweep * (C - swing) > 1) {
      const cut = 1 / (turn * this.sweep);
      swing = walking && duty >= 0.5 ? Math.min(swing, cut * PAIRED) : swing;
      C = cut + swing;
    }
    const Ts = stride ? C - swing : duty * C, Tsw = C - Ts;
    const lead = Math.min(lerp(st.lead.share, st.lead.side, Math.abs(across)) * Ts, (lerp(st.lead.most, st.lead.run, run) * s) / Math.max(v, 1e-6));
    return { pacing, across, C, duty, Ts, Tsw, most, lead };
  }

  /** The pelvis' facing: the root's, within reach of the feet's (as they stand or will land). */
  private face({ f, r, dt, wanted }: Root): number {
    const { st, feet, legs, yaws, pair } = this, s = st.scale, toeOut = st.toeOut;
    let low = -Infinity, high = Infinity;
    for (const leg of legs) {
      // (with a foreseen root, a swinging foot as it is turned now: its landing foresees the whole turn, the hips do not yet)
      const turned = leg.swing && r.forecast ? leg.swing.turn.x : leg.yaw;
      const body = yaws[1] + wrapAngle(turned - leg.sign * toeOut - yaws[1]);
      [low, high] = [Math.max(low, body - this.pelvisTurn), Math.min(high, body + this.pelvisTurn)];
    }
    // A biped cannot turn its pelvis through the line between its feet while the trailing foot is still leaving the floor.
    if (!this.clocked) for (const leg of legs) {
      const other = legs[pair[leg.i]];
      if (leg.sign < 0 || other.sign > 0) continue;
      const span = new Vector3().subVectors(f.prev.position(feet.legs[leg.i].foot), f.prev.position(feet.legs[other.i].foot)).setY(0);
      const length = span.length();
      if (length < 1e-9) continue;
      const facing = yaws[1] + wrapAngle(Math.atan2(-span.z, span.x) - yaws[1]);
      const room = Math.acos(Math.min(1, PASSING * st.width.narrowest * s / length));
      low = Math.max(low, Math.min(yaws[1], facing - room));
      high = Math.min(high, Math.max(yaws[1], facing + room));
    }
    const goal = low <= high ? clamp(wanted, low, high) : (low + high) / 2;
    const rate = Math.abs(goal - this.last) / dt < 2 * TURN.speed ? (goal - this.last) / dt : 0;
    this.last = goal;
    // (a gait's body faces as its root does: its planner turns it no faster than its feet keep up)
    if (!this.clocked) this.turning.velocity = rate;
    let yaw = this.clocked ? wanted : follow(yaws[0], yaws[1], goal, this.turning, dt);
    yaw = this.foresee(r, dt, yaw, goal, low, high);
    [yaws[0], yaws[1]] = [yaws[1], yaw];
    return yaw;
  }

  /**
   * The pelvis facing `yaw`, toward `goal`, as a walker's — a foreseen root's — turns it: never past the feet's reach of it (`low` …
   * `high`), braking into the limit; past it in the way the root turns, or turned up to `PAUSE` s ago, never turning back: it waits for it.
   */
  private foresee(r: RootGoal, dt: number, yaw: number, goal: number, low: number, high: number): number {
    const { yaws } = this;
    if (!r.forecast || this.clocked) return yaw;
    if (low <= high) yaw = clamp(yaw, low, high);
    const turning = Math.sign(wrapAngle(r.forecast(SENSING).yaw - r.yaw));
    [this.sense, this.paused] = turning !== 0 ? [turning, 0] : [this.sense, this.paused + dt];
    if (this.paused < PAUSE && (yaw - yaws[1]) * this.sense < 0 && (yaws[1] - goal) * this.sense > 0) return yaws[1];
    return yaw;
  }

  /** The furthest from under its hip a foot lands (m): the height a landing must hold the hip at, and how far out it may land so, as
   * the legs stand before they move this sub-step. */
  private landingReach(body: Body): { holding: number; reaches: number[] } {
    const { st, feet, legs } = this, s = st.scale, { r, standing, moving } = body;
    // A planned root can slow for a landing at its contact height; an externally driven one may need extra drop.
    const holding = r.forecast
      ? standing - (dropOf(st, body) + st.bob) * s * moving
      : Math.max(this.nominal(body) - LANDING.drop * s, standing - (LOWEST - LANDING.drop / 2) * s);
    const reaches = legs.map((leg) => {
      const up = feet.legs[leg.i].up ?? 0;
      return Math.max(LANDING.least * s, Math.sqrt(Math.max(0, (st.reach * this.lengthOf(leg)) ** 2 - (holding + up - feet.ankleHeight) ** 2)));
    });
    return { holding, reaches };
  }

  /** The feet carried on: the swings on their way, the planted feet standing (a gait's that pivots turning in place). */
  private carry(now: Now) {
    const { st, feet, legs } = this, { dt, yaw } = now;
    for (const leg of legs) {
      leg.landed = false;
      if (leg.swing) this.swingOn(now, leg, leg.swing);
      else {
        leg.planted += dt;
        // (a gait's planted foot that pivots turns in place about its contact as the body turns over it, heading the body's way)
        if (this.clocked && feet.turnAbout) {
          const to = yaw + leg.sign * st.toeOut;
          feet.turnAbout(leg.i, leg.anchor, leg.yaw, to, leg.pitch);
          leg.yaw = to;
        }
      }
      leg.lifted += dt;
    }
  }

  /** A swing moved on a sub-step: re-aimed while it may be, landed once through. */
  private swingOn(now: Now, leg: Leg, w: Swing) {
    const { st, feet, legs } = this, s = st.scale, { r, dt, airborne, air, Tsw } = now;
    // (its pace kept to the gait's as the speed changes: quicker at once, slower gradually; in the air, landing as the body does)
    if (airborne) [w.rest, w.T] = [air + dt, (air + dt) / (1 - w.u)];
    else w.T = Math.min(Tsw, w.T + PACE * dt);
    w.rest = (1 - w.u) * w.T;
    w.u = Math.min(1, w.u + dt / w.T);
    w.age += dt;
    // (a walker's — a foreseen root's — landing moves no more once `AIMED` of the swing is gone: moved late, it reads as a stumble;
    // before, one that would leave the extrapolated centre of mass past the feet catches it instead)
    const settling = r.forecast ? AIMED : SETTLE, capture = st.capture;
    if (!w.capture && !airborne && capture !== undefined && w.u < settling) {
      const support = hullOf(legs.flatMap((other) => other === leg || !other.swing ? feet.print(other.i, other.anchor, other.yaw) : []));
      w.capture = outside(support, this.xcom(now, remaining(w), _c)) > capture * s;
    }
    // (re-aimed through the first half of the swing in time, frozen after: but for a hard stop, pulling it back into reach till late; a catch
    // as long as it may still move)
    const aiming = w.age < remaining(w);
    if (airborne || (w.u < settling && (aiming || w.capture))) [leg.anchor, leg.yaw] = this.landing(now, leg, remaining(w));
    if (w.u < settling && !airborne) this.settle(now, leg, w, aiming);
    if (w.u >= 1 - 1e-9) [leg.swing, leg.planted, leg.landed, leg.strike, leg.leapt] = [null, 0, true, w.strike, !!w.rel];
  }

  /** What prompts a foot to step this sub-step: a fall to catch, how far it is turned off the facing. */
  private cue(now: Now): Cues {
    const { st } = this, { r, v, spin, Tsw, yaw } = now;
    const catcher = this.catcher(now);
    // (still and no longer turned, the feet square up closer to the facing)
    const turning = lerp(STEP.squared, STEP.turn, smoothstep(0, 0.3, v + Math.abs(spin)));
    const turn = st.twist === undefined ? turning : Math.min(turning, st.twist / 2);
    // (a walker's foot turned toward the facing foreseen a swing on is where the body is turning, not off it: stepping it again would
    // leave the one turned behind waiting: that one steps first)
    const turningTo = r.forecast && !this.clocked ? r.forecast(Tsw).yaw : yaw;
    return { catcher, turn, turningTo };
  }

  /**
   * Balance first: the extrapolated centre of mass — the stance's middle carried on at its speed for √(l/g), Hof — past the feet standing
   * and landing by `capture`, the foot furthest from it steps at once, to under it. Of the feet that may, the one that catches it without
   * crossing the other, else the one furthest from it; only one the others can stand for through its swing: a leading foot stepped on
   * again, the trailing one would be left a stance's most travel behind its hip.
   */
  private catcher(now: Now): Leg | undefined {
    const { st, feet, legs } = this, s = st.scale, { r, airborne, v, Tsw, most, dt } = now;
    const centre = r.xcom ? _centre.copy(r.xcom).setY(0) : this.xcom(now, 0, _centre), capture = st.capture;
    if (airborne || capture === undefined) return undefined;
    const falling = outside(hullOf(legs.flatMap((leg) => feet.print(leg.i, leg.anchor, leg.yaw))), centre) > capture * s;
    if (!falling) return undefined;
    const crossing = (leg: Leg) => Number(this.landing(now, leg, Tsw - dt)[2] > BLOCKED * s);
    const covered = (leg: Leg) => legs.every((other) => other === leg || other.swing || this.aheadOf(now, other) + v * Tsw <= most);
    const further = (a: Leg, b: Leg) => b.anchor.distanceToSquared(centre) - a.anchor.distanceToSquared(centre);
    return legs.filter((leg) => !leg.swing && covered(leg)).sort((a, b) => crossing(a) - crossing(b) || further(a, b))[0];
  }

  /**
   * A gait's clock kept: its footfalls shifting toward the gait's at the pace it keeps — a walk's, a trot's, a gallop's — no faster than
   * `SHIFT` of a cycle a cycle; each foot lifting its own stance after it lands (a leg whose gait has it stand shorter lifts sooner — a
   * horse's hinds at a walk); the clock running while the feet step or would: walking, turning, squaring up.
   */
  private keepTime(now: Now, cues: Cues) {
    const gait = this.st.gait;
    if (!gait) return;
    const { legs } = this, { pacing, dt, C, duty, Ts, Tsw, lead, moving, pressed } = now;
    this.footfalls = legs.map((leg) => {
      const at = this.footfalls[leg.i], to = offsetAt(gait, pacing, leg.i), off = to - at - Math.round(to - at);
      return mod(at + clamp(off, -SHIFT * dt / C, SHIFT * dt / C));
    });
    this.lifts = legs.map((leg) => this.footfalls[leg.i] + (strideAt(gait, pacing, leg.i).duty - duty) * Ts / (duty * C));
    // (how many of the other feet the gait has down as each lifts: each in the air for its swing's share after its own turn comes round)
    const down = (leg: Leg) => legs.filter((other) => other !== leg && mod(this.lifts[leg.i] - this.lifts[other.i]) >= Tsw / C - 1e-9);
    this.scheduled = legs.map((leg) => down(leg).length);
    // (setting off from standing, the gait's cycle starts with the foot furthest behind where it would land: it steps first; a root its
    // legs hold back is setting off too — its feet step in their turn to make way for it, else it waits on feet that wait on it)
    const underway = moving > 0 || pressed !== 0 || now.r.turning !== undefined;
    if (underway && !this.going && legs.every((leg) => !leg.swing)) [this.clock, this.since] = [this.lifts[this.furthest(now, lead)[0].i], 0];
    this.going = underway || legs.some((leg) => leg.swing);
    if (!underway && !legs.some((leg) => leg.swing || this.wants(now, cues, leg))) return;
    // (a foot whose turn passes while it is held down still owes its step: it takes it as soon as it may, not a cycle on)
    const was = legs.map((leg) => this.inTurn(leg));
    this.clock = (this.clock + dt / C) % 1;
    this.since += dt / C;
    for (const leg of legs) {
      const passed = was[leg.i] && mod(this.clock - this.lifts[leg.i]) >= SLOT;
      if (!leg.swing && passed && this.stood(now, leg) && moving > 0) this.owed[leg.i] = true;
    }
  }

  /** whether a foot's turn in a gait has come round since it set off, within `SLOT` of a cycle */
  private inTurn(leg: Leg): boolean {
    const into = mod(this.clock - this.lifts[leg.i]);
    return into < SLOT && into <= this.since + 1e-9;
  }

  /** The feet that are due lifted, the furthest from home first. */
  private liftFeet(now: Now, cues: Cues) {
    for (const leg of this.furthest(now, now.lead)) {
      const other = this.legs[this.pair[leg.i]];
      if (this.ready(now, cues, leg, other)) this.lift(now, leg, leg === cues.catcher);
    }
  }

  /** whether `leg` lifts now, `other` the leg across from it */
  private ready(now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
    const { legs } = this, { r, dt, airborne, C, Ts } = now;
    const urgent = this.urgent(now, cues, leg, other);
    if (airborne && !urgent) return false;
    // (a gait's body never leaves fewer than `STANDING` feet on the floor — nor than its gait has down as this one lifts: a trot quicker
    // than half its cycle in stance has a moment in the air — one out of reach waits, the others land first)
    // (one of a pair lifting in this sub-step still counts as down: the pair leaves the floor together)
    const down = legs.filter((o) => o !== leg && (!o.swing || (o.swing.age <= dt && this.together(leg, o)))).length;
    if (this.clocked && !airborne && down < Math.min(STANDING, this.scheduled[leg.i])) return false;
    // (nor, walking, while one its gait never has in the air with it is — their turns a swing or more apart — out of reach or not: it waits
    // for it to land, as the planner foresees)
    if (this.clocked && !airborne && this.walking() && legs.some((o) => o.swing && this.exclusive(leg, o, now))) return false;
    // (nor lifts a foot it has only just put down: a step lands and bears weight before the next)
    if (this.clocked && !leg.swing && leg.planted < SETTLING * C) return false;
    // With a planned root, touchdown bears weight before another swing; the planner can hold the root back.
    if (leg.swing || (!airborne && r.forecast && leg.landed)) return false;
    // (nor just after one its gait sets apart from it, out of reach or not: the feet leave the floor one by one, `TOGETHER` apart)
    if (this.clocked && !airborne && legs.some((o) => o !== leg && o.lifted < TOGETHER * C && !this.together(leg, o))) return false;
    if (urgent) return true;
    if (leg.landed || !this.wants(now, cues, leg)) return false;
    // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
    const otherLands = other.swing ? remaining(other.swing) : -other.planted;
    const alternates = this.clocked || otherLands + Ts - C * this.apart[leg.i] <= 1e-9;
    return alternates && !this.yields(now, cues, leg, other);
  }

  /** whether a foot steps at once, the other in the air or not: about to be out of reach, under the body, catching a fall */
  private urgent(now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
    const { st, feet } = this, s = st.scale, { r, airborne, air, vy, yaw, most } = now;
    // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
    if (airborne) return !leg.swing && air > 0;
    if (this.reach(now, leg) < this.nominal(now) + Math.max(0, vy) * RISING - STEP.short * s) return true;
    if (leg.landed || (other.swing && r.forecast && !this.clocked)) return false;
    if (leg === cues.catcher) return true;
    return strayed(st, feet, leg, _v.subVectors(this.hip(now, leg), leg.anchor).dot(leftOf(yaw)) * leg.sign) || this.aheadOf(now, leg) > most;
  }

  /** whether a foot that would step lets `other`, standing, step first: the two ways of stepping part here */
  private yields(now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
    if (other.swing) return false;
    return now.r.forecast ? this.walkerYields(now, cues, leg, other) : this.followerYields(now, leg, other);
  }

  /**
   * A walker's foot — a foreseen root's — lets the other step first: side-stepping, the foot on the side it goes opens, the other closing
   * after it (first it does not step away from its way); slow, the foot that stepped last lets the other turn first if it is turned off
   * (the feet alternate, turning on the spot); one that will be nearer its home than the other a swing on (a gait's feet keep its order
   * instead). One that would have to cross the other closes beside it instead: left waiting, it would trail out of reach.
   */
  private walkerYields(now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
    const { v, across } = now;
    if (v > 0 && across * leg.sign < -SIDE && leg.lifted <= other.lifted) return true;
    if (v < SHUFFLING && leg.lifted < other.lifted && !other.landed && this.turnedOff(now, cues, other)) return true;
    return !this.clocked && this.behind(now, other, leg) && !this.turnedOff(now, cues, leg);
  }

  /** A followed foot — an unforeseen root's — lets the other step first if it would have to cross it, or will be nearer its home than the
   * other a swing on (a gait's feet keep its order: none waits on the one across its girdle). */
  private followerYields(now: Now, leg: Leg, other: Leg): boolean {
    if (this.clocked) return false;
    return this.landing(now, leg, now.Tsw - now.dt)[2] > BLOCKED * this.st.scale || this.behind(now, other, leg);
  }

  /** whether `other` will be further from its home than `leg` a swing on, by more than a step */
  private behind(now: Now, other: Leg, leg: Leg): boolean {
    const then = now.lead + now.Tsw;
    return this.off(now, other, then) > this.off(now, leg, then) + STEP.distance * this.st.scale;
  }

  /** A foot lifted: its swing set off from where it is, moving as it does, toward its landing. */
  private lift(now: Now, leg: Leg, capture: boolean) {
    const { st, feet } = this, s = st.scale, { f, dt, airborne, air, Tsw, run, crouch: k } = now;
    const { foot: bone, toes: toesBone } = feet.legs[leg.i];
    const x = f.prev.position(bone).clone(), velocity = x.clone().sub(f.prev2.position(bone)).divideScalar(dt);
    const toes = toesBone === undefined ? new Quaternion() : f.prev.local(toesBone).clone();
    const T = airborne ? air + dt : Tsw;
    this.owed[leg.i] = false;
    const turn = { x: leg.yaw, v: wrapAngle(yawOf(f.prev.rotation(bone)) - yawOf(f.prev2.rotation(bone))) / dt, a: 0 };
    const lift = (airborne ? st.lift.jump : lerp(st.lift.walk, st.lift.run, run) * (1 - st.crouch.lift * k)) * s;
    leg.swing = {
      capture, u: dt / T, age: dt, rest: T, T, x, v: velocity, a: new Vector3(), turn,
      fromPitch: leg.pitch, toes, strike: 0, lift, run, rel: null,
    };
    [leg.anchor, leg.yaw] = this.landing(now, leg, T - dt);
    this.settle(now, leg, leg.swing);
    this.phase = 2 * Math.PI * st.offsets[leg.i];
    leg.lifted = 0;
  }

  /**
   * whether a foot wants to step: off its home, turned off it, or overdue (still, only to even out a stance staggered fore and aft: a
   * squat needs them side by side); a gait's only in its turn, having stood a while, out of turn only fallen `BEHIND` of a stance's travel
   * further behind than its stance takes it from where it lands
   */
  private wants(now: Now, cues: Cues, leg: Leg): boolean {
    const s = this.st.scale, { r, v, spin, held, lead, most, Ts, crouch: k } = now;
    if (r.still && !this.staggered(now, leg)) return false;
    if (this.clocked && !this.stood(now, leg)) return false;
    const off = this.off(now, leg, lead);
    if (this.clocked) {
      const far = off > (v > 0 || spin !== 0 ? STEP.distance : STEP.still) * s;
      return (this.due(now, leg) && (held || far || this.turnedOff(now, cues, leg))) || off > (1 + BEHIND) * most;
    }
    const far = off > (v > 0 || spin !== 0 || k > 0 ? STEP.distance : STEP.still) * s;
    return (far && this.due(now, leg)) || off > Math.max(STEP.distance * s, DUE * v * Ts) || this.turnedOff(now, cues, leg);
  }

  /**
   * whether a foot is due: moving, its share of a cycle after the leg before it lifted (the steps stay even); standing, after a moment; a
   * gait's by its clock, walking or turning: within `SLOT` of a cycle after its offset comes round
   */
  private due(now: Now, leg: Leg): boolean {
    const { C, Ts, moving } = now;
    if (this.clocked) return this.inTurn(leg) || this.owed[leg.i] || (leg.planted >= C * DUE && this.since >= DUE);
    if (moving > 0) return this.legs[this.before[leg.i]].lifted >= C * this.gap[leg.i] || leg.planted >= Ts * DUE;
    return leg.planted >= STEP.square;
  }

  /** whether a gait's feet each leave the floor in a turn of their own (a walk's), none with another (a trot's diagonals) */
  private walking(): boolean {
    return this.legs.every((a) => this.legs.every((b) => a === b || !this.together(a, b)));
  }

  /** whether a gait never has two feet in the air together: their turns a swing or more apart either way round */
  private exclusive(a: Leg, b: Leg, now: Timing): boolean {
    const d = mod(this.lifts[a.i] - this.lifts[b.i]);
    return Math.min(d, 1 - d) >= now.Tsw / now.C - 1e-9;
  }

  /** whether a gait has two feet leave the floor together: their footfalls within `TOGETHER` of a cycle */
  private together(a: Leg, b: Leg): boolean {
    const apart = this.footfalls[a.i] - this.footfalls[b.i];
    return Math.abs(apart - Math.round(apart)) < TOGETHER;
  }

  /** whether a foot has stood `SLOT` of a cycle, or half the gait's stance if that is shorter (a gallop's) */
  private stood(now: Now, leg: Leg): boolean {
    return leg.planted >= Math.min(SLOT, now.duty / 2) * now.C;
  }

  /** whether a foot stands staggered fore and aft of the one across from it */
  private staggered(now: Now, leg: Leg): boolean {
    const other = this.legs[this.pair[leg.i]];
    return Math.abs(_b.subVectors(other.anchor, leg.anchor).dot(forwardOf(now.yaw, _f))) > STAGGERED * this.st.scale;
  }

  /** whether a foot is turned off the facing, and off where the body turns to */
  private turnedOff(now: Now, cues: Cues, leg: Leg): boolean {
    const off = (facing: number) => Math.abs(wrapAngle(leg.yaw - facing - leg.sign * this.st.toeOut)) > cues.turn;
    return off(now.yaw) && off(cues.turningTo);
  }

  /** the legs, the foot furthest from its home `ahead` s on first */
  private furthest(now: Now, ahead: number): Leg[] {
    return [...this.legs].sort((a, b) => this.off(now, b, ahead) - this.off(now, a, ahead));
  }

  /** how far a foot is from its home `ahead` s on (m) */
  private off(now: Now, leg: Leg, ahead: number): number {
    return this.home(now, leg, ahead, _v).sub(leg.anchor).setY(0).length();
  }

  /** a foot's home `ahead` s on: under its hip as the root goes, the stance's width out */
  private home(now: Now, leg: Leg, ahead: number, out: Vector3): Vector3 {
    const { r, yaw, width, sitting } = now;
    const root = r.forecast ? out.copy(r.forecast(ahead).position) : out.copy(r.position).addScaledVector(r.velocity, ahead);
    return root.addScaledVector(leftOf(yaw), leg.sign * width).addScaledVector(forwardOf(yaw), sitting + this.homeOf(leg)).setY(this.feet.ankleHeight);
  }

  /** A landing kept within reach of the hip as it will be (a hard stop pulls it in), heel first only ahead of it. */
  private settle(now: Now, leg: Leg, w: Swing, aiming = true) {
    const { st, feet } = this, s = st.scale, { r, yaw, spin, run, holding, reaches } = now, build = feet.legs[leg.i];
    const rest = remaining(w), through = this.travel(now, rest, _v).add(this.hips);
    const hipAt = (facing: number, root: Vector3, out: Vector3) =>
      out.copy(root).addScaledVector(leftOf(facing, _l), leg.sign * (build.hip ?? feet.hip)).addScaledVector(forwardOf(facing, _o), build.ahead ?? 0);
    const at = hipAt(yaw, through, _hipThen), out = _b.subVectors(leg.anchor, at).setY(0);
    const depth = build.depth;
    if (depth) {
      // (a leg whose joints reach less than a sphere's: its landing pulled in as far as they hold the hip at its height — a gait's hip
      // anywhere between where the body is and faces now and where it is foreseen to as the foot lands: a long body's hips swing
      // round off its turning centre, and its root, all but standing, goes on only as far as its legs keep up)
      const need = holding + (build.up ?? 0) - feet.ankleHeight;
      const then = r.forecast ? r.forecast(rest).yaw : yaw + spin * rest;
      const here = _w.copy(r.position).add(this.hips);
      const from = (facing: number, root: Vector3, k: number) => {
        const d = _x.copy(at).addScaledVector(out, k).sub(hipAt(facing, root, _c));
        return depth(d.dot(leftOf(facing, _l)) * leg.sign, d.dot(forwardOf(facing, _f))) >= need;
      };
      // (where the root is now only for a body all but standing: one on its way is where it goes)
      const still = here.distanceTo(through) < SETTLED_ROOT * s;
      const turning = (k: number) => from(then, through, k) && (!still || (from(yaw, here, k) && from(then, here, k)));
      const holds = (k: number) => from(yaw, through, k) && (!this.clocked || turning(k));
      if (!holds(1)) {
        let [lo, hi] = [0, 1];
        for (let n = 0; n < 12; n++) [lo, hi] = holds((lo + hi) / 2) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
        // (its landing within reach before it is clear of the other foot: a gait's feet may pass close, not out of reach)
        leg.anchor.copy(at).addScaledVector(out, lo).setY(feet.ankleHeight);
      }
    } else if (out.length() > reaches[leg.i]) {
      const within = leg.anchor.copy(at).add(out.setLength(reaches[leg.i])).setY(feet.ankleHeight);
      this.uncross(now, leg, within, leftOf(leg.yaw - leg.sign * st.toeOut, _l));
    }
    // (a walker's — a foreseen root's — foot landing just behind its hip, squaring up, lands flat: toes first only stepping back)
    const ahead = out.dot(forwardOf(leg.yaw)), aim = r.forecast && ahead < 0 ? Math.min(0, ahead + BACKSTEP * s) : ahead;
    if (!aiming) return;
    w.strike = lerp(st.strike.walk, st.strike.run, run) * clamp(aim / (st.strike.ahead * s), -1, 1);
    // (re-aimed to the gait as it goes now — a run eased to a walk — it swings as that gait's: no higher, its arc's peak no later)
    if (w.run > run) [w.lift, w.run] = [w.lift * lerp(st.lift.walk, st.lift.run, run) / lerp(st.lift.walk, st.lift.run, w.run), run];
  }

  /** Where a foot lands `remaining` s on, the way it faces then, and how far across the other foot it would have landed (m). */
  private landing(now: Now, leg: Leg, remaining: number): [Vector3, number, number] {
    const { st, feet, legs, pair, yaws } = this, toeOut = st.toeOut, { r, v, lead, wanted, spin, Ts, sitting } = now;
    // turned toward the root's facing, as far as the other foot lets the pelvis
    const other = legs[pair[leg.i]];
    const body = other.yaw - other.sign * toeOut;
    // (where the root will be and face as it lands, foreseen: as it says, or running on as it turns)
    // (a gait's foot lands as the root goes now, not as its forecast hopes: the legs of a long body hold it back more than a person's)
    const forecast = this.clocked ? undefined : r.forecast, then = forecast?.(remaining + lead);
    const ahead = then ? wanted + wrapAngle(then.yaw - wanted) : wanted + spin * (remaining + lead);
    // (a gait's foot lands under its hip for the body turned as it is turning now, on to the middle of its stance: one ahead of or
    // behind the root swings out with the turn, from one side of where it stands to the other)
    // (the foot itself heading the body's way as it lands: it pivots on the floor as the body comes round over it)
    const reached = body + clamp(wrapAngle(ahead - body), -this.pelvisTurn, this.pelvisTurn);
    const turned = this.clocked ? yaws[1] + spin * (remaining + Ts / 2) : other.swing ? ahead : reached;
    const footing = this.clocked ? yaws[1] + spin * remaining : turned;
    const side = leftOf(turned, new Vector3());
    // (as wide as the speed it will land at: a stopping step lands in the standing stance)
    const landed = this.pace(now, remaining, _w), speed = landed.dot(r.velocity) > 0 ? Math.hypot(landed.x, landed.z) : 0;
    // (along the way it will go, round its curve, but as far as it goes now: a stop is caught by a foot further on — ahead only: one
    // stopping a step aside or back lands where the body stops, beside it)
    const chord = then ? _c.subVectors(then.position, r.position).setY(0) : null, far = Math.max(chord?.length() ?? 0, v * (remaining + lead));
    const on = chord && chord.lengthSq() > 1e-12 ? _n.copy(chord).multiplyScalar(far / chord.length() - 1) : null;
    const forward = forwardOf(turned, _f);
    const to = chord && on
      ? new Vector3().copy(r.position).add(chord).addScaledVector(forward, Math.max(0, on.dot(forward)))
      : new Vector3().copy(r.position).addScaledVector(r.velocity, remaining + lead);
    to.addScaledVector(side, leg.sign * this.widthAt(now, speed)).addScaledVector(forward, sitting + this.homeOf(leg)).setY(feet.ankleHeight);
    if (forecast && then) this.bend(forecast, remaining + lead, then.position, to);
    this.steady(now, leg, remaining, to, turned, side, speed);
    return [to, footing + leg.sign * toeOut, this.uncross(now, leg, to, side)];
  }

  /**
   * A landing `to` foreseen `t` s on at `at` moved out round the bend the body leans into there: the feet land out from its way as far as
   * the extrapolated centre of mass runs out from it — its speed × turn rate (the sideways acceleration) × l/g, halved: Hof's √(l/g) ahead
   * along the tangent, off the arc by its square over twice the radius.
   */
  private bend(forecast: (ahead: number) => { position: Vector3 }, t: number, at: Vector3, to: Vector3) {
    const before = forecast(Math.max(0, t - BEND_SPAN)).position, after = forecast(t + BEND_SPAN).position;
    const turn = wrapAngle(Math.atan2(after.x - at.x, after.z - at.z) - Math.atan2(at.x - before.x, at.z - before.z));
    const speed = after.distanceTo(before) / (2 * BEND_SPAN);
    to.addScaledVector(leftOf(Math.atan2(after.x - before.x, after.z - before.z), _n), -(speed ** 2) * turn / BEND_SPAN * this.feet.length / GRAVITY / 2);
  }

  /**
   * A landing `to` kept in balance: a step whose landing would leave the extrapolated centre of mass as it will be past the feet lands under
   * it instead, just to its side; and no further from it as it is now than the other foot and it hold it: a first step is a short one.
   */
  private steady(now: Now, leg: Leg, remaining: number, to: Vector3, turned: number, side: Vector3, speed: number) {
    const { st, feet, legs, pair } = this, s = st.scale, { r, airborne } = now, capture = st.capture;
    if (capture === undefined || airborne) return;
    const other = legs[pair[leg.i]];
    const yawed = turned + leg.sign * st.toeOut, others = other.swing ? [] : feet.print(other.i, other.anchor, other.yaw);
    const past = (at: Vector3, centre: Vector3) => outside(hullOf([...feet.print(leg.i, at, yawed), ...others]), centre) > capture * s;
    const centre = this.xcom(now, remaining, new Vector3());
    const under = (c: Vector3) => c.clone().addScaledVector(side, leg.sign * st.width.narrowest * s / 2).setY(feet.ankleHeight);
    const present = r.xcom;
    // (a walker's slow step lands no further aside of the other foot than `WIDE.stances`, its extrapolated centre of mass, as it will be
    // and is, kept within `WIDE.within` of the feet: it shuffles rather than straddles)
    const gap = _v.subVectors(to, other.anchor).dot(side) * leg.sign, most = WIDE.stances * 2 * st.width.stand;
    if (r.forecast && !other.swing && speed < SHUFFLING * s && gap > most) {
      const narrower = to.clone().addScaledVector(side, -leg.sign * (gap - most));
      const within = (c: Vector3) => outside(hullOf([...feet.print(leg.i, narrower, yawed), ...others]), c) <= WIDE.within * s;
      if (within(centre) && (!present || within(present))) to.copy(narrower);
    }
    if (past(to, centre)) to.copy(under(centre));
    if (!present || other.swing || !past(to, present)) return;
    const from = to.clone(), toward = under(present);
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 12; k++) [lo, hi] = past(_n.lerpVectors(from, toward, (lo + hi) / 2), present) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    to.lerpVectors(from, toward, hi);
  }

  /** `to` moved onto its own side of the other foot, as the body will face (`side`, its left) and as it faces now; how far it was across (m) */
  private uncross(now: Now, leg: Leg, to: Vector3, side: Vector3): number {
    const { st, legs, pair } = this, s = st.scale, other = legs[pair[leg.i]];
    let across = 0;
    for (const axis of [side, leftOf(now.yaw, _m)]) {
      // (with a foreseen root, a foot landing a foot's length or more ahead of or behind the other need not land a full stance beside it:
      // the shanks pass apart — but never across the line between them: `PASSING` of the stance kept)
      const along = Math.abs(_v.subVectors(to, other.anchor).dot(_n.set(-axis.z, 0, axis.x)));
      const apart = now.r.forecast ? lerp(PASSING, 1, 1 - smoothstep(SPAN * s, 2 * SPAN * s, along)) : 1;
      const gap = _v.dot(axis) * leg.sign, narrowest = st.width.narrowest * s * apart;
      if (gap < narrowest) to.addScaledVector(axis, leg.sign * (narrowest - gap));
      across = Math.max(across, narrowest - gap);
    }
    return across;
  }

  /**
   * The swinging ankles on their paths, the pelvis as high as the feet let it (in the air: where the root has it). In the air the pelvis'
   * own height eases back up to the gait's, the root's rise on it; heights are kept as if standing up: the crouch's own smooth lowering
   * and raising is followed at once.
   */
  private placePelvis(now: Now) {
    const { st, legs, heights } = this, s = st.scale, { f, dt, rise, airborne, standing, crouch: k } = now;
    const crouched = st.crouch.depth * s * k;
    // (followed up toward `to` within `RISE`, braking as it comes: it arrives without a jolt, and a fall is turned back up within it too)
    const lifted = (to: number) => follow(heights[0], heights[1], to + crouched, RISE, dt) - crouched;
    const flying = lifted(this.nominal(now) - rise);
    this.poses = legs.map((leg) => leg.swing ? this.swingPose(now, leg, leg.swing, flying) : null);
    let y = airborne ? flying + rise : this.nominal(now);
    // (a swinging foot holds the pelvis down only late in its swing: before, its leg just swings straighter)
    this.held = y;
    if (!airborne) legs.forEach((leg, i) => {
      const most = this.reach(now, leg, this.poses[i]?.ankle);
      y = softMin(y, most + (leg.swing ? LOWEST * s * (1 - minimumJerk((leg.swing.u - 0.5) / 0.3)) : 0), 0.004 * s);
      if (!leg.swing) this.held = softMin(this.held, most, 0.004 * s);
    });
    // (let down at once as the feet need, up again within `RISE`: a foot let go of does not pop the pelvis up)
    // (the root's own rise and fall are followed at once)
    const fold = this.folded(now);
    const want = Math.max(y - rise, standing - LOWEST * s);
    // (let down no further than the feet need: a quick drop is not carried on past it — the soldier's pelvis sank 3 cm more than its trailing
    // leg asked, a 6 cm bob a stride)
    const base = airborne ? flying : Math.max(Math.min(want, lifted(want)), Math.min(want, heights[1] - crouched), fold - rise);
    [heights[0], heights[1]] = [heights[1], base + crouched];
    f.current.setRoot(_v.copy(this.pelvis).setY(base + rise));
  }

  /**
   * The pelvis' height its legs folded hold it at: crouching too, no lower than a leg folds, as it stood last — its knee bent its most, a
   * planted foot would slide, a swinging one would be held into the floor; deep in a crouch a step lifts the hips as it lifts the foot.
   */
  private folded(now: Now): number {
    const { feet, legs } = this;
    const folded = Math.sqrt(feet.thigh ** 2 + feet.shin ** 2 + 2 * feet.thigh * feet.shin * Math.cos(feet.fold));
    return Math.max(-Infinity, ...legs.map((leg, i) => {
      const ankle = this.poses[i]?.ankle ?? feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), at = this.hip(now, leg);
      return ankle.y + Math.sqrt(Math.max(0, folded ** 2 - (ankle.x - at.x) ** 2 - (ankle.z - at.z) ** 2));
    }));
  }

  /** The pelvis' height: let down walking, bobbing lowest after contact (running: mid-stance), the leap's rise on it. */
  private nominal(body: Body): number {
    const { st, legs } = this, { standing, rise, run, Ts, moving } = body;
    const swinging = 1 - Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0));
    const planted = Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / Ts)) ** 2), 0));
    return standing + rise - (dropOf(st, body) + st.bob * lerp(swinging, planted, run)) * st.scale * moving;
  }

  /** How high a leg's hip reaches its foot (m): planted as rolled as it may be, or with its ankle `given`. */
  private reach(now: Now, leg: Leg, given?: Vector3): number {
    const { st, feet } = this, { yaw } = now, build = feet.legs[leg.i], up = build.up ?? 0;
    const pitch = given ? 0 : this.rolled(now, leg);
    const ankle = given ?? feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
    const at = this.hip(now, leg), horizontal = Math.hypot(ankle.x - at.x, ankle.z - at.z), depth = build.depth;
    // (its joints' own reach where they reach at all; past that, as a sphere of its length: the stray check steps it)
    if (depth) {
      const out = (ankle.x - at.x) * leftOf(yaw, _l).x * leg.sign + (ankle.z - at.z) * leftOf(yaw, _l).z * leg.sign;
      const down = depth(out, _o.subVectors(ankle, at).dot(forwardOf(yaw, _f)), pitch);
      if (down > -Infinity) return ankle.y + down - up;
    }
    return ankle.y + Math.sqrt(Math.max(0, (st.reach * this.lengthOf(leg)) ** 2 - horizontal ** 2)) - up;
  }

  /** a planted foot as far rolled as it may be; with the hip over it, no further than its strike's roll: there it changes ends */
  private rolled(now: Now, leg: Leg): number {
    const s = this.st.scale, limit = this.pivotLimit(now, leg);
    return lerp(rollOf(leg), limit, Math.max(Number(now.tiptoe > 0), smoothstep(PIVOT * s, 2 * PIVOT * s, Math.abs(this.aheadOf(now, leg)))));
  }

  /** the place of a leg's hip, the pelvis turned with the stride */
  private hip(now: Now, leg: Leg): Vector3 {
    const { feet } = this, build = feet.legs[leg.i], facing = now.yaw + this.turn, out = leg.sign * (build.hip ?? feet.hip);
    return this.hipScratch.copy(this.pelvis).addScaledVector(leftOf(facing), out).addScaledVector(forwardOf(facing, _o), build.ahead ?? 0);
  }

  /** the extrapolated centre of mass `ahead` s on: the root carried on, the centre of mass where it is over it — as `r.xcom` is */
  private xcom(now: Body, ahead: number, out: Vector3): Vector3 {
    const at = this.travel(now, ahead, out).add(now.over).addScaledVector(forwardOf(now.yaw, _f), now.sitting);
    return xcomOf(at, this.pace(now, ahead, _x), this.feet.length, out);
  }

  /** where the root will be `ahead` s on, its speed changing as it does now: how far a hard stop or turn leaves a landing */
  private travel({ r, accel }: Root, ahead: number, out: Vector3): Vector3 {
    if (r.forecast) return out.copy(r.forecast(ahead).position);
    return out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(accel, ahead * ahead / 2);
  }

  /** and its velocity then: a walker's as foreseen, braking where it brakes; else run on at its acceleration */
  private pace({ r, accel, dt }: Root, ahead: number, out: Vector3): Vector3 {
    if (r.forecast) return out.subVectors(r.forecast(ahead + dt).position, r.forecast(ahead).position).divideScalar(dt).setY(0);
    return out.copy(r.velocity).addScaledVector(accel, ahead).setY(0);
  }

  /** half the feet's spread at `speed` (m): side-stepping, the feet open wider and close in to the narrowest: their travel never crosses */
  private widthAt({ across, Ts, crouch }: Root & Timing, speed: number): number {
    const { st } = this, s = st.scale, { width } = st;
    const gait = lerp(lerp(width.stand, width.walk * s, smoothstep(0, 1, speed)), width.run * s, smoothstep(st.run[0], st.run[1], speed));
    return Math.max(gait, (width.narrowest * s + Math.abs(across) * speed * Ts) / 2) + st.crouch.wider * s * crouch;
  }

  private lengthOf(leg: Leg): number { return this.feet.legs[leg.i].length ?? this.feet.length; }
  private homeOf(leg: Leg): number { return this.feet.legs[leg.i].home ?? this.feet.legs[leg.i].ahead ?? 0; }

  /** A swinging foot: minimum jerk toward its landing (heel strike), the lift arc over it, clear of the floor. */
  private swingPose(now: Now, leg: Leg, w: Swing, flying: number): FootPose {
    const { st, feet } = this, s = st.scale, pelvis = this.pelvis, { f, r, dt, airborne, air, rise, vy, moving } = now;
    const { top } = feet.legs[leg.i];
    if (airborne && !w.rel) this.relaunch(now, leg, w);
    const u = w.u;
    // (landing as it will stand: heel up already where the shank will lean past the ankle's bend, the hips as low as they are going)
    const topY = f.prev.position(top).y, falling = Math.min(0, topY - f.prev2.position(top).y) / dt;
    const hipLands = _hipAt.copy(this.hip(now, leg)).addScaledVector(r.velocity, w.rest).setY(topY + falling * w.rest);
    const leans = this.shankLean(hipLands, feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _a), leg.yaw);
    const strike = w.strike - beyond(leans + w.strike - st.dorsiflexion) * minimumJerk((u - 0.5) / 0.5);
    const land = feet.ankle(leg.i, leg.anchor, leg.yaw, strike, new Vector3());
    if (airborne) for (const axis of ['x', 'z'] as const) {
      const goal = land[axis] - pelvis[axis] - r.velocity[axis] * air;
      [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], goal, -r.velocity[axis], w.rest, dt);
    }
    else for (const axis of ['x', 'y', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis], 0, w.rest, dt);
    // Retarget the turn with its current velocity and acceleration, just like the ankle's position.
    [w.turn.x, w.turn.v, w.turn.a] = quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, w.rest, dt);
    const yawNow = w.turn.x;
    leg.pitch = w.fromPitch * (1 - minimumJerk(u / 0.45)) + strike * minimumJerk((u - 0.6) / 0.4);
    const lean = feet.lean(leg.i, f.prev, yawNow);
    // (walking, pushed off: the ankle plantarflexed most just after the toes leave the floor, in line again by mid-swing)
    if (st.push && !airborne) {
      const pushed = moving * Math.sin(Math.PI * Math.min(1, u / PUSHED)) ** 2;
      leg.pitch = Math.min(leg.pitch, lerp(leg.pitch, Math.max(st.pitch.ball, -st.push - lean), pushed));
    }
    // (its own shank's lean bends the ankle early in the swing; landing, the strike already stands as it will)
    leg.pitch -= beyond(lean + leg.pitch - st.dorsiflexion) * (1 - minimumJerk((u - 0.6) / 0.4));
    if (st.plantarflexion !== undefined) leg.pitch = Math.max(leg.pitch, -st.plantarflexion - lean);
    const foot = feet.rotation(yawNow, leg.pitch, new Quaternion());
    // (the toes relax off the floor into line, and landing toes first come down flat)
    const toes = foot.clone().multiply(_q.copy(w.toes).slerp(IDENTITY, minimumJerk(u / 0.3)))
      .slerp(feet.rotation(yawNow, Math.max(0, leg.pitch), _toes), minimumJerk((u - 0.6) / 0.4));
    // (the arc peaks mid-swing walking; a runner's heel stays up later, the knee bent late into the swing; a gait's as its `arc` has it)
    const a = st.gait ? st.arc : lerp(3, st.arc, w.run), peak = a / (a + 3);
    const arc = w.lift * (u ** a * (1 - u) ** 3) / (peak ** a * (1 - peak) ** 3);
    const ankle = w.x.clone().setY(w.x.y + arc);
    if (airborne) {
      // (in the air the leg's length is planned, not the foot's height: hanging from the hips, tucked
      // between; landing, the foot comes down with the body, slowed a little by the knees bending)
      const rel = w.rel;
      if (!rel) throw new Error('a swing in the air without its leap');
      const pelvisY = flying + rise, falls = rise + vy * air - GRAVITY * air * air / 2;
      [rel.x, rel.v, rel.a] = quintic(rel.x, rel.v, rel.a, flying + falls - land.y, (1 - TOUCH) * (vy - GRAVITY * air), w.rest, dt);
      ankle.set(pelvis.x + w.x.x, pelvisY - rel.x + arc, pelvis.z + w.x.z);
    }
    const lowest = feet.sole(leg.i, ankle, foot, toes);
    const soft = 0.004 * Math.sin(Math.PI * u) ** 2 + Number.EPSILON;
    ankle.y += softplus(st.clearance * s * Math.sin(Math.PI * u) ** 3 - lowest, soft);
    return { ankle, foot, toes, yaw: yawNow };
  }

  /** A swing taken to the air mid-step: the step starts over as the leap's, from where the foot is, moving as it does. */
  private relaunch({ f, dt }: Now, leg: Leg, w: Swing) {
    const { st } = this, { foot: footBone, toes: toesBone } = this.feet.legs[leg.i];
    const at = f.prev.position(footBone), was = f.prev2.position(footBone), hips = f.prev.position(0), hipsWas = f.prev2.position(0);
    w.rel = { x: hips.y - at.y, v: (hips.y - at.y - hipsWas.y + was.y) / dt, a: 0 };
    w.x.set(at.x - hips.x, at.y, at.z - hips.z);
    w.v.set(at.x - was.x - hips.x + hipsWas.x, at.y - was.y, at.z - was.z - hips.z + hipsWas.z).divideScalar(dt);
    w.a.set(0, 0, 0);
    [w.fromPitch, w.u, w.T, w.age, w.lift, w.run] = [leg.pitch, dt / w.rest, w.rest, dt, st.lift.jump * st.scale, 0];
    if (toesBone !== undefined) w.toes.copy(f.prev.local(toesBone));
  }

  /** A planted foot: rolling flat off its heel strike, onto its heel or ball as far as the hip needs to reach it. */
  private plantedPose(leg: Leg, at: Vector3): FootPose {
    const now = this.now;
    if (!now) throw new Error('pose before move');
    const { st, feet } = this;
    // (from the roll off the heel strike, on toward the pivot that brings the ankle nearer)
    const roll = rollOf(leg);
    const depth = feet.legs[leg.i].depth;
    const far = (pitch: number) => {
      const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
      if (!depth) return ankle.distanceTo(at) > st.reach * this.lengthOf(leg);
      // (a leg whose joints reach less than a sphere's: as far as they hold its top where it is)
      const d = _b.subVectors(ankle, at);
      return depth(d.dot(leftOf(now.yaw, _l)) * leg.sign, d.dot(forwardOf(now.yaw, _f)), pitch) < -d.y;
    };
    leg.free = !far(roll);
    let lo = roll, hi = leg.free ? roll : this.pivotLimit(now, leg);
    for (let k = 0; k < 24 && hi !== roll; k++) { const mid = (lo + hi) / 2; if (far(mid)) lo = mid; else hi = mid; }
    leg.pitch = hi;
    // (the heel lifts once the shank leans further over the foot than the ankle bends: deep in a crouch)
    leg.pitch -= beyond(this.shankLean(at, feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), leg.yaw) + leg.pitch - st.dorsiflexion);
    leg.pitch = this.pointed(now, leg, leg.pitch, at);
    const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, new Vector3());
    const foot = feet.rotation(leg.yaw, leg.pitch, new Quaternion()), toes = feet.rotation(leg.yaw, Math.max(0, leg.pitch), new Quaternion());
    return { ankle, foot, toes, yaw: leg.yaw };
  }

  /** the most a planted foot rolls to help the hip reach it: onto its heel when it is ahead, its ball when behind */
  private pivotLimit(now: Now, leg: Leg): number {
    // (it changes ends only while it needs no roll past its strike's: changed mid-roll, the roll would jump)
    if (leg.free) leg.heel = now.tiptoe === 0 && this.aheadOf(now, leg) < 0;
    // (just landed, it first rolls off its strike: the pivot is given over as the roll ends)
    return this.pointed(now, leg, lerp(rollOf(leg), leg.heel ? this.st.pitch.heel : this.st.pitch.ball, minimumJerk(leg.planted / ROLL)));
  }

  private pointed(now: Now, leg: Leg, pitch: number, at?: Vector3): number {
    const { st, feet } = this;
    if (st.plantarflexion === undefined) return pitch;
    const lean = at ? this.shankLean(at, feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a), leg.yaw) : feet.lean(leg.i, now.f.prev, leg.yaw);
    return Math.max(pitch, -st.plantarflexion - lean);
  }

  private aheadOf(now: Now, leg: Leg): number {
    return _v.subVectors(this.hip(now, leg), leg.anchor).dot(forwardOf(leg.yaw));
  }

  /** how far the shank leans forward over a foot heading `yaw` with the hip at `hip` and the ankle at `ankle`, the knee bent toward the toes (rad) */
  private shankLean(hip: Vector3, ankle: Vector3, yaw: number): number {
    const { feet } = this;
    const along = _b.subVectors(ankle, hip), l = along.length();
    along.divideScalar(l);
    const a = (feet.thigh ** 2 - feet.shin ** 2 + l * l) / (2 * l), rise = Math.sqrt(Math.max(0, feet.thigh ** 2 - a * a));
    const fw = forwardOf(yaw, _f), side = _m.copy(fw).addScaledVector(along, -fw.dot(along)).normalize();
    const shin = _l.copy(hip).addScaledVector(along, a).addScaledVector(side, rise).sub(ankle);
    return Math.atan2(shin.dot(fw), shin.y);
  }

  /**
   * Whether the legs keep up with a root that goes as `forecast` has it (its floor point and facing `ahead` s on), as they now stand: each
   * planted foot within its leg's reach — the pelvis let down all it may, the foot rolled as far as it may — until it may next lift (the
   * other foot down), and turned from it no further than the pelvis turns; each swing past re-aiming lands within reach of its hip.
   * Reads the last `move`; changes nothing.
   */
  reachable(forecast: (ahead: number) => { position: Vector3; yaw: number }): boolean {
    const { st, feet, legs, pair } = this;
    if (Number.isNaN(this.low)) return true;
    const within = (leg: Leg, ahead: number, pitches: readonly number[]) => {
      const at = forecast(ahead), build = feet.legs[leg.i], up = build.up ?? 0;
      const hip = _w.copy(at.position).add(this.hips).addScaledVector(leftOf(at.yaw, _m), leg.sign * (build.hip ?? feet.hip))
        .addScaledVector(forwardOf(at.yaw, _o), build.ahead ?? 0).setY(0);
      // (and turned no further from a planted foot than the pelvis may — a gait's pivots in place on the floor as far as the body turns
      // — the hip not in over it nor a stance's travel past it)
      if (!st.gait && !leg.swing && Math.abs(wrapAngle(at.yaw - leg.yaw + leg.sign * st.toeOut)) > this.pelvisTurn) return false;
      if (!leg.swing) {
        const inward = _b.subVectors(hip, leg.anchor).dot(leftOf(at.yaw, _l)) * leg.sign;
        if (strayed(st, feet, leg, inward) || _b.subVectors(hip, leg.anchor).dot(forwardOf(leg.yaw, _f)) > this.most) return false;
      }
      // (a gait's planted foot that pivots will have turned in place with the body by then)
      const pivot = !leg.swing && st.gait ? feet.turnAbout : undefined;
      const anchor = pivot ? _pivot.copy(leg.anchor) : leg.anchor, yaw = pivot ? at.yaw + leg.sign * st.toeOut : leg.yaw;
      return pitches.some((pitch) => {
        if (pivot) pivot.call(feet, leg.i, anchor.copy(leg.anchor), leg.yaw, yaw, pitch);
        const ankle = feet.ankle(leg.i, anchor, yaw, pitch, _a);
        const most = st.reach * (build.length ?? feet.length), depth = build.depth;
        if (depth) return depth(_n.subVectors(ankle, hip).dot(leftOf(at.yaw, _l)) * leg.sign, _n.dot(forwardOf(at.yaw, _f)), pitch) >= this.low + up - ankle.y;
        return Math.hypot(ankle.x - hip.x, ankle.z - hip.z) ** 2 + Math.max(0, this.low + up - ankle.y) ** 2 <= most * most;
      });
    };
    // (balance first: a walker's extrapolated centre of mass kept within the feet as they stand and land — no further past them than it is;
    // a landing still re-aimed where it lands for this forecast, as `move` would aim it: judged where it was aimed for the last forecast,
    // a forecast would pass one sub-step and fail the next, once the landing is re-aimed for it — the root flipping between turning and
    // not each sub-step, the foot landing where either had it)
    if (st.capture !== undefined && legs.some((leg) => leg.swing)) {
      const landings = this.aim(forecast);
      const support = hullOf(legs.flatMap((leg, k) => feet.print(leg.i, landings[k], leg.yaw)));
      const xcom = (t: number) => {
        const at = forecast(t).position;
        return xcomOf(at, _c.subVectors(forecast(t + SUB_STEP).position, at).divideScalar(SUB_STEP), feet.length, _x);
      };
      const allowed = Math.max(st.capture * st.scale, outside(support, xcom(0)));
      const rest = Math.max(...legs.map((leg) => leg.swing ? remaining(leg.swing) : 0));
      for (let t = rest / 4; t <= rest + 1e-9; t += rest / 4) if (outside(support, xcom(t)) > allowed + 1e-6) return false;
    }
    return legs.every((leg) => {
      const w = leg.swing;
      if (w) {
        // (turned no further from a swinging foot, as it turns on to its landing, than the pelvis may: nor further than it is already)
        const turned = (t: number) => {
          const facing = forecast(t).yaw, foot = quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, remaining(w), t)[0];
          return Math.abs(wrapAngle(facing - foot + leg.sign * st.toeOut));
        };
        const allowed = Math.max(this.pelvisTurn, turned(0)), rest = remaining(w);
        for (let t = rest / 4; t <= rest + 1e-9; t += rest / 4) if (turned(t) > allowed + 1e-6) return false;
        // (a gait's landing, frozen once aimed, is kept within reach from then on: its body's forecast may turn out slower)
        return w.u < (st.gait ? AIMED : SETTLE) || within(leg, rest, [0]);
      }
      // (a gait's foot may next lift once the others in the air have landed, or as its turn comes round if the gait has it leave the floor
      // before they do: it holds till then)
      const other = legs[pair[leg.i]].swing, landed = Math.max(0, ...legs.map((l) => l.swing ? remaining(l.swing) : 0));
      // (and, turning on the spot, till its own turn comes round: before then it stays)
      const own = mod(this.lifts[leg.i] - this.clock) * this.cycle;
      let wait = other ? remaining(other) : 0;
      if (st.gait) wait = Math.max(Math.min(landed, this.scheduled[leg.i] < STANDING ? own : Infinity), this.moving > 0.05 ? 0 : own);
      // (walking, toward its own turn too, `AWAIT` of a cycle at most, and till what it waits for to lift lands)
      const now = this.now;
      if (st.gait && now && this.walking()) {
        if (!this.owed[leg.i]) wait = Math.max(wait, this.inTurn(leg) ? 0 : Math.min(own, AWAIT * this.cycle));
        wait = Math.max(wait, ...legs.map((o) => o.swing && this.exclusive(leg, o, now) ? remaining(o.swing) : 0));
      }
      for (let t = 0; t <= wait + 1e-9; t += Math.max(1 / 60, wait / 6)) if (!within(leg, t, [0, st.pitch.heel, st.pitch.ball])) return false;
      return true;
    });
  }

  /** Where the feet will land for another forecast: those still re-aimed as the last sub-step's would be, for it. */
  private aim(forecast: (ahead: number) => { position: Vector3; yaw: number }): Vector3[] {
    const now = this.now;
    if (!now) return this.legs.map((leg) => leg.anchor);
    const { r } = now, was = r.forecast;
    r.forecast = forecast;
    try {
      return this.legs.map((leg) => {
        const w = leg.swing;
        if (!w || now.airborne || w.u >= AIMED || (w.age >= remaining(w) && !w.capture)) return leg.anchor;
        // (kept within reach of the hip as `settle` keeps it)
        const anchor = leg.anchor, aimed = this.landing(now, leg, remaining(w))[0];
        leg.anchor = aimed;
        this.settle(now, leg, w, false);
        leg.anchor = anchor;
        return aimed;
      });
    } finally { r.forecast = was; }
  }

  /**
   * Leg `i`'s foot posed for this sub-step with its top joint at `top` (as the hips now stand); a swinging leg is never asked past its
   * reach, where the knee's swivel is undefined.
   */
  pose(i: number, top: Vector3): FootPose {
    const leg = this.legs[i], st = this.st, length = this.feet.legs[i].length ?? this.feet.length;
    const pose = this.poses[i] ?? this.plantedPose(leg, top);
    const d = _d.subVectors(pose.ankle, top), l = d.length(), from = st.swingReach * length, span = (st.reach - st.swingReach) * length;
    if (leg.swing && l > from) {
      const eased = (from + span * Math.tanh((l - from) / span)) / l;
      pose.ankle.lerp(_a.copy(top).addScaledVector(d, eased), this.airborne ? 1 : 1 - minimumJerk((leg.swing.u - 0.8) / 0.15));
    }
    return pose;
  }
}

/**
 * A leap asked (`asked`, its take-off speed) moved on `dt`: dipping, then in the air (landing on a sub-step), the knees taking it, rising
 * again (`run`: 0 … 1 running; `s`: the body's scale).
 */
function leap(j: Leap, asked: number | undefined, run: number, s: number, dt: number) {
  if (asked !== undefined && (j.phase === 'ground' || j.phase === 'up')) [j.phase, j.since, j.speed] = ['launch', 0, asked];
  j.since += dt;
  if (j.phase === 'landed') [j.phase, j.since, j.bottom, j.a] = ['down', dt, j.rise + JUMP.depth * (1 - run / 2) * j.vy * JUMP.down, -GRAVITY];
  if (j.phase === 'launch') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, 0, j.speed, JUMP.launch - j.since + dt, dt);
    // (in the air till the sub-step it falls back to the floor's contact depth)
    const flight = (j.speed + Math.sqrt(j.speed ** 2 + 2 * GRAVITY * JUMP.contact * s)) / GRAVITY;
    if (j.since >= JUMP.launch - 1e-9) [j.phase, j.since, j.land] = ['air', 0, Math.ceil(flight / dt - 1e-6) * dt];
  } else if (j.phase === 'air') {
    const t = Math.min(j.since, j.land);
    [j.rise, j.vy] = [j.speed * t - GRAVITY * t * t / 2, j.speed - GRAVITY * t];
    if (j.since >= j.land - 1e-9) j.phase = 'landed';
  } else if (j.phase === 'down') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, j.bottom, 0, JUMP.down - j.since + dt, dt);
    if (j.since >= JUMP.down - 1e-9) [j.phase, j.since] = ['up', 0];
  } else if (j.phase === 'up') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, 0, 0, JUMP.up - j.since + dt, dt);
    if (j.since >= JUMP.up - 1e-9) [j.phase, j.rise, j.vy, j.a] = ['ground', 0, 0, 0];
  }
}

/**
 * whether a planted foot is too far in under the body from its hip (`inward`, m, + toward the body's middle): a person's more than
 * `STEP.medial`; a leg with its own `stray`, that far either way from where it stands under its hip
 */
function strayed(st: Stepping, feet: Feet, leg: Leg, inward: number): boolean {
  const stray = feet.legs[leg.i].stray;
  if (stray === undefined) return inward > STEP.medial * st.scale;
  return Math.abs(inward - ((feet.legs[leg.i].hip ?? feet.hip) - st.width.stand)) > stray;
}

/** how far the pelvis is let down moving (× scale): walking, side-stepping, running */
const dropOf = (st: Stepping, { across, run }: Timing & Root) => lerp(lerp(st.drop.walk, st.drop.side, Math.abs(across)), st.drop.run, run);

/** how long a swing has left (s) */
const remaining = (w: Swing) => (1 - w.u) * w.T;

/** `x` wrapped into a cycle (0 … 1) */
const mod = (x: number) => ((x % 1) + 1) % 1;

/** how far `x` (rad) is past 0, easing in from `BEND`/2 before it (C¹: the heel starts lifting at rest) */
const beyond = (x: number) => x <= -BEND / 2 ? 0 : x < BEND / 2 ? (x + BEND / 2) ** 2 / (2 * BEND) : x;

/** a planted foot's roll off its strike (rad): flat after `ROLL` */
const rollOf = (leg: Leg) => leg.strike * (1 - minimumJerk(leg.planted / ROLL));

const ZERO = new Vector3();
const IDENTITY = new Quaternion(), _q = new Quaternion(), _toes = new Quaternion();
const _centre = new Vector3(), _over = new Vector3();
const [_v, _w, _a, _b, _c, _x, _n, _hipAt, _accel, _l, _f, _m, _d, _o, _hipThen, _pivot] = Array.from({ length: 16 }, () => new Vector3());
