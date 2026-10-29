import { Vector3 } from 'three';
import type { Step } from '../../kernel/frame';
import { offTheWay, Planner, stanceYaw } from '../planner';
import { forwardOf, wrapAngle } from '../../kernel/math';
import type { Stance } from '../../kernel/go';
import type { Stepper } from '../step/stepper';
import { hullOf, past } from '../support';
import { footprint } from './foot';
import { checkSupport, drivenBy, feetBehind } from './balance';
import type { PersonLegged } from './legged';
import { humanGait, humanStepping } from './stepping';
import { OVER_ANKLES } from '../../species/humanoid/stance';

/**
 * A person standing and walking where asked on the core legs: the root — the body's centre of mass over the floor — goes where the
 * planner takes it where its legs are asked to go (facing as asked, or the way it goes) as a player's input would drive it, and the stepper keeps
 * the legs under it and carries the body over it as it would a player's (`drivenBy`), catching the extrapolated centre of mass with a
 * step when it leaves the feet. A walk starts once the goal is `START` off (its glide kept to `START_GLIDE` until the first foot lands)
 * and ends once close, slow and the goal still (`STOP`).
 */
export function stride(person: PersonLegged, options: { stance?: Partial<Stance>; seed?: number } = {}): Step {
  const proportions = person.proportions, s = proportions.scale, toeOut = humanStepping(proportions, true, person.stride).toeOut;
  const stop = new Vector3(), velocity = new Vector3();
  let planner: Planner | null = null, still: Vector3 | null = null;
  let moving = false, starting = false, seen = false, leaning = false, settling = false;
  // (`from` shifted by `shift` as far as the planted feet hold it, `LEAN.inside` within their edge)
  const within = (from: Vector3, shift: Vector3 | null, stepper: Stepper) => {
    if (!shift) return from;
    const hull = hullOf(stepper.legs.filter((leg) => !leg.swing).flatMap((leg) => footprint(proportions, leg.anchor, leg.yaw)));
    if (hull.length < 3) return from;
    const at = (t: number) => from.clone().addScaledVector(shift, t);
    if (past(hull, at(1)) <= -LEAN.inside * s) return at(1);
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 12; k++) [lo, hi] = past(hull, at((lo + hi) / 2)) <= -LEAN.inside * s ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    return at(lo);
  };
  return drivenBy(person, (f, go, poise, stepper) => {
    // (a walker's balance is checked, not only noted as a player's is)
    if (f.dev) checkSupport(person, f, f.dev);
    const dt = f.dt, face = go?.face;
    if (!planner) {
      planner = new Planner(f.prev.com(new Vector3()), person.yaw, humanGait(proportions), proportions.hipHalfWidth);
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
    // (a walk is under way while the body turns to a facing asked too: turning on the spot, a goal moving off is walked after at once, not
    // once it is a start's distance away)
    const unturned = face ? Math.abs(wrapAngle(face.yaw - plan.root.yaw)) : 0;
    const off = (still ?? root).distanceTo(stop) > START.distance * s || velocity.length() > START.speed || unturned > START.faced;
    if (!moving && off) [moving, starting, still, leaning] = [true, true, null, false];
    if (stepper.legs.some((leg) => leg.landed)) starting = false;
    const heading = Math.atan2(stop.x - root.x, stop.z - root.z);
    const travelYaw = plan.root.velocity.lengthSq() > 1e-8 ? Math.atan2(plan.root.velocity.x, plan.root.velocity.z) : heading;
    const yaw = face?.yaw ?? (moving ? travelYaw : plan.root.yaw);
    const faced = !!face || !moving || offTheWay(heading, plan.root.yaw);
    const stance = stanceYaw(stepper.legs, plan.root.yaw, toeOut);
    // (stopped close to a goal still asked, the body edges on onto it, the feet staying put; at rest, its weight goes as a reach shifts it)
    const shift = !moving && !go ? poise.shift : null;
    const leaned = still && (shift || leaning) ? within(still, shift, stepper) : null;
    leaning = !!leaned && (!!shift || root.distanceTo(leaned) > LEAN.back * s);
    // (at rest on planted feet it settles over their rear half, `OVER_ANKLES` ahead of the ankles, as a person stands — read: Winter 1995,
    // Gait Posture 3:193, the quiet gravity line ~4–6 cm ahead of the ankles — wherever it stopped; edging onto a goal still asked, its
    // weight goes no further than `EDGING` from there: further, it steps)
    // (within `LEAN.back` of it, it is there: held, not chased to and fro by a sub-step's acceleration)
    const planted = !moving && stepper.legs.every((leg) => !leg.swing);
    const anchors = () => stepper.legs.reduce((sum, leg) => sum.add(leg.anchor), new Vector3()).divideScalar(stepper.legs.length);
    const over = planted ? anchors().setY(0).addScaledVector(forwardOf(stance), OVER_ANKLES * s) : null;
    // (within `EDGING` of it — where a walk's arrival edged it onto its goal — it stands as it is: going back over its feet would shift
    // its weight under a stance squared for where it stands, and step again; further off, it settles all the way back)
    settling = !go && !!over && root.distanceTo(over) > (settling ? LEAN.back : EDGING) * s;
    const rest = settling ? over : null;
    const edging = go && over ? stop.clone().sub(over).clampLength(0, EDGING * s).add(over) : stop;
    // (edged onto a still goal, it is there: held, not chased to and fro — so its feet are judged standing, as they will be once the walk
    // ends; a goal on the move, it keeps edging after it)
    const edged = edging.distanceTo(root) > LEAN.back * s || velocity.length() >= STOP.goalSpeed ? edging : null;
    // (the feet stand with their ankles a little behind the centre of mass: a person stands with it over the middle of the feet)
    const behind = feetBehind(stepper, s);
    const goal = {
      position: moving ? stop : go ? edged ?? root.clone() : leaned ?? rest ?? root.clone(),
      velocity: moving ? velocity : new Vector3(),
      yaw: faced ? yaw : undefined,
    };
    const walking = Math.min(go?.speed ?? 1.3 * s, starting ? START_GLIDE * s : Infinity);
    const speed = moving ? walking : go ? (edged ? EDGE * s : 0) : leaned || rest ? LEAN.speed * s : 0;
    const motion = { accel: go?.accel ?? 1.2 * s, speed, turnSpeed: face?.rate };
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

/** how quickly the goal's own velocity is picked up (1/s) */
const GOAL_VELOCITY_RATE = 9;
/** a goal moving faster than this (m/s) was re-planned, not carried: it jumped */
const JUMP_SPEED = 4;
/** a walk starts when the goal is this far (m, default body), turned (rad; a facing asked: `faced`, just past where it stops) or moving (m/s) */
const START = { distance: 0.14, yaw: 0.45, faced: 0.12, speed: 0.25 };
/** it stops once close, slow, the goal still and the facing reached */
const STOP = { distance: 0.05, speed: 0.15, goalSpeed: 0.08, yaw: 0.1 };
/** until the first foot is off the ground the body barely glides (m/s) */
const START_GLIDE = 0.15;
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
