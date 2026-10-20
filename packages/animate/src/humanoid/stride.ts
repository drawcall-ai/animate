import { Quaternion, Vector3 } from 'three';
import type { Behaviour } from '../core/goal';
import { Planner } from '../core/legs/planner';
import { clamp, forwardOf, GRAVITY, lerp, minimumJerk, smoothstep, wrapAngle } from '../core/math';
import { seedOf } from '../core/random';
import { TrackedPoint, TrackedRotation } from '../core/track';
import type { Stance } from '../core/asks';
import { clampRotation } from '../core/limits';
import type { Stepper, Stepping } from '../core/legs/stepper';
import { hullOf, past } from '../core/legs/support';
import { footprint } from './balance/foot';
import { BOW, PELVIS, TURN, followed } from './balance/balance';
import { GOAL_VELOCITY_RATE, JUMP_SPEED, START, STOP, START_GLIDE } from './balance/carriage';
import { checkSupport } from './balance/checks';
import { Life } from './balance/life';
import { LOWER, Posture, SQUAT, entrain, walking, type Trunk, type Upright } from './balance/posture';
import { INDEX } from './bones';
import { drivenBy } from './driven';
import type { Humanoid } from './humanoid';
import { humanGait, humanStepping } from './legs';
import type { Proportions } from './proportions';
import { defaultStance } from './stance';

/**
 * A person standing and walking where asked on the core legs: the root — the body's centre of mass over the floor — goes where the
 * planner takes it toward `asks.go` (facing `asks.face`, or the way it goes) as a player's input would drive it, and the stepper keeps
 * the legs under it (`drivenBy`), catching the extrapolated centre of mass with a step when it leaves the feet. A walk starts once the
 * goal is `START` off (its glide kept to `START_GLIDE` until the first foot lands) and ends once close, slow and the goal still (`STOP`).
 * The hips are carried off the root as `Posture` has them: swaying and turning with the stride, back against a bow or a load in the
 * hands (the centre of mass kept over the root), the thorax counter-rotating, the trunk bowed and twisted as asked; `lower` lets the
 * stepper crouch (below none: up on the toes).
 */
