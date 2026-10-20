import { Quaternion, Vector3 } from 'three';
import type { Behaviour } from '../core/goal';
import { Planner } from '../core/legs/planner';
import { wrapAngle } from '../core/math';
import { seedOf } from '../core/random';
import { TrackedPoint, TrackedRotation } from '../core/track';
import type { Stance } from '../core/asks';
import { clampRotation } from '../core/limits';
import { BOW, PELVIS, TURN, followed } from './balance/balance';
import { GOAL_VELOCITY_RATE, JUMP_SPEED, START, STOP, START_GLIDE } from './balance/carriage';
import { checkSupport } from './balance/checks';
import { Life } from './balance/life';
import { LOWER, Posture, entrain, walking, type Trunk, type Upright } from './balance/posture';
import { INDEX } from './bones';
import { drivenBy } from './driven';
import type { Humanoid } from './humanoid';
import { humanGait, humanStepping } from './legs';
import { defaultStance } from './stance';
import type { Proportions } from './proportions';
import type { Stepping } from '../core/legs/stepper';

/**
 * A person walking where asked on the core legs: the root planner pursues `asks.go` (facing `asks.face`, or the way it goes) as a
 * player's input would drive it, and the stepper keeps the legs under it (`drivenBy`). A walk starts once the goal is `START` off
 * (its glide kept to `START_GLIDE` until the first foot lands) and ends once close, slow and the goal still (`STOP`). The pelvis,
 * at the stepper's height, sways and turns with the stride as `Posture` carries it, the thorax counter-rotating, the trunk as asked.
 * Temporary opt-in during migration.
 */
