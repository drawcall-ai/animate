import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { follow } from '../../core/follow';
import type { Behaviour } from '../../core/goal';
import { clampRotation } from '../../core/limits';
import { TrackedPoint, TrackedRotation } from '../../core/track';
import { createAsks, takeAsks } from '../asks';
import { INDEX, SIDES } from '../bones';
import type { Humanoid } from '../humanoid';
import { yawOf } from '../rig';
import { defaultStance, type Stance } from '../stance';
import { Carriage } from './carriage';
import { checkFeet, plantedPitch, plantedPose, solveLeg, swingPose, type FootPose } from './legs';
import { Posture, type Trunk } from './posture';
import { stepFeet } from './steps';
import { footprint } from './foot';
import { hullOf, outside } from './support';


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
  /** seconds until the walk now running arrives; Infinity when no walk is running; published by walkTo */
  eta: number;
  /** a walk is under way */
  moving: boolean;
  /** come to rest: no walk under way, both feet planted a while and none wanting to step */
  settled: boolean;
  /** the thorax's rotation with the stride (rad, + to the left) */
  thoraxYaw: number;
}

export const createGait = (facing: number): Gait => ({ eta: Infinity, phase: 0, walk: 0, run: 0, facing, velocity: new Vector3(), moving: false, settled: true, thoraxYaw: 0 });

/** how fast `lower` (m/s², m/s) and `bow` (rad/s², rad/s) are taken up and given back: a squat's pace */
const LOWER = { accel: 3, speed: 0.6 };
const BOW = { accel: 6, speed: 1.2 };
/** how fast the pelvis (m/s²) and the trunk's joints (rad/s²) may change their motion: the gait's own oscillations, braked only at their kinks */
const PELVIS = { accel: 30 };
const TURN = { accel: 60 };
/** how fast a planted foot rolls (rad/s², rad/s) */
const ROLL = { accel: 300, speed: 8 };
/** let down or up this far (m, default body), the feet stay put but to catch a fall */
const LOWERED = 0.02;
/** how long both feet stand before the body has settled (s): a squaring step comes before */
const SETTLED = 0.4;

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
    const asked = { lower: [0, 0], bow: [0, 0] };
    // (the pelvis followed along the floor and up apart: the legs' reach moving it up and down does not hold back its sway)
    const pelvis = { along: new TrackedPoint(), up: new TrackedPoint(), rotation: new TrackedRotation(), trunk: [new TrackedRotation(), new TrackedRotation()] };
    const feet: [FootPose, FootPose] = [footPose(), footPose()];
    let started = false;
    yield* action<Frame<W>>({
      update: (f) => {
        if (f.dev) {
          checkFeet(h, f);
          checkSupport(h, f);
        }
        const dt = f.dt;
        takeAsks(h.asks, asks);
        if (asks.lean || asks.onto || asks.taken[0] || asks.taken[1]) throw new Error('balance takes no lean, onto or taken feet yet');
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
        c.update(dt, xcom, c.over(_over));
        const stepped = stepFeet(f, c, xcom);

        // the pelvis and the trunk over the feet, lowered and bowed as asked
        const lower = followed(asked.lower, asks.lower, LOWER, dt);
        c.lowered = Math.abs(lower) > LOWERED * p.scale;
        const bow = followed(asked.bow, asks.bow, BOW, dt);
        posture.carry(f, c, lower, bow, trunk);
        const at = pelvis.along.follow(_a.copy(f.prev2.position(0)).setY(0), _b.copy(f.prev.position(0)).setY(0), _g.copy(c.pelvis).setY(0), PELVIS, dt, _at);
        const up = pelvis.up.follow(_a.set(0, f.prev2.position(0).y, 0), _b.set(0, f.prev.position(0).y, 0), _g.set(0, c.pelvis.y, 0), PELVIS, dt, _up);
        c.pelvis.copy(at).setY(up.y);
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
          else plantedPose(p, side, h.feet[s], followed(st.roll, plantedPitch(f, c, s), ROLL, dt), pose);
          solveLeg(f, c, side, pose);
        });

        const g = h.gait;
        [g.phase, g.walk, g.run, g.facing, g.moving, g.thoraxYaw] = [posture.phase, c.walk, c.run, c.yaw, c.moving, trunk.thoraxYaw];
        g.settled = !c.moving && !stepped && c.steps.every((st) => !st.swing && st.plantedTime > SETTLED);
        g.velocity.copy(c.velocity);
      },
    });
  };
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
const _a = new Vector3();
const _b = new Vector3();
const _g = new Vector3();
const _at = new Vector3();
const _up = new Vector3();
const _half = new Quaternion();
const _q = new Quaternion();
const _local = new Quaternion();

/** XCoM from the final pose; the support includes a swing's committed landing (Hof's next-step capture). */
function checkSupport<W>(h: Humanoid<W>, f: Frame<W>): void {
  if (!f.dev || f.time <= f.dt) return;
  const com = f.prev.com(new Vector3());
  const velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = com.addScaledVector(velocity, 1 / Math.sqrt(9.81 / h.proportions.legLength));
  const support = h.feet.flatMap((foot, s) => {
    if (foot.phase === 'swing') return footprint(h.proportions, foot.position, foot.yaw);
    const side = SIDES[s];
    return (['Heel', 'BigToe', 'SmallToe'] as const).map((name): [number, number] => {
      const point = h.rig.points[`${side}${name}`];
      const at = f.prev.point(point.bone, point.at, new Vector3());
      return [at.x, at.z];
    });
  });
  const value = outside(hullOf(support), xcom);
  if (value > 0.1) f.dev.append(f.time - f.dt, { check: 'XCoM outside support (m)', value, limit: 0.1, where: 'hips' });
}