export function stride(h: Humanoid, options: { stance?: Partial<Stance>; seed?: number } = {}): Behaviour {
  const p = h.proportions, s = p.scale, toeOut = defaultStance(p).toeOut, base = { ...defaultStance(p), ...options.stance };
  const stepping = walkerStepping(p), stop = new Vector3(), velocity = new Vector3();
  let planner: Planner | null = null, moving = false, starting = false, seen = false, phase = 0, still: Vector3 | null = null, leaning = false;
  const c: Upright = { p, root: new Vector3(), offset: new Vector3(), yaw: h.yaw, walk: 0, run: 0, moving: false, stance: base, feet: h.feet, pelvis: new Vector3(), pelvisRotation: new Quaternion() };
  const posture = new Posture(), life = new Life(options.seed ?? seedOf(p.height, h.feet[0].position.x, h.feet[0].position.z));
  const trunk: Trunk = { chest: new Quaternion(), thoraxYaw: 0 }, asked = { lower: [0, 0], bow: [0, 0], twist: [0, 0] };
  const hips = new TrackedPoint(), rotation = new TrackedRotation(), back = [new TrackedRotation(), new TrackedRotation()];
  const offsets = [new Vector3(), new Vector3()], tilts = [new Quaternion(), new Quaternion()];
  // (`from` shifted by `lean` as far as the planted feet hold it, `LEAN.inside` within their edge)
  const within = (from: Vector3, lean: Vector3 | null, stepper: Stepper) => {
    if (!lean) return from;
    const hull = hullOf(stepper.legs.filter((leg) => !leg.swing).flatMap((leg) => footprint(p, leg.anchor, leg.yaw)));
    if (hull.length < 3) return from;
    const at = (t: number) => from.clone().addScaledVector(lean, t);
    if (past(hull, at(1)) <= -LEAN.inside * s) return at(1);
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 12; k++) [lo, hi] = past(hull, at((lo + hi) / 2)) <= -LEAN.inside * s ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    return at(lo);
  };
  return drivenBy(h, (f, asks, stepper) => {
    // (a walker's balance is checked, not only noted as a player's is)
    if (f.dev) checkSupport(h, f, f.dev);
    const dt = f.dt, go = asks.go;
    if (!planner) {
      planner = new Planner(f.prev.com(new Vector3()), h.yaw, humanGait(p), p.hipHalfWidth);
      stop.copy(planner.root.position);
      offsets[0].subVectors(f.prev2.position(0), planner.root.position).setY(0);
      offsets[1].subVectors(f.prev.position(0), planner.root.position).setY(0);
    }
    const plan = planner, root = plan.root.position;
    // (the goal's own velocity picked up; one jumping was re-planned, not carried)
    if (go) {
      const travel = go.to.clone().sub(stop).setY(0);
      if (go.velocity) velocity.copy(go.velocity);
      else velocity.lerp(seen && travel.length() <= JUMP_SPEED * dt ? travel.divideScalar(dt) : travel.set(0, 0, 0), 1 - Math.exp(-GOAL_VELOCITY_RATE * dt));
      stop.copy(go.to).setY(0);
    } else velocity.set(0, 0, 0);
    seen = !!go;
    // (where it rests: its weight shifted from there as a reach asks, back there after)
    still = moving ? null : leaning ? still : root.clone();
    if (!moving && ((still ?? root).distanceTo(stop) > START.distance * s || velocity.length() > START.speed)) [moving, starting, still, leaning] = [true, true, null, false];
    if (stepper.legs.some((leg) => leg.landed)) starting = false;
    const heading = Math.atan2(stop.x - root.x, stop.z - root.z);
    const travelYaw = plan.root.velocity.lengthSq() > 1e-8 ? Math.atan2(plan.root.velocity.x, plan.root.velocity.z) : heading;
    const yaw = asks.face?.yaw ?? (moving ? travelYaw : plan.root.yaw);
    const faced = !!asks.face || !moving || Math.abs(wrapAngle(heading - plan.root.yaw)) >= Math.PI / 4;
    const stance = stepper.legs.reduce((sum, leg) => sum + wrapAngle(leg.yaw - leg.sign * toeOut - plan.root.yaw), 0) / stepper.legs.length + plan.root.yaw;
    // (stopped close to a goal still asked, the body edges on onto it, the feet staying put; at rest, its weight goes as a reach shifts it)
    const lean = !moving && !go ? asks.lean : null;
    const leaned = still && (lean || leaning) ? within(still, lean, stepper) : null;
    leaning = !!leaned && (!!lean || root.distanceTo(leaned) > LEAN.back * s);
    const r = plan.step(f, { position: moving || go ? stop : leaned ?? root.clone(), velocity: moving ? velocity : new Vector3(), yaw: faced ? yaw : undefined },
      { accel: go?.accel ?? 1.2 * s, speed: moving ? Math.min(go?.speed ?? 1.3 * s, starting ? START_GLIDE * s : Infinity) : go ? EDGE * s : leaned ? LEAN.speed * s : 0, turnSpeed: asks.face?.rate },
      stance, (forecast) => stepper.reachable(forecast));
    if (root.distanceTo(stop) < STOP.distance * s && r.velocity.length() < STOP.speed && velocity.length() < STOP.goalSpeed) moving = false;

    // the hips carried off the root: swaying and turning with the stride, back from it as far as the body's mass leans ahead of them
    const speed = r.velocity.length();
    c.stance = asks.stance ? { ...base, ...asks.stance } : base;
    [c.walk, c.moving, c.yaw] = [walking(c.walk, speed, dt), moving, stepper.yaw];
    c.root.copy(root);
    c.offset.copy(posture.center(f));
    life.update(dt, life.quiet(asks, h), speed);
    const requested = { lower: followed(asked.lower, asks.lower, LOWER, dt), bow: followed(asked.bow, Math.min(asks.bow, asks.bowLimit), BOW, dt), twist: followed(asked.twist, asks.twist, BOW, dt) };
    const swing = stepper.legs.find((leg) => leg.swing)?.swing;
    // (the stride's phase pulled into step with the feet's, never jumping as a foot lifts)
    phase = entrain(phase, stepper.phase, 2 * Math.PI / stepper.cycle, dt);
    posture.carry(f, c, requested, trunk, { drift: life.drift, breath: life.breath, onto: asks.onto ?? life.onto },
      { phase, bob: swing ? Math.sin(Math.PI * swing.u) : 0, nod: swing ? Math.cos(2 * Math.PI * swing.u) : 1, compression: 0 }, (height) => height);
    const offset = hips.follow(offsets[0], offsets[1], c.pelvis.clone().sub(c.root).setY(0), PELVIS, dt, new Vector3());
    [offsets[0], offsets[1]] = [offsets[1], offset];
    // (the feet stand with their ankles a little behind the centre of mass: a person stands with it over the middle of the feet)
    const behind = forwardOf(stepper.yaw).multiplyScalar(OVER * s), forecast = r.forecast;
    // (balance read off the body as it last stood, as the checks read it)
    const com = f.prev.com(new Vector3()), xcom = com.clone().addScaledVector(com.clone().sub(f.prev2.com(new Vector3())), 1 / (dt * Math.sqrt(GRAVITY / p.legLength))).setY(0);
    // (let down as asked: the stepper crouches, the feet staying put; asked below none, up on the toes)
    return { ...r, xcom, position: r.position.clone().sub(behind), forecast: forecast && ((t) => { const at = forecast(t); return { position: at.position.sub(behind), yaw: at.yaw }; }),
      hips: offset.clone().add(behind), crouch: Math.min(crouchFor(requested.lower / (stepping.crouch.depth * s)), lerp(1, WALKING_CROUCH, smoothstep(0.2, 0.8, speed))), tiptoe: Math.max(0, -requested.lower),
      still: !moving && Math.abs(requested.lower) > LOWERED * s };
  }, (f, _asks, stepper) => {
    // the pelvis turned with the stride over the stepper's facing; the lower back and thorax each take half the turn up to the chest
    const tilt = rotation.follow(tilts[0], tilts[1], new Quaternion().setFromAxisAngle(UP, -stepper.yaw).multiply(c.pelvisRotation), TURN, f.dt, new Quaternion());
    [tilts[0], tilts[1]] = [tilts[1], tilt.clone()];
    f.current.setLocal(0, tilt.premultiply(new Quaternion().setFromAxisAngle(UP, stepper.yaw)));
    const half = f.current.local(0).clone().invert().multiply(trunk.chest).slerp(new Quaternion(), 0.5);
    [INDEX.spine, INDEX.chest].forEach((bone, k) => {
      const local = half.clone(), limit = f.current.skeleton.limits[bone];
      if (limit) clampRotation(local, limit);
      f.current.setLocal(bone, back[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TURN, f.dt, new Quaternion()));
    });
    h.locomotion.quiet.copy(posture.quiet);
    return trunk.thoraxYaw;
  }, stepping);
}