export function stride<W>(h: Humanoid<W>, options: { stance?: Partial<Stance>; seed?: number } = {}): Behaviour<W> {
  const p = h.proportions, s = p.scale, toeOut = defaultStance(p).toeOut, base = { ...defaultStance(p), ...options.stance };
  const stop = h.pose.position(0).clone().setY(0), velocity = new Vector3();
  let planner: Planner | null = null, moving = false, starting = false, seen = false, phase = 0;
  const c: Upright = { p, root: stop.clone(), offset: new Vector3(), yaw: h.yaw, walk: 0, run: 0, moving: false, stance: base, feet: h.feet, pelvis: new Vector3(), pelvisRotation: new Quaternion() };
  const posture = new Posture(), life = new Life(options.seed ?? seedOf(p.height, h.feet[0].position.x, h.feet[0].position.z));
  const trunk: Trunk = { chest: new Quaternion(), thoraxYaw: 0 }, asked = { lower: [0, 0], bow: [0, 0], twist: [0, 0] };
  const pelvis = new TrackedPoint(), rotation = new TrackedRotation(), back = [new TrackedRotation(), new TrackedRotation()];
  const offsets = [new Vector3(), new Vector3()], tilts = [new Quaternion(), new Quaternion()];
  return drivenBy(h, (f, asks, stepper) => {
    // (a walker's balance is checked, not only noted as a player's is)
    if (f.dev) checkSupport(h, f, f.dev);
    const plan = planner ??= new Planner(h.pose.position(0), h.yaw, humanGait(p), p.hipHalfWidth);
    const go = asks.go, dt = f.dt, root = plan.root.position;
    // (the goal's own velocity picked up; one jumping was re-planned, not carried)
    if (go) {
      const travel = go.to.clone().sub(stop).setY(0);
      if (go.velocity) velocity.copy(go.velocity);
      else velocity.lerp(seen && travel.length() <= JUMP_SPEED * dt ? travel.divideScalar(dt) : travel.set(0, 0, 0), 1 - Math.exp(-GOAL_VELOCITY_RATE * dt));
      stop.copy(go.to).setY(0);
    } else velocity.set(0, 0, 0);
    seen = !!go;
    if (!moving && (root.distanceTo(stop) > START.distance * s || velocity.length() > START.speed)) [moving, starting] = [true, true];
    if (stepper.legs.some((leg) => leg.landed)) starting = false;
    const heading = Math.atan2(stop.x - root.x, stop.z - root.z);
    const travelYaw = plan.root.velocity.lengthSq() > 1e-8 ? Math.atan2(plan.root.velocity.x, plan.root.velocity.z) : heading;
    const yaw = asks.face?.yaw ?? (moving ? travelYaw : plan.root.yaw);
    const faced = !!asks.face || !moving || Math.abs(wrapAngle(heading - plan.root.yaw)) >= Math.PI / 4;
    const stance = stepper.legs.reduce((sum, leg) => sum + wrapAngle(leg.yaw - leg.sign * toeOut - plan.root.yaw), 0) / stepper.legs.length + plan.root.yaw;
    const r = plan.step(f, { position: moving ? stop : root.clone(), velocity: moving ? velocity : new Vector3(), yaw: faced ? yaw : undefined },
      { accel: go?.accel ?? 1.2 * s, speed: moving ? Math.min(go?.speed ?? 1.3 * s, starting ? START_GLIDE * s : Infinity) : 0, turnSpeed: asks.face?.rate },
      stance, (forecast) => stepper.reachable(forecast));
    if (root.distanceTo(stop) < STOP.distance * s && r.velocity.length() < STOP.speed && velocity.length() < STOP.goalSpeed) moving = false;
    return r;
  }, (f, asks, stepper) => {
    // the pelvis swayed and turned with the stride over the stepper's root, as low as asked; the trunk counter-rotating, bowing as asked
    const dt = f.dt, speed = h.locomotion.velocity.length(), at = f.current.position(0);
    c.stance = asks.stance ? { ...base, ...asks.stance } : base;
    [c.walk, c.moving, c.yaw] = [walking(c.walk, speed, dt), moving, stepper.yaw];
    c.root.copy(at).setY(0);
    life.update(dt, life.quiet(asks, h), speed);
    const requested = { lower: followed(asked.lower, asks.lower, LOWER, dt), bow: followed(asked.bow, Math.min(asks.bow, asks.bowLimit), BOW, dt), twist: followed(asked.twist, asks.twist, BOW, dt) };
    const swing = stepper.legs.find((leg) => leg.swing)?.swing;
    // (the stride's phase pulled into step with the feet's, never jumping as a foot lifts)
    phase = entrain(phase, stepper.phase, 2 * Math.PI / stepper.cycle, dt);
    posture.carry(f, c, requested, trunk, life, { phase, bob: swing ? Math.sin(Math.PI * swing.u) : 0, nod: swing ? Math.cos(2 * Math.PI * swing.u) : 1, compression: 0 }, (height) => height);
    const offset = pelvis.follow(offsets[0], offsets[1], c.pelvis.clone().sub(c.root).setY(0), PELVIS, dt, new Vector3());
    [offsets[0], offsets[1]] = [offsets[1], offset.clone()];
    f.current.setRoot(offset.add(at).setY(at.y - requested.lower));
    const tilt = rotation.follow(tilts[0], tilts[1], new Quaternion().setFromAxisAngle(UP, -stepper.yaw).multiply(c.pelvisRotation), TURN, dt, new Quaternion());
    [tilts[0], tilts[1]] = [tilts[1], tilt.clone()];
    f.current.setLocal(0, tilt.premultiply(new Quaternion().setFromAxisAngle(UP, stepper.yaw)));
    const half = f.current.local(0).clone().invert().multiply(trunk.chest).slerp(new Quaternion(), 0.5);
    [INDEX.spine, INDEX.chest].forEach((bone, k) => {
      const local = half.clone(), limit = f.current.skeleton.limits[bone];
      if (limit) clampRotation(local, limit);
      f.current.setLocal(bone, back[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TURN, dt, new Quaternion()));
    });
    h.locomotion.quiet.copy(posture.quiet);
    return trunk.thoraxYaw;
  }, walkerStepping(p));
}

/**
 * A walker's stepping: a player's, but the stance leg near straight at mid-stance (tuned to Perry's ~5–10° of knee flexion; a
 * player's body keeps more bend), a 60% stance (recalled: Perry 1992, stance 60% of the cycle at free speed; the shorter double
 * support keeps the extrapolated centre of mass within the feet), and a deeper bob (tuned: its low in the double support, ~4 cm).
 */
const walkerStepping = (p: Proportions): Stepping => {
  const player = humanStepping(p);
  return { ...player, reach: 0.997, duty: { ...player.duty, walk: 0.6 }, bob: 0.042 };
};
const UP = new Vector3(0, 1, 0);
