import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { follow, followRotation } from '../../core/follow';
import type { Behaviour } from '../../core/goal';
import { clampRotation } from '../../core/limits';
import { spinOf } from '../../core/rotation';
import { createAsks, takeAsks } from '../asks';
import { INDEX, SIDES } from '../bones';
import { smoothstep, wrapAngle } from '../math';
import type { Humanoid } from '../humanoid';
import { yawOf } from '../rig';
import { defaultStance, type Stance } from '../stance';
import { Carriage } from './carriage';
import { liftOff, plantedPitch, plantedPose, shankTilt, solveLeg, swingPose, type FootPose } from './legs';
import { Posture, type Trunk } from './posture';
import { landing, nextStep } from './steps';
import { leadTime } from './timing';

/** What `balance` reports of the walk it carries the body on (its output: read it, never write it). */
export interface Gait {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase: number;
  /** 0 standing … 1 walking, 0 walking … 1 running */
  walk: number;
  run: number;
  /** the facing it walks with (rad, about +Y) and its ground velocity (m/s) */
  facing: number;
  velocity: Vector3;
  /** a walk is under way */
  moving: boolean;
  /** come to rest: no walk under way, both feet planted a while and none wanting to step */
  settled: boolean;
  /** the thorax's rotation with the stride (rad, + to the left) */
  thoraxYaw: number;
}

export const createGait = (facing: number): Gait => ({ phase: 0, walk: 0, run: 0, facing, velocity: new Vector3(), moving: false, settled: true, thoraxYaw: 0 });

/** how fast `lower` (m/s², m/s) and `bow` (rad/s², rad/s) are taken up and given back: a squat's pace */
const LOWER = { accel: 3, speed: 0.6 };
const BOW = { accel: 6, speed: 1.2 };
/** how fast the pelvis (m/s²) and the trunk's joints (rad/s²) may change their motion: the gait's own oscillations, braked only at their kinks */
const PELVIS = { accel: 30 };
const TURN = { accel: 60 };
/** how fast a planted foot rolls (rad/s², rad/s) */
const ROLL = { accel: 300, speed: 8 };
/** how quickly a swinging foot's landing is fine-tuned (1/s), until this share of its swing on (then it stays) */
const ADAPT = { rate: 20, until: [0.4, 0.75] as const };
/** let down or up this far (m, default body), the feet stay put but to catch a fall */
const LOWERED = 0.02;
/** how long both feet stand before the body has settled (s): a squaring step comes before */
const SETTLED = 0.4;
/** how far the ankle flexes up (rad): a heel strike lands no more toes-up than this under the shank */
const DORSIFLEXION = (40 * Math.PI) / 180;

/**
 * Standing and walking: the body's root, legs and trunk posture, endless. It keeps the
 * extrapolated centre of mass over the feet (a step to catch it when it leaves them), walks or
 * turns where `h.asks` asks (`go`, `face`), lets the pelvis down and bows the trunk as asked
 * (`lower`, `bow`), stands in `stance` (and `asks.stance` over it); the pelvis bobs, sways and
 * lists with the steps, the thorax counter-rotates, the trunk nods; the feet strike with the heel,
 * roll and push off; arriving it squares the feet into the stance. It reads and clears `h.asks` at
 * the start of every sub-step, and writes `h.feet` and `h.gait`. Put it first: it writes the root.
 */