/**
 * A walker's stepping: a player's, but the stance leg near straight at mid-stance (tuned to Perry's ~5–10° of knee flexion; a
 * player's body keeps more bend), a 60% stance (recalled: Perry 1992, stance 60% of the cycle at free speed; the shorter double
 * support keeps the extrapolated centre of mass within the feet), a deeper bob (tuned: its low in the double support, ~4 cm), a squat
 * as deep as `SQUAT` on the feet where they stand, and its balance caught by a step `CAPTURE` past the feet.
 */
const walkerStepping = (p: Proportions): Stepping => {
  const player = humanStepping(p);
  return { ...player, reach: 0.997, duty: { ...player.duty, walk: 0.6 }, bob: 0.042, crouch: { ...player.crouch, depth: SQUAT * p.height / p.scale, wider: 0 }, capture: CAPTURE, push: PUSH };
};

/** the crouch (0 … 1) that lets the pelvis down `share` of the stepper's depth (its `minimumJerk` easing undone) */
function crouchFor(share: number): number {
  if (share <= 0 || share >= 1) return clamp(share, 0, 1);
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 24; k++) [lo, hi] = minimumJerk((lo + hi) / 2) < share ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  return (lo + hi) / 2;
}

/** Tuned: a walker catches its extrapolated centre of mass this far past its feet (m; the checks allow 0.1) */
const CAPTURE = 0.07;
/** Recalled (Perry 1992; Winter 1991): the ankle plantarflexes ~20° just after toe-off, at any walking speed (rad) */
const PUSH = 20 * Math.PI / 180;
/** Tuned: walking, a body lets its pelvis down at most this share of a squat (the old balance's deepest dip walking, reaching low: ~0.26 m); a deeper ask waits for it to slow */
const WALKING_CROUCH = 0.5;
/** Tuned: at rest, the weight shifts toward a reach this fast (m/s), its centre of mass kept this far within the feet's edge (m), and back till this near where it rested (m) */
const LEAN = { speed: 0.15, inside: 0.03, back: 0.001 };
/** Tuned: stopped close to a goal still asked (within `STOP`), the body edges onto it this fast (m/s) */
const EDGE = 0.03;
/** Inherited (the old balance): let down or up this far (m), the feet stay put but to catch a fall */
const LOWERED = 0.02;
/** Tuned: the ankles' middle stands this far behind the centre of mass (m; the old balance stood it `OVER_ANKLES` ahead of them; walking, less leaves the extrapolated centre of mass past the toes as the trailing foot lifts, more lowers the pelvis before contact) */
const OVER = 0.021;
const UP = new Vector3(0, 1, 0);
