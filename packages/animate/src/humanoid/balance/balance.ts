import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { follow } from '../../core/follow';
import type { Behaviour } from '../../core/goal';
import { clampRotation } from '../../core/limits';
import { TrackedPoint, TrackedRotation } from '../../core/track';
import { createAsks, takeAsks, type Asks, type Stance } from '../../core/asks';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { forwardOf, smoothstep, softMin, yawOf } from '../../core/math';
import { defaultStance, OVER_ANKLES } from '../stance';
import { seedOf } from '../../core/random';
import { Life } from './life';
import { Carriage } from './carriage';
import { pelvisHeight, rollFoot, plantedPose, solveLeg, swingPose, type FootPose } from './legs';
import { LOWER, Posture, reachLimit, TIPTOE, type Trunk } from './posture';
import { stepFeet } from './steps';
import { checkFeet, checkSupport } from './checks';



/** how fast `lower` (m/s², m/s) and `bow` (rad/s², rad/s) are taken up and given back: a squat's pace */
export const BOW = { accel: 6, speed: 1.2 };
/** how fast the pelvis (m/s²) and the trunk's joints (rad/s²) may change their motion: the gait's own oscillations, braked only at their kinks */
export const PELVIS = { accel: 30 };
export const TURN = { accel: 60 };
/** let down or up this far (m, default body), the feet stay put but to catch a fall */
const LOWERED = 0.02;
/** how long both feet stand before the body has settled (s): a squaring step comes before */
export const SETTLED = 0.4;

/**
 * Standing and walking: the body's root, legs and trunk posture, endless. It keeps the
 * extrapolated centre of mass over the feet (a step to catch it when it leaves them), walks or
 * turns where `h.asks` asks (`go`, `face`), lets the pelvis down and bows the trunk as asked
 * (`lower`, `bow`), stands in `stance` (and `asks.stance` over it); the pelvis bobs, sways and
 * lists with the steps, the thorax counter-rotates, the trunk nods; the feet strike with the heel,
 * roll and push off; arriving it squares the feet into the stance. It reads and clears `h.asks` at
 * the start of every sub-step, and writes `h.feet` and `h.locomotion`. Put it first: it writes the root.
 */
