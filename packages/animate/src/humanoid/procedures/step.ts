import { Quaternion, Vector3 } from 'three';
import { action, type NonReuseableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '../../core/body';
import { INDEX, type Side } from '../bones';
import { ankleFor, ballOf, footRotation, heelOf, toeTipOf } from '../gait/foot';
import { swingHump, swingProgress } from '../gait/swing';
import type { Humanoid } from '../humanoid';
import { leftOf, lerp, minimumJerk, smoothstep, softplus, wrapAngle } from '../math';
import { legCaps, STEPPING } from '../profile/caps';
import { holdLeg, plant, type Hold, type Leg } from './footing';
import { carryCom, overFoot, READY, shiftWeight } from './shift';
import { withinReach } from './legs';

/** where a foot stands: its flat-foot ankle and heading */
export interface Foothold {
  position: Vector3;
  yaw: number;
}

export interface StepOptions {
  /** where the foot lands: asked every frame while the landing may still be fine-tuned (`adapt`) */
  to: () => Foothold;
  /** s */
  duration: number;
  /** the ankle's rise over its straight path (m) */
  lift: number;
  /** the foot's pitch at heel strike (rad, + toes up) */
  strike: number;
  /** 0 walking … 1 running: the shape of the arc */
  run?: number;
  /** the share of the swing over which the landing's fine-tuning fades out; default [0.4, 0.75] */
  adapt?: readonly [number, number];
  /** the leg as the body carries it this frame (its knee bends over the toes, the foot swings past the standing one to its own side, as the body faces) */
  leg: () => Leg;
  hold: Omit<Hold, 'support'>;
  /** the weight shifted onto the other foot first, and kept over it through the swing (a step from standing; a walk's body carries itself) */
  shift?: boolean;
}

// Constants copied from the old core (a801be4:packages/core/src/gait/roll.ts, swing.ts).
/** the swinging ankle holds its push-off through the start of the swing, then returns to just past neutral (rad): the toes clear the floor */
const SWING_ANKLE = 0.06;
const SWING_RETURN = [0.1, 0.45] as const;
/** how far the ankle flexes up (rad) */
const DORSIFLEXION = (40 * Math.PI) / 180;
/** how long the foot's speed at lift-off carries on into the swing (s, time constant) */
const LIFT_BLEND = 0.06;
/** the swing path's pace at its start, as a share of the mean (`swingProgress`'s slope at 0) */
const SWING_START = 0.34;
/** how long the foot's roll at toe-off carries on into the swing (s, time constant) */
const ROLL_ON = 0.05;
/** the share of the swing from which the foot turns toes-up into the heel strike */
const STRIKE_TURN = 0.5;
/** the sole's clearance over the floor through the swing (m) */
const SOLE_CLEARANCE = 0.012;
/** the share of the swing over which the leg's reach is taken in after lift-off, and given back before landing */
const REACH_IN = 0.25;
/** the share of a step from standing's swing over which the foot's rise comes in */
const FLAT_LIFT = 0.3;
/** the share of the swing over which the sole's clearance comes in */
const CLEARING = 0.2;
/** the share of the swing over which the toes relax from the floor into line with the foot */
const TOES_RELAX = 0.3;
/** how far a swinging leg reaches, at most (× its length): all but straight as it lifts and lands (where the body was put for it), a runner's less in between */
const LANDING_REACH = 0.998;
const SWING_REACH = 0.93;
/** how far to its own side of the standing foot a swinging ankle passes, at least (m, default body) */
const SWING_PAST = 0.06;

/** a step's legs move as stepping's do */
const LEG_CAPS = legCaps(STEPPING);

const _land = new Vector3();
const _ankle = new Vector3();
const _rotation = new Quaternion();
const _toes = new Quaternion();
const _v = new Vector3();
const _heel = new Vector3();
const _ball = new Vector3();
const _rel = new Vector3();
const _over = new Vector3();
const _reach = new Vector3();

/**
 * The shank's forward tilt over a foot heading `yaw` as the body was solved (rad, + the knee ahead
 * of the ankle)
 */
export function shankTilt<W>(ctx: Ctx<W>, side: Side, yaw: number): number {
  const shin = _v.subVectors(ctx.body.positions[INDEX[`${side}LowerLeg`]], ctx.body.positions[INDEX[`${side}Foot`]]);
  return Math.atan2(shin.x * Math.sin(yaw) + shin.z * Math.cos(yaw), shin.y);
}

/**
 * A step: foot `side` lifts off from where it is, swings along an arc to its landing (rising
 * early as the knee flexes, clearing the floor, past the standing foot to its own side; the
 * ankle carrying its push-off back to neutral, then turning toes-up into the heel strike) and
 * lands on its heel. The status has the foot swinging toward its landing, then planted there.
 * Returns whether it landed: a step whose foot another behaviour takes gives up.
 */
export function step<W>(h: Humanoid<W>, side: Side, options: StepOptions): NonReuseableTimeline<Ctx<W>, boolean> {
  const p = h.proportions;
  const s0 = side === 'left' ? 0 : 1;
  const foot = h.status.feet[s0];
  const sign = side === 'left' ? 1 : -1;
  const [adaptFrom, adaptTo] = options.adapt ?? [0.4, 0.75];
  const run = options.run ?? 0;
  const bone = INDEX[`${side}Foot`];
  const other: Side = side === 'left' ? 'right' : 'left';
  const otherBone = INDEX[`${other}Foot`];
  return (function* () {
    // (its foot held planted meanwhile, by the step: it is the step's from the start)
    if (options.shift) yield* shiftWeight(h, other, options.hold.owner, (ctx) => plant(ctx, h, side, 0, options.leg(), options.hold));
    let s = 0;
    let started = false;
    let landed = false;
    let fromYaw = 0;
    let liftAnkle = 0;
    let liftToes = 0;
    let liftRate = 0;
    const liftVelocity = new Vector3();
    const to = { position: new Vector3(), yaw: 0 };
    const from = new Vector3();
    const hip0 = new Vector3();
    const hipLanding = new Vector3();
    yield* action<Ctx<W>>({
      update: (ctx) => {
        if (!started) {
          started = true;
          // (from where the foot is: its ankle, heading and pitch as solved)
          from.copy(ctx.body.positions[bone]);
          const leg = options.leg();
          hip0.copy(leg.hip);
          hipLanding.copy(leg.hip).addScaledVector(_v.copy(ctx.body.comVelocity).setY(0), options.duration);
          const q = ctx.body.rotations[bone];
          fromYaw = foot.yaw;
          const fwd = _v.set(0, 0, 1).applyQuaternion(q);
          const pitch = Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z));
          liftAnkle = pitch + shankTilt(ctx, side, fromYaw);
          // (the foot rolling up off the floor rolls on a moment: no jolt at toe-off)
          liftRate = -ctx.body.spins[bone].dot(leftOf(fromYaw, _v));
          liftToes = Math.max(0, pitch);
          // (what the path's own start adds to it: its pace off the floor along the step)
          liftVelocity.copy(ctx.body.velocities[bone]).addScaledVector(_v.subVectors(options.to().position, from).setY(0), -SWING_START / options.duration);
          const first = options.to();
          to.position.copy(first.position);
          to.yaw = first.yaw;
        } else if (ctx.granted(options.hold.owner).lost.some((c) => c.point !== 'com' && c.point.bone === bone)) return false;
        s = Math.min(1, s + ctx.dt / options.duration);
        // the landing is chosen at lift-off and only fine-tuned through the first part of the
        // swing: a landing that moves later reads as a stumble
        const adapt = 1 - smoothstep(adaptFrom, adaptTo, s);
        if (adapt > 0 && s < 1) {
          const want = options.to();
          const k = adapt * Math.min(1, ctx.dt * 20);
          to.position.lerp(want.position, k);
          to.yaw += wrapAngle(want.yaw - to.yaw) * k;
        }
        foot.phase = 'swing';
        foot.position.copy(to.position);
        foot.yaw = to.yaw;
        if (s >= 1) {
          landed = true;
          foot.phase = 'planted';
          // (as the swing ended: no more toes-up than the ankle flexes under the shank)
          const pitch = Math.min(options.strike, DORSIFLEXION - shankTilt(ctx, side, to.yaw));
          ankleFor(p, side, to.position, to.yaw, pitch, _ankle);
          const rotation = footRotation(to.yaw, pitch, _rotation);
          holdLeg(ctx, h, side, _ankle, rotation, rotation, options.leg(), { ...options.hold, support: 1 });
          return false;
        }
        const e = swingProgress(s, false);
        ankleFor(p, side, to.position, to.yaw, options.strike, _land);
        const ankle = _ankle.lerpVectors(from, _land, e);
        // (leaving the floor at the speed it was moving at, then on its path: no jolt at lift-off;
        // a runner's foot, carried by the leg from the hip, is so already)
        const t = s * options.duration;
        ankle.addScaledVector(liftVelocity, (1 - run) * t * Math.exp(-t / LIFT_BLEND));
        // (a runner's foot is carried along by the leg from the hip as it swings: from where it left
        // the floor behind it to where it lands ahead of it, back on its world path for the landing)
        const carried = run * smoothstep(0, 0.3, s) * (1 - smoothstep(0.45, 1, s));
        if (carried > 0) {
          const leg = options.leg();
          _rel.subVectors(from, hip0).lerp(_v.subVectors(_land, hipLanding), e).add(leg.hip);
          ankle.lerp(_rel, carried);
        }
        // (a foot lifted flat off the floor, from standing, rises from rest: off a nearly straight
        // leg its first centimetre is most of the knee's bend)
        ankle.y += options.lift * swingHump(s, run) * (options.shift ? smoothstep(0, FLAT_LIFT, s) : 1);
        const yaw = fromYaw + wrapAngle(to.yaw - fromYaw) * e;
        // past the standing foot with room, out to its own side as the body faces
        const leg = options.leg();
        const facing = leg.facing;
        // (the other ankle as it is, standing or not: no jump as it lifts)
        const left = leftOf(facing, _v);
        const lateral = ankle.clone().sub(ctx.body.positions[otherBone]).dot(left) * sign;
        const room = softplus(SWING_PAST * p.scale - lateral, 0.01 * p.scale);
        ankle.addScaledVector(left, sign * room * Math.sin(Math.PI * s) * (1 - 0.5 * run));
        // the ankle returns from its push-off, then the foot turns toes-up into the heel strike
        const tilt = shankTilt(ctx, side, yaw);
        const rolled = liftAnkle + liftRate * ROLL_ON * (1 - Math.exp((-s * options.duration) / ROLL_ON));
        const angle = lerp(rolled, SWING_ANKLE, minimumJerk((s - SWING_RETURN[0]) / (SWING_RETURN[1] - SWING_RETURN[0])));
        // (a step from standing carries the foot level: there was no push-off to return from)
        const pitch = options.shift ? options.strike * smoothstep(STRIKE_TURN, 1, s) : Math.min(lerp(angle - tilt, options.strike, smoothstep(STRIKE_TURN, 1, s)), DORSIFLEXION - tilt);
        // the toes, bent up on the floor at lift-off, relax into line with the foot
        const toes = lerp(liftToes, pitch, smoothstep(0, TOES_RELAX, s));
        // the sole never goes through the floor, and clears it by a little through the swing
        const rotation = footRotation(yaw, pitch, _rotation);
        const ball = ballOf(p, side, _ball).applyQuaternion(rotation);
        const tip = toeTipOf(p, _v)
          .sub(ballOf(p, side, _heel))
          .applyQuaternion(footRotation(yaw, toes, _toes))
          .add(ball).y;
        const heel = heelOf(p, _heel).applyQuaternion(rotation).y;
        const floor = to.position.y - p.ankleHeight;
        const low = ankle.y + Math.min(tip, heel) - floor;
        // (from nothing as the foot leaves the floor: no jump up off it)
        ankle.y += softplus(SOLE_CLEARANCE * Math.sin(Math.PI * s) - low, 0.004) * smoothstep(0, CLEARING, s);
        // (never out of the leg's reach, the hip would be dragged after it; a runner's foot, left far
        // behind, is drawn in once off the floor, all of the reach again as it comes down; taken
        // in from the floor and given back to it: where the foot left and lands, the leg reaches
        // as it does, and a sudden draw in would snap the knee)
        const reached = withinReach(leg.hip, _reach.copy(ankle), lerp(LANDING_REACH, SWING_REACH, run * smoothstep(0, 0.2, s) * (1 - smoothstep(0.6, 1, s))) * p.legLength);
        ankle.lerp(reached, smoothstep(0, REACH_IN, s) * (1 - smoothstep(1 - REACH_IN, 1, s)));
        holdLeg(ctx, h, side, ankle, rotation, footRotation(yaw, toes, _toes), leg, { ...options.hold, support: 0 });
        for (const c of LEG_CAPS) ctx.propose.cap(c);
        if (options.shift) {
          // the weight over the standing foot (it goes over to the landed one as the stand has it);
          // the pelvis lowered as far as the landing foot needs to reach the floor (asked of
          // whoever carries it)
          carryCom(ctx, h, overFoot(h, other, _over), options.hold.owner);
          const reach = LANDING_REACH * p.legLength;
          const across = (leg.hip.x - _land.x) ** 2 + (leg.hip.z - _land.z) ** 2;
          const top = _land.y + Math.sqrt(Math.max(1e-4, reach * reach - across)) + ctx.body.positions[0].y - leg.hip.y;
          const crouch = p.hipHeight - h.status.stance.crouch - top;
          h.hints.crouch(ctx.time, Math.max(READY * p.height, crouch * smoothstep(0.2, 0.8, s)));
        }
      },
    });
    return landed;
  })();
}