export function balance<W>(h: Humanoid<W>, options: { stance?: Partial<Stance> } = {}): Behaviour<W> {
  return function* () {
    const p = h.proportions;
    const base: Stance = { ...defaultStance(p), ...options.stance };
    const c = new Carriage(p, base, h.feet);
    const posture = new Posture();
    const asks = createAsks();
    const trunk: Trunk = { chest: new Quaternion(), thoraxYaw: 0 };
    const history = { lower: [0, 0], bow: [0, 0], pitch: [0, 0, 0, 0] };
    const goal = { pelvis: new Vector3(), rotation: new Quaternion(), trunk: [new Quaternion(), new Quaternion()] };
    const feet: [FootPose, FootPose] = [footPose(), footPose()];
    let started = false;
    yield* action<Frame<W>>({
      update: (f) => {
        const dt = f.dt;
        takeAsks(h.asks, asks);
        if (asks.lean || asks.onto || asks.taken[0] || asks.taken[1]) throw new Error('balance takes no lean, onto or taken feet yet');
        c.stance = asks.stance ? { ...base, ...asks.stance } : base;
        if (!started) {
          started = true;
          c.reset(f.prev.com(_com), yawOf(f.prev.local(0)) - c.stance.blade);
          c.pelvis.copy(f.prev.position(0));
          c.pelvisRotation.copy(f.prev.local(0));
          goal.pelvis.copy(c.pelvis);
          goal.rotation.copy(c.pelvisRotation);
          TRUNK.forEach((bone, k) => goal.trunk[k].copy(f.prev.local(bone)));
        }
        // the extrapolated centre of mass (Hof), as the body last was
        const com = f.prev.com(_com);
        const xcom = _xcom.subVectors(com, f.prev2.com(_v)).divideScalar(dt).divideScalar(c.omega).add(com).setY(0);
        const go = asks.go;
        if (go) [c.maxSpeed, c.accel, c.plant] = [go.speed, go.accel, go.plant ?? true];
        c.turnSpeed = asks.face?.rate;
        c.aim(go?.to ?? null, go?.velocity ?? null, asks.face?.yaw ?? null, dt);
        c.update(dt, xcom, c.over(_over));
        swing(f, c, xcom, history.pitch);
        const lift = nextStep(c, xcom, dt);
        if (lift) {
          const st = c.steps[lift.s];
          const foot = h.feet[lift.s];
          const fromYaw = foot.yaw;
          const { yaw } = landing(c, lift.s, c.moving ? leadTime(c.timing(), lift.duration) : 0, lift.duration, xcom, foot.position);
          foot.yaw = yaw;
          foot.phase = 'swing';
          st.swing = liftOff(f, st.side, fromYaw, foot.position, c.hip(st.side, _v), c.velocity, lift);
          c.lastLift = lift.s;
          c.lastLiftAt = c.clock;
        }

        // the pelvis and the trunk over the feet, lowered and bowed as asked
        const lower = followed(history.lower, asks.lower, LOWER, dt);
        c.lowered = Math.abs(lower) > LOWERED * p.scale;
        const bow = followed(history.bow, asks.bow, BOW, dt);
        posture.carry(f, c, lower, bow, trunk);
        // (along the floor and up apart: the legs' reach moving the pelvis up and down does not hold back its sway)
        const velocity = _v.subVectors(c.pelvis, goal.pelvis).divideScalar(dt);
        const pelvis = follow(_a.copy(f.prev2.position(0)).setY(0), _b.copy(f.prev.position(0)).setY(0), _g.copy(c.pelvis).setY(0), { ...PELVIS, velocity: _w.copy(velocity).setY(0) }, dt, _pelvis);
        pelvis.y = follow(f.prev2.position(0).y, f.prev.position(0).y, c.pelvis.y, { ...PELVIS, velocity: velocity.y }, dt);
        const rotation = followRotation(f.prev2.local(0), f.prev.local(0), c.pelvisRotation, { ...TURN, velocity: spinOf(goal.rotation, c.pelvisRotation, dt, _v) }, dt, _rotation);
        goal.pelvis.copy(c.pelvis);
        goal.rotation.copy(c.pelvisRotation);
        f.current.setRoot(pelvis);
        f.current.setLocal(0, rotation);
        c.pelvis.copy(pelvis);
        c.pelvisRotation.copy(rotation);
        // (the lower back and the thorax each take half the turn from the pelvis to the chest)
        const half = _half.identity().slerp(_q.copy(rotation).invert().multiply(trunk.chest), 0.5);
        TRUNK.forEach((bone, k) => {
          const local = _local.copy(half);
          const limit = f.current.skeleton.limits[bone];
          if (limit) clampRotation(local, limit);
          const velocity = spinOf(goal.trunk[k], local, dt, _v);
          goal.trunk[k].copy(local);
          f.current.setLocal(bone, followRotation(f.prev2.local(bone), f.prev.local(bone), local, { ...TURN, velocity }, dt, _q));
        });

        // the legs down to the feet
        SIDES.forEach((side, s) => {
          const st = c.steps[s];
          const pose = feet[s];
          if (st.swing) swingPose(f, c, s, pose);
          else {
            const pitch = follow(history.pitch[2 * s], history.pitch[2 * s + 1], plantedPitch(f, c, s), ROLL, dt);
            [history.pitch[2 * s], history.pitch[2 * s + 1]] = [history.pitch[2 * s + 1], pitch];
            plantedPose(p, side, h.feet[s], pitch, pose);
          }
          solveLeg(f, c, side, pose);
        });

        const g = h.gait;
        [g.phase, g.walk, g.run, g.facing, g.moving, g.thoraxYaw] = [posture.phase, c.walk, c.run, c.yaw, c.moving, trunk.thoraxYaw];
        g.settled = !c.moving && !lift && c.steps.every((st) => st.plantedTime > SETTLED);
        g.velocity.copy(c.velocity);
      },
    });
  };
}

/**
 * the swinging feet one sub-step on: each landing fine-tuned through the first part of its swing
 * (a landing that moves later reads as a stumble), and put down at its end
 */
function swing(f: Frame<unknown>, c: Carriage, xcom: Readonly<Vector3>, pitch: number[]) {
  c.steps.forEach((st, s) => {
    const w = st.swing;
    if (!w) return;
    const foot = c.feet[s];
    w.progress = Math.min(1, w.progress + f.dt / w.duration);
    if (w.progress >= 1) {
      foot.phase = 'planted';
      st.swing = null;
      st.plantedTime = 0;
      // (as the swing ended: no more toes-up than the ankle flexes under the shank)
      st.landPitch = Math.min(w.strike, DORSIFLEXION - shankTilt(f.prev, st.side, foot.yaw));
      pitch[2 * s] = pitch[2 * s + 1] = st.landPitch;
      c.lastLanded = s;
      return;
    }
    const adapt = 1 - smoothstep(ADAPT.until[0], ADAPT.until[1], w.progress);
    if (adapt <= 0) return;
    const left = (1 - w.progress) * w.duration;
    const { yaw } = landing(c, s, c.moving ? leadTime(c.timing(), left) : 0, left, xcom, _to);
    const k = adapt * Math.min(1, f.dt * ADAPT.rate);
    foot.position.lerp(_to, k);
    foot.yaw += wrapAngle(yaw - foot.yaw) * k;
  });
}

/** a scalar followed to `goal` from its history (`[prev2, prev]`, shifted on) */
function followed(history: number[], goal: number, motion: { accel: number; speed: number }, dt: number): number {
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
const _to = new Vector3();
const _pelvis = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _g = new Vector3();
const _w = new Vector3();
const _rotation = new Quaternion();
const _half = new Quaternion();
const _q = new Quaternion();
const _local = new Quaternion();
