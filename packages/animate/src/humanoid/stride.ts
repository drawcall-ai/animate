import { Vector3 } from 'three';
import type { Behaviour } from '../core/goal';
import { Planner } from '../core/legs/planner';
import { forwardOf, wrapAngle } from '../core/math';
import type { Stance } from '../core/asks';
import type { Stepper } from '../core/legs/stepper';
import { hullOf, past } from '../core/legs/support';
import { footprint } from './posture/foot';
import { GOAL_VELOCITY_RATE, JUMP_SPEED, START, STOP, START_GLIDE } from './posture/pace';
import { checkSupport } from './posture/checks';
import { drivenBy, feetBehind } from './driven';
import type { Humanoid } from './humanoid';
import { humanGait } from './legs';
import { defaultStance, OVER_ANKLES } from './stance';

/**
 * A person standing and walking where asked on the core legs: the root — the body's centre of mass over the floor — goes where the
 * planner takes it toward `asks.go` (facing `asks.face`, or the way it goes) as a player's input would drive it, and the stepper keeps
 * the legs under it and carries the body over it as it would a player's (`drivenBy`), catching the extrapolated centre of mass with a
 * step when it leaves the feet. A walk starts once the goal is `START` off (its glide kept to `START_GLIDE` until the first foot lands)
 * and ends once close, slow and the goal still (`STOP`).
 */