export function balance(h: Humanoid, options: { stance?: Partial<Stance>; seed?: number } = {}): Behaviour {
  return function* () {
    const p = h.proportions;
    const base: Stance = { ...defaultStance(p), ...options.stance };
    const c = new Carriage(p, base, h.feet);
    const posture = new Posture();
    const life = new Life(options.seed ?? seedOf(p.height, h.feet[0].position.x, h.feet[0].position.z));
    const asks = createAsks();
    const quiet: { drift: Vector3; breath: number; onto: Side | null } = { drift: new Vector3(), breath: 0, onto: null };
    const trunk: Trunk = { chest: new Quaternion(), thoraxYaw: 0 };
    const asked = { lower: [0, 0], bow: [0, 0], twist: [0, 0] };
    // (the pelvis followed along the floor and up apart: the legs' reach moving it up and down does not hold back its sway)
    const pelvis = { along: new TrackedPoint(), rotation: new TrackedRotation(), trunk: [new TrackedRotation(), new TrackedRotation()] };
    const feet: [FootPose, FootPose] = [footPose(), footPose()];
    let started = false;
    let lastGo: Asks['go'] = null;
    yield* action<Frame>({
      update: (f) => {
        if (f.dev) {
          checkFeet(h, f, f.dev, c.steps);
          checkSupport(h, f, f.dev);
        }
        const dt = f.dt;
        takeAsks(h.asks, asks);
        c.stance = asks.stance ? { ...base, ...asks.stance } : base;
        if (!started) {
          started = true;
          c.reset(f.prev.com(_com), yawOf(f.prev.local(0)) - c.stance.blade);
          c.pelvis.copy(f.prev.position(0));
          c.pelvisRotation.copy(f.prev.local(0));
        }
        // the root on toward what is asked, the feet stepping under it: the extrapolated centre of mass (Hof) as the body last was
        const com = f.prev.com(_com);
        const xcom = _xcom.subVectors(com, f.prev2.com(_v)).divideScalar(dt).divideScalar(c.omega).add(com).setY(0);
        const go = asks.go;
        if (go) [c.maxSpeed, c.accel, c.plant] = [go.speed, go.accel, go.plant ?? true];
        c.turnSpeed = asks.face?.rate;
        c.aim(go?.to ?? null, go?.velocity ?? null, asks.face?.yaw ?? null, dt);
        const over = c.over(_over);
        const toes = (p.offsets.leftToes.z + p.offsets.rightToes.z) / 2;
        over.addScaledVector(forwardOf(c.yaw, _v), (toes - OVER_ANKLES * p.scale) * smoothstep(0, TIPTOE * p.scale, -asked.lower[1]));
        c.update(dt, xcom, over);
        const stepped = stepFeet(f, c, xcom);

        // the pelvis and the trunk over the feet, lowered and bowed as asked
        const lower = followed(asked.lower, asks.lower, LOWER, dt);
        c.lowered = Math.abs(lower) > LOWERED * p.scale;
        const bow = followed(asked.bow, Math.min(asks.bow, asks.bowLimit), BOW, dt);
        // Motion blends quiet stance out; a stationary load retains breathing and sway.
        const speed = Math.max(c.speed, ...[INDEX.leftHand, INDEX.rightHand].map((tip) =>
          f.prev.position(tip).distanceTo(f.prev2.position(tip)) / dt));
        life.update(dt, life.quiet(asks, h), speed);
        const twist = followed(asked.twist, asks.twist, BOW, dt);
        quiet.drift.copy(life.drift);
        quiet.breath = life.breath;
        quiet.onto = asks.onto ?? life.onto;
        c.offset.copy(posture.center(f));
        posture.carry(f, c, { lower, bow, twist }, trunk, quiet, posture.cycle(c, dt), (standing, floor, tiptoe) => softMin(standing, reachLimit(c, floor, tiptoe), 0.015));
        const at = pelvis.along.follow(_a.copy(f.prev2.position(0)).setY(0), _b.copy(f.prev.position(0)).setY(0), _g.copy(c.pelvis).setY(0), PELVIS, dt, _at);
        const up = follow(f.prev2.position(0).y, f.prev.position(0).y, c.pelvis.y, PELVIS, dt);
        c.pelvis.copy(at).setY(up);
        pelvis.rotation.follow(f.prev2.local(0), f.prev.local(0), c.pelvisRotation, TURN, dt, c.pelvisRotation);
        f.current.setRoot(c.pelvis);
        f.current.setLocal(0, c.pelvisRotation);
        // (the lower back and the thorax each take half the turn from the pelvis to the chest)
        const half = _half.identity().slerp(_q.copy(c.pelvisRotation).invert().multiply(trunk.chest), 0.5);
        TRUNK.forEach((bone, k) => {
          const local = _local.copy(half);
          const limit = f.current.skeleton.limits[bone];
          if (limit) clampRotation(local, limit);
          f.current.setLocal(bone, pelvis.trunk[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TURN, dt, _q));
        });

        // the legs down to the feet
        SIDES.forEach((side, s) => {
          const st = c.steps[s];
          const pose = feet[s];
          if (st.swing) swingPose(f, c, s, pose);
          else plantedPose(p, side, h.feet[s], rollFoot(f, c, s), pose);
        });
        const height = pelvisHeight(f, c, feet);
        const adjusted = height !== c.pelvis.y;
        c.pelvis.y = height;
        f.current.setRoot(c.pelvis);
        // The free ankle was relaxed against the shank before the pelvis reach correction.
        // Recompute it on the corrected hip, rather than carrying a sideways foot into the final solve.
        if (adjusted) SIDES.forEach((_, s) => { if (c.steps[s].swing) swingPose(f, c, s, feet[s]); });
        SIDES.forEach((side, s) => solveLeg(f, c, side, feet[s]));

        const g = h.locomotion;
        [g.phase, g.walk, g.run, g.facing, g.moving, g.thoraxYaw] = [posture.phase, c.walk, c.run, c.yaw, c.moving, trunk.thoraxYaw];
        g.planted = go === lastGo && !c.moving && c.steps.every((st) => !st.swing) ? g.planted + f.dt : 0;
        lastGo = go;
        g.settled = !c.moving && !stepped && c.steps.every((st) => !st.swing && st.plantedTime > SETTLED);
        g.velocity.copy(c.velocity);
        g.quiet.copy(posture.quiet);
      },
    });
  };
}

/** a scalar followed to `goal` from its history (`[prev2, prev]`, shifted on) */
export function followed(history: number[], goal: number, motion: { accel: number; speed: number }, dt: number): number {
  const next = follow(history[0], history[1], goal, motion, dt);
  [history[0], history[1]] = [history[1], next];
  return next;
}

const footPose = (): FootPose => ({ ankle: new Vector3(), foot: new Quaternion(), toes: new Quaternion() });
const TRUNK = [INDEX.spine, INDEX.chest];

const _com = new Vector3();
const _xcom = new Vector3();
const _v = new Vector3();
const _over = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _g = new Vector3();
const _at = new Vector3();
const _half = new Quaternion();
const _q = new Quaternion();
const _local = new Quaternion();
