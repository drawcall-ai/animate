import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Behaviour } from '../core/goal';
import { Legs, type LegChain } from '../core/legs/legs';
import { strideAt } from '../core/legs/gait';
import { cycleAt, DEG } from '../core/legs/cycle';
import { follow } from '../core/follow';
import { clampRotation } from '../core/limits';
import { wrapAngle, yawOf } from '../core/math';
import { seedOf } from '../core/random';
import { TrackedPoint, TrackedRotation } from '../core/track';
import { createAsks, takeAsks, type Asks } from '../core/asks';
import { BOW, PELVIS, TURN, SETTLED, followed } from './balance/balance';
import { GOAL_VELOCITY_RATE, JUMP_SPEED, START, STOP, START_GLIDE } from './balance/carriage';
import { checkSupport } from './balance/checks';
import { Life } from './balance/life';
import { BOB, LOWER, Posture, entrain, walking, type Upright, type Trunk } from './balance/posture';
import { INDEX } from './bones';
import type { Humanoid } from './humanoid';
import { humanGait, humanLegs } from './legs';
import { defaultStance } from './stance';
import type { Stance } from '../core/asks';

/** Human posture over the shared leg controller. Temporary opt-in during migration. */
export function stride<W>(h: Humanoid<W>, options: { stance?: Partial<Stance>; seed?: number }): Behaviour<W> {
  return function* () {
    const p = h.proportions;
    const gait = humanGait(p);
    // [D] The requested 4 cm walking bob, scaled with body size.
    // Convert displacement to Posture's existing BOB units; the inherited constant is unchanged.
    // [D] Two bobs per stride, with the trough halfway through double support after contact.
    const bob = (phase: number, duty: number) => 0.04 * p.scale / (2 * BOB * p.height) * (1 - Math.cos(4 * Math.PI * (phase - (duty - 0.5) / 2)));
    const base = { ...defaultStance(p), ...options.stance };
    const chains = humanLegs(p).map((leg): LegChain => {
      // [D from C] A coordinated stride's toe-off pitch is the sum of the recalled joint angles (0 − 38 − 18 = −56°).
      const toeOff = leg.joints.reduce((sum, joint) => sum + (joint.cycle ? cycleAt(joint.cycle, joint.cycle.duty) / DEG : 0), 0);
      const flat = leg.rocker.reduce((last, [, pitch], i) => pitch === 0 ? i + 1 : last, 0);
      return { ...leg, rocker: [...leg.rocker.slice(0, flat), [1, toeOff]] };
    });
    const legs = new Legs(h.pose, chains, gait);
    const c: Upright = { p, root: h.pose.position(0).clone().setY(0), offset: new Vector3(), yaw: h.yaw, walk: 0, run: 0, moving: false,
      stance: base, feet: h.feet, pelvis: new Vector3(), pelvisRotation: new Quaternion() };
    const posture = new Posture();
    const life = new Life(options.seed ?? seedOf(p.height, h.feet[0].position.x, h.feet[0].position.z));
    const asks = createAsks();
    const trunk: Trunk = { chest: new Quaternion(), thoraxYaw: 0 };
    const asked = { lower: [0, 0], bow: [0, 0], twist: [0, 0] };
    const pelvis = new TrackedPoint(), rotation = new TrackedRotation();
    const back = [new TrackedRotation(), new TrackedRotation()];
    const tilts = [new Quaternion(), new Quaternion()];
    const landed = [10, 10];
    const offsets = [new Vector3(), new Vector3()];
    const heights = [h.pose.position(0).y, h.pose.position(0).y];
    let lastGo: Asks['go'] = null;
    const center = c.root.clone().sub(legs.root.position).setY(0), neutral = center.clone().negate();
    const stop = c.root.clone(), velocity = new Vector3(), facing = new Quaternion();
    let seen = false, starting = false, lastClock = 0, phase = 0;
    yield* action<Frame<W>>({ update: (f) => {
      if (f.dev) checkSupport(h, f, f.dev);
      const dt = f.dt;
      const go = takeAsks(h.asks, asks).go;
      const speed = h.locomotion.velocity.length();
      c.stance = asks.stance ? { ...base, ...asks.stance } : base;
      c.walk = walking(c.walk, speed, dt);
      const timing = strideAt(gait, speed, 0);
      const clock = legs.phase + timing.frequency * dt;
      phase = entrain(phase, 2 * Math.PI * (clock - timing.duty), 2 * Math.PI * (clock - lastClock) / dt, dt);
      lastClock = clock;
      const step = ((clock - timing.duty) % 0.5 + 0.5) % 0.5;
      const progress = Math.min(1, step / (1 - timing.duty));
      life.update(dt, life.quiet(asks, h), speed);
      const requested = {
        lower: followed(asked.lower, asks.lower, LOWER, dt),
        bow: followed(asked.bow, Math.min(asks.bow, asks.bowLimit), BOW, dt),
        twist: followed(asked.twist, asks.twist, BOW, dt),
      };
      posture.carry(f, c, requested, trunk, life, {
        phase: 2 * Math.PI * (clock - timing.duty),
        bob: bob(clock, timing.duty), nod: Math.cos(2 * Math.PI * progress), compression: 0,
      }, (height) => height);
      const at = pelvis.follow(offsets[0], offsets[1], c.pelvis.clone().sub(c.root).setY(0), PELVIS, dt, new Vector3()).add(c.root);
      at.y = follow(heights[0], heights[1], c.pelvis.y, PELVIS, dt);
      [heights[0], heights[1]] = [heights[1], at.y];
      f.current.setRoot(at);
      const tilt = rotation.follow(tilts[0], tilts[1], legs.root.quaternion.clone().invert().multiply(c.pelvisRotation), TURN, dt, new Quaternion());
      tilts[0].copy(tilts[1]);
      tilts[1].copy(tilt);
      f.current.setLocal(0, tilt.premultiply(legs.root.quaternion));
      const half = f.current.local(0).clone().invert().multiply(trunk.chest);
      half.slerp(new Quaternion(), 0.5);
      [INDEX.spine, INDEX.chest].forEach((bone, k) => {
        const local = half.clone(), limit = f.current.skeleton.limits[bone];
        if (limit) clampRotation(local, limit);
        f.current.setLocal(bone, back[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TURN, dt, new Quaternion()));
      });
      if (go) {
        const travel = go.to.clone().sub(stop).setY(0);
        if (go.velocity) velocity.copy(go.velocity);
        else velocity.lerp(seen && travel.length() <= JUMP_SPEED * dt ? travel.divideScalar(dt) : travel.set(0, 0, 0), 1 - Math.exp(-GOAL_VELOCITY_RATE * dt));
        stop.copy(go.to);
      } else velocity.set(0, 0, 0);
      seen = !!go;
      if (!c.moving && (c.root.distanceTo(stop) > START.distance * p.scale || velocity.length() > START.speed)) { c.moving = true; starting = true; }
      const heading = Math.atan2(stop.x - c.root.x, stop.z - c.root.z);
      const travelYaw = legs.root.velocity.lengthSq() > 1e-8 ? Math.atan2(legs.root.velocity.x, legs.root.velocity.z) : heading;
      const yaw = asks.face?.yaw ?? (c.moving ? travelYaw : c.yaw);
      facing.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      const motor = legs.root.position.clone(), inverse = legs.root.quaternion.clone().invert();
      const current = { position: f.current.position(0).clone(), quaternion: f.current.local(0).clone() };
      let forecastWalk = c.walk, forecastSpeed = 0;
      legs.toward(f, { position: (c.moving ? stop : c.root).clone().sub(center), velocity: c.moving ? velocity : new Vector3(), quaternion: asks.face || !c.moving || Math.abs(wrapAngle(heading - c.yaw)) >= Math.PI / 4 ? facing : undefined },
        { accel: go?.accel ?? 1.2 * p.scale, speed: c.moving ? Math.min(go?.speed ?? 1.3 * p.scale, starting ? START_GLIDE * p.scale : Infinity) : 0, turnSpeed: asks.face?.rate },
        (root, phase, time) => {
          if (time <= f.time) { forecastWalk = c.walk; forecastSpeed = root.velocity.length(); return { position: root.position.clone().sub(motor).add(current.position), quaternion: root.quaternion.clone().multiply(inverse).multiply(current.quaternion) }; }
          forecastWalk = walking(forecastWalk, forecastSpeed, dt); forecastSpeed = root.velocity.length();
          const t = strideAt(gait, root.velocity.length(), 0);
          const future: Upright = { ...c, offset: neutral, walk: forecastWalk, root: root.position.clone().add(center).setY(0), yaw: yawOf(root.quaternion), pelvis: new Vector3(), pelvisRotation: new Quaternion() };
          const step = ((phase - t.duty) % 0.5 + 0.5) % 0.5, progress = Math.min(1, step / (1 - t.duty));
          posture.forecast().carry({ prev: f.prev, dt: 0 }, future, requested, { chest: new Quaternion(), thoraxYaw: 0 }, life,
            { phase: 2 * Math.PI * (phase - t.duty), bob: bob(phase, t.duty), nod: Math.cos(2 * Math.PI * progress), compression: 0 },
            (height) => height);
          return { position: future.pelvis, quaternion: future.pelvisRotation };
        });
      if (legs.events.some((event) => event.type === 'land')) starting = false;
      h.locomotion.velocity.copy(legs.root.velocity);
      c.yaw = yawOf(legs.root.quaternion);
      c.root.copy(legs.root.position).add(center).setY(0);
      offsets[0].copy(offsets[1]);
      offsets[1].copy(f.current.position(0)).sub(c.root).setY(0);
      if (c.root.distanceTo(stop) < STOP.distance * p.scale && h.locomotion.velocity.length() < STOP.speed && velocity.length() < STOP.goalSpeed) c.moving = false;
      legs.legs.forEach((leg, s) => {
        const foot = h.feet[s];
        foot.position.copy(leg.foothold.position);
        foot.yaw = leg.foothold.yaw;
        foot.phase = leg.planted ? 'planted' : 'swing';
        landed[s] = leg.planted ? landed[s] + dt : 0;
      });
      const g = h.locomotion;
      [g.phase, g.walk, g.run, g.facing, g.moving, g.thoraxYaw] = [phase, c.walk, 0, c.yaw, c.moving, trunk.thoraxYaw];
      g.facingAhead = yawOf(legs.facingAhead);
      g.planted = go === lastGo && !c.moving && legs.legs.every((leg) => leg.planted) ? g.planted + dt : 0;
      lastGo = go;
      g.settled = !c.moving && Math.abs(wrapAngle(yaw - c.yaw)) < STOP.yaw && legs.settled && landed.every((time) => time > SETTLED);
      g.quiet.copy(posture.quiet);
    } });
  };
}