export function stride(h: Humanoid, options: { stance?: Partial<Stance>; seed?: number } = {}): Behaviour {
  const p = h.proportions, s = p.scale, toeOut = defaultStance(p).toeOut;
  const stop = new Vector3(), velocity = new Vector3();
  let planner: Planner | null = null, still: Vector3 | null = null;
  let moving = false, starting = false, seen = false, leaning = false;
  // (`from` shifted by `lean` as far as the planted feet hold it, `LEAN.inside` within their edge)
  const within = (from: Vector3, lean: Vector3 | null, stepper: Stepper) => {
    if (!lean) return from;
    const hull = hullOf(stepper.legs.filter((leg) => !leg.swing).flatMap((leg) => footprint(p, leg.anchor, leg.yaw)));
    if (hull.length < 3) return from;
    const at = (t: number) => from.clone().addScaledVector(lean, t);
    if (past(hull, at(1)) <= -LEAN.inside * s) return at(1);
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 12; k++) {
      [lo, hi] = past(hull, at((lo + hi) / 2)) <= -LEAN.inside * s ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    }
    return at(lo);
  };
  return drivenBy(h, (f, asks, stepper) => {
    // (a walker's balance is checked, not only noted as a player's is)
    if (f.dev) checkSupport(h, f, f.dev);
    const dt = f.dt, go = asks.go;
    if (!planner) {
      planner = new Planner(f.prev.com(new Vector3()), h.yaw, humanGait(p), p.hipHalfWidth);
      stop.copy(planner.root.position);
    }
    const plan = planner, root = plan.root.position;
    // (the goal's own velocity picked up; one jumping was re-planned, not carried)
    if (go) {
      const travel = go.to.clone().sub(stop).setY(0);
      if (go.velocity) velocity.copy(go.velocity);
      else {
        const moved = seen && travel.length() <= JUMP_SPEED * dt ? travel.divideScalar(dt) : travel.set(0, 0, 0);
        velocity.lerp(moved, 1 - Math.exp(-GOAL_VELOCITY_RATE * dt));
      }
      stop.copy(go.to).setY(0);
    } else velocity.set(0, 0, 0);
    seen = !!go;
    // (where it rests: its weight shifted from there as a reach asks, back there after)
    still = moving ? null : leaning ? still : root.clone();
    // (a walk is under way while the body turns to a facing asked too, as the old carriage had it: turning on the spot, a goal moving off
    // is walked after at once, not once it is a start's distance away)
    const unturned = asks.face ? Math.abs(wrapAngle(asks.face.yaw - plan.root.yaw)) : 0;
    const off = (still ?? root).distanceTo(stop) > START.distance * s || velocity.length() > START.speed || unturned > START.faced;
    if (!moving && off) [moving, starting, still, leaning] = [true, true, null, false];
    if (stepper.legs.some((leg) => leg.landed)) starting = false;
    const heading = Math.atan2(stop.x - root.x, stop.z - root.z);
    const travelYaw = plan.root.velocity.lengthSq() > 1e-8 ? Math.atan2(plan.root.velocity.x, plan.root.velocity.z) : heading;
    const yaw = asks.face?.yaw ?? (moving ? travelYaw : plan.root.yaw);
    const faced = !!asks.face || !moving || Math.abs(wrapAngle(heading - plan.root.yaw)) >= Math.PI / 4;
    const turned = stepper.legs.reduce((sum, leg) => sum + wrapAngle(leg.yaw - leg.sign * toeOut - plan.root.yaw), 0);
    const stance = turned / stepper.legs.length + plan.root.yaw;
    // (stopped close to a goal still asked, the body edges on onto it, the feet staying put; at rest, its weight goes as a reach shifts it)
    const lean = !moving && !go ? asks.lean : null;
    const leaned = still && (lean || leaning) ? within(still, lean, stepper) : null;
    leaning = !!leaned && (!!lean || root.distanceTo(leaned) > LEAN.back * s);
    // (at rest on planted feet it settles over their rear half, `OVER_ANKLES` ahead of the ankles, as a person stands — read: Winter 1995,
    // Gait Posture 3:193, the quiet gravity line ~4–6 cm ahead of the ankles — wherever it stopped; edging onto a goal still asked, its
    // weight goes no further than `EDGING` from there: further, it steps)
    // (within `LEAN.back` of it, it is there: held, not chased to and fro by a sub-step's acceleration)
    const planted = !moving && stepper.legs.every((leg) => !leg.swing);
    const anchors = () => stepper.legs.reduce((sum, leg) => sum.add(leg.anchor), new Vector3()).divideScalar(stepper.legs.length);
    const over = planted ? anchors().setY(0).addScaledVector(forwardOf(stance), OVER_ANKLES * s) : null;
    const rest = over && root.distanceTo(over) > LEAN.back * s ? over : null;
    const edged = go && over ? stop.clone().sub(over).clampLength(0, EDGING * s).add(over) : stop;
    // (the feet stand with their ankles a little behind the centre of mass: a person stands with it over the middle of the feet)
    const behind = feetBehind(stepper, s);
    const goal = {
      position: moving ? stop : go ? edged : leaned ?? rest ?? root.clone(),
      velocity: moving ? velocity : new Vector3(),
      yaw: faced ? yaw : undefined,
    };
    const walking = Math.min(go?.speed ?? 1.3 * s, starting ? START_GLIDE * s : Infinity);
    const speed = moving ? walking : go ? EDGE * s : leaned || rest ? LEAN.speed * s : 0;
    const motion = { accel: go?.accel ?? 1.2 * s, speed, turnSpeed: asks.face?.rate };
    // (the legs judge the planner's root as the stepper is given it: the feet's middle, behind the centre of mass)
    const holds: Parameters<Planner['step']>[4] = (forecast) => stepper.reachable((t) => {
      const at = forecast(t);
      return { position: at.position.clone().sub(behind), yaw: at.yaw };
    });
    const planned = plan.step(f, goal, motion, stance, holds);
    const stopped = root.distanceTo(stop) < STOP.distance * s && planned.velocity.length() < STOP.speed;
    if (stopped && velocity.length() < STOP.goalSpeed && unturned < STOP.yaw) moving = false;
    return { ...planned, centre: true, underway: moving };
  }, options);
}

/**
 * Tuned: at rest, the weight shifts toward a reach this fast (m/s), its centre of mass kept this far within the feet's edge (m), and back
 * till this near where it rested (m)
 */
const LEAN = { speed: 0.15, inside: 0.03, back: 0.001 };
/**
 * Tuned: stopped close to a goal still asked (within `STOP`), the body edges onto it this fast (m/s), its weight this far (m) either side
 * of where it rests
 */
const EDGE = 0.03, EDGING = 0.015;
