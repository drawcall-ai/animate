import { Vector3 } from 'three';
import type { Task } from '../intent/tasks';
import { clamp, hypot, smoothstep, softMin, wrapAngle, yawOf } from '../math';
import { footYaw } from '../stance';
import { swingHump, swingProgress } from './foot';
import type { Gait } from './gait';
import { groundAt, heightAlong } from './obstacles';
import { desiredAnchor, fitLanding } from './placement';
import { leadTime, type Timing } from './timing';

/** a foot target lifts the foot once the extrapolated centre of mass is this close to the other foot (m, default body) */
const LIFT_OFF = 0.03;
/** a foot target let go of at most this high over the floor and this far from where the foot stood puts it down there (m, default body) */
const PLACED = 0.03;
/** how far along a stride from standing the body goes by the time the foot is down */
const CARRY = 0.6;
/** how quickly a foot carried low and away turns into a stride (1/s) */
const STRIDE_RATE = 10;
/** how quickly the body follows a stride (1/s) */
const CARRY_RATE = 12;
/** how far a raised foot is pointed, plantarflexed from the shin (rad; an instep kick's foot is locked ~40° down) */
const POINTED = 0.7;
/** how quickly a raised foot points or levels (1/s) */
const POINT_RATE = 10;
/** the furthest a striding foot turns to point the way it goes (rad) */
const STRIDE_TURN = 1.4;
/** the longest a foot target waits for the weight to shift off its foot (s) */
const LIFT_WAIT = 0.4;
/** the shortest time a lifted foot takes to reach its target's full weight (s) */
const LIFT_TIME = 0.15;
/** the share of a swing (from, to) over which its landing's fine-tuning fades out */
const ADAPT = [0.4, 0.75] as const;
/** how far to its own side of the standing foot a swinging ankle passes, at least (m, default body) */
const SWING_PAST = 0.06;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/**
 * Feet held up by a foot target (kicks, stepping on things); the other foot pivots under
 * the body. A foot lifts once the body's weight is over the other one (its extrapolated
 * centre of mass within that foot), then rises toward the target at a human pace. A weight
 * shift that doesn't get there in LIFT_WAIT lifts it anyway: the move happens, off balance,
 * rather than silently not at all. A target let go of on the floor away from where the foot
 * stood was a step (a stride, a lunge): the foot is put down there.
 */
export function updateLifted(g: Gait, tasks: readonly [Task | null, Task | null], dt: number) {
  const { feet, d } = g;
  for (let s = 0; s < 2; s++) {
    const f = feet[s];
    const task = tasks[s];
    const sup = feet[1 - s];
    f.liftWait = task && f.phase === 'planted' ? f.liftWait + dt : 0;
    const over = g.capture.outside(sup.anchor, sup.yaw, null, 0) <= LIFT_OFF * d.scale;
    if (task && f.phase === 'planted' && sup.phase === 'planted' && (over || f.liftWait > LIFT_WAIT)) {
      f.phase = 'lifted';
      f.liftWeight = 0;
      f.liftPitch = f.pose.pitch;
      f.liftFrom.copy(f.pose.ankle);
      f.pointed = 0;
      f.striding = 0;
      // (a stride taken on the move carries the body on at its pace, and all the way onto the foot)
      f.carry[0].velocity = g.velocity.x;
      f.carry[1].velocity = g.velocity.z;
      f.carryShare = CARRY + (1 - CARRY) * smoothstep(0.5, 2, g.speed);
      f.strided = false;
      f.pivotBase = f.yaw;
      for (const c of f.carry) c.value = 0;
      sup.pivotBase = sup.yaw;
    }
    if (f.phase !== 'lifted') continue;
    f.liftWeight = Math.min(task ? task.weight : 0, f.liftWeight + dt / LIFT_TIME);
    const w = f.liftWeight;
    if (!task) {
      sup.yaw = sup.pivotBase;
      const a = f.pose.ankle;
      // a foot target let go of on the floor away from where the foot stood was a step:
      // the foot stays where it was put, pointing the way it went
      if (hypot(a.x - f.anchor.x, a.z - f.anchor.z) > PLACED * d.scale && a.y - f.anchor.y < PLACED * d.scale) {
        f.anchor.set(a.x, groundAt(g.steer.ground, a.x, a.z) + d.ankleHeight, a.z);
        f.strided = true;
        g.lastLanded = s;
        // (the front leg takes the body's weight and brakes it)
        g.velocity.set(0, 0, 0);
      } else f.yaw = f.pivotBase;
      f.phase = 'planted';
      f.striding = 0;
      f.plantedTime = 0;
      f.landPitch = 0;
      f.pose.pitch = 0;
      continue;
    }
    // the support foot pivots on its ball, more for kicks that go around the side
    const rx = task.pos.x - g.root.x;
    const rz = task.pos.z - g.root.z;
    const hl = hypot(rx, rz) || 1;
    const lat = Math.abs(rx * Math.cos(g.root.yaw) - rz * Math.sin(g.root.yaw)) / hl;
    sup.yaw = sup.pivotBase + f.side * (0.3 + 1.1 * lat) * w * smoothstep(0.2, 0.6, task.pos.y / d.height);
    // (from where it left the floor, its heel up as it stood)
    // (eased: it sets off from rest, rising first)
    const ankle = f.pose.ankle.copy(f.liftFrom).lerp(task.pos, smoothstep(0, 1, w));
    ankle.y += 0.12 * d.height * Math.sin(Math.PI * w) ** 2 * 0.5 * (1 - w);
    // a foot carried low and away is striding: it turns the way it goes (not backward) and
    // stays level to land; a raised one (a kick) points its toes
    const dx = task.pos.x - f.anchor.x;
    const dz = task.pos.z - f.anchor.z;
    const low = 1 - smoothstep(0.03 * d.height, 0.06 * d.height, task.pos.y - f.anchor.y);
    const way = wrapAngle(footYaw(yawOf(dx, dz), f.side, g.stance) - f.pivotBase);
    // (eased in and out: the body falls into a stride)
    f.striding += (low * smoothstep(0.1, 0.3, hypot(dx, dz) / d.scale) - f.striding) * Math.min(1, STRIDE_RATE * dt);
    const striding = f.striding;
    // (as far as a foot turns in a step; one going backward keeps its heading)
    const turn = clamp(way, -STRIDE_TURN, STRIDE_TURN) * (1 - smoothstep(2, 2.6, Math.abs(way)));
    f.yaw = f.pivotBase + turn * striding * w;
    // (from the pitch it left the floor with; pointed as it rises — in a few tenths of a second,
    // however fast it goes up — and level again by the time it is down on the floor)
    const point = smoothstep(0.02 * d.height, 0.08 * d.height, ankle.y - f.anchor.y);
    f.pointed = Math.min(point, f.pointed + (point - f.pointed) * Math.min(1, POINT_RATE * dt));
    f.pose.pitch = f.liftPitch + (-POINTED * f.pointed - f.liftPitch) * w;
    // and the body goes along, part of the way, smoothly: the stride carries the root
    const k = f.carryShare * striding * w;
    if (dt > 0 && (k > 0 || f.carry[0].value !== 0 || f.carry[1].value !== 0)) {
      const [cx, cz] = f.carry;
      const x = cx.value;
      const z = cz.value;
      g.root.x += cx.step((ankle.x - f.anchor.x) * k, CARRY_RATE, dt) - x;
      g.root.z += cz.step((ankle.z - f.anchor.z) * k, CARRY_RATE, dt) - z;
      g.velocity.set(cx.velocity, 0, cz.velocity);
    }
  }
}

/** Advance swinging feet along their arcs; land them at the end. */
export function advanceSwings(g: Gait, dt: number, t: Timing) {
  for (let s = 0; s < 2; s++) {
    const f = g.feet[s];
    if (f.phase !== 'swing') continue;
    const w = f.swing;
    const { pose } = f;
    w.s += dt / w.duration;
    // the landing is chosen at toe-off and only fine-tuned through the first part of the
    // swing (ADAPT), well before the foot comes down: a landing that moves later reads as a
    // stumble (the foot comes down, then reaches on). A foothold chosen around an obstacle
    // is kept as is: re-planning mid-air would flip between stepping short and long.
    const adapt = w.pace < Infinity ? 0 : 1 - smoothstep(ADAPT[0], ADAPT[1], w.s);
    const remaining = (1 - w.s) * w.duration;
    if (adapt > 0) {
      const lead = g.moving ? leadTime(t, remaining) : 0;
      const yaw = desiredAnchor(g, s, lead, _c);
      fitLanding(g, s, _c, yaw, remaining);
      // never slide the landing across an obstacle (the lerp would stop on top of it)
      if (heightAlong(g, w.to, _c) === 0) {
        const k = adapt * Math.min(1, dt * 20);
        w.to.lerp(_c, k);
        w.toYaw += wrapAngle(yaw - w.toYaw) * k;
      }
    }
    if (w.s >= 1) {
      f.phase = 'planted';
      f.anchor.copy(w.to);
      f.yaw = w.toYaw;
      f.landPitch = w.strikePitch;
      pose.pitch = w.strikePitch;
      f.plantedTime = 0;
      g.lastLanded = s;
      continue;
    }
    // the foot travels at a nearly steady pace, rising early as the knee flexes
    const e = swingProgress(w.s, w.early);
    const land = f.ankleFor(w.to, w.toYaw, w.strikePitch, _a);
    const ankle = pose.ankle.lerpVectors(w.from, land, e);
    ankle.y += w.lift * swingHump(w.s, t.run);
    // stepping over something: same timing and path, just a higher, flat-topped arc
    // (the obstacle sits mid-step, so the plateau covers it); smooth max, no kink.
    // Flat top over the obstacle, ramps as long as the step allows: the foot rises
    // all the way up to it and sets down all the way after it (no snapping up)
    w.over = w.clear > 0 ? smoothstep(0, w.overOn, w.s) * (1 - smoothstep(w.overOff, 1, w.s)) : 0;
    if (w.over > 0) ankle.y = -softMin(-ankle.y, -w.clear * w.over, 0.06);
    // (the foot's pitch, and the toes' clearance with it, follow the leg: FootRoll)
    f.yaw = w.fromYaw + wrapAngle(w.toYaw - w.fromYaw) * e;
    // the foot swings past the standing one with room, never brushing it (along a curve the
    // straight path from lift-off to landing cuts in toward it): out to its own side as the
    // body faces, fading in and out with the swing (half as much running: runners' feet land near a line)
    const other = g.feet[1 - s];
    if (other.phase !== 'planted') continue;
    const lx = Math.cos(g.root.yaw);
    const lz = -Math.sin(g.root.yaw);
    const lateral = ((ankle.x - other.anchor.x) * lx + (ankle.z - other.anchor.z) * lz) * f.side;
    const room = SWING_PAST * g.d.scale - lateral;
    if (room > 0) ankle.addScaledVector(_b.set(lx, 0, lz), f.side * room * Math.sin(Math.PI * w.s) * (1 - 0.5 * t.run));
  }
}
