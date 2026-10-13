import { Vector3 } from 'three';
import { action, parallel, type ReusableTimeline, type UntilCondition } from '@pmndrs/timeline';
import type { Ctx } from '../../core/body';
import { SIDES } from '../bones';
import { Gait } from '../gait/gait';
import { Posture } from '../gait/posture';
import { plantedPitch } from '../gait/roll';
import { leadTime } from '../gait/timing';
import { landing, nextStep, type Lift } from '../gait/trigger';
import type { Humanoid } from '../humanoid';
import { lerp, Spring } from '../math';
import { GAIT_ROOT, legCaps, rootCap, RUNNING, STEPPING } from '../profile/caps';
import { plant, type Leg } from '../procedures/footing';
import { step } from '../procedures/step';
import { yawOf } from '../rig';
import { xcomOf } from './humanoid';

export interface WalkOptions<W> {
  /** where to go, on the floor: asked every frame (a moving goal is followed, its speed fed forward) */
  to: (ctx: Ctx<W>) => Readonly<Vector3>;
  /** the facing to arrive with (default, and null: the way it arrives) */
  facing?: (ctx: Ctx<W>) => number | null;
  /** the top speed (m/s; default 1.3) and how quickly it speeds up (m/s²; default 1.2) */
  speed?: number;
  accel?: number;
  /** follows the goal closely, setting off and stopping on small offsets (a tracked body part walks) */
  eager?: boolean;
  /** keeps `facing` while going, side-stepping and stepping back, instead of facing the way it goes (default false) */
  strafe?: boolean;
  /** stops: once met, the walk comes to rest where it is, then ends */
  until?: UntilCondition<Ctx<W>>;
}

/** the walk's facing beats the stand's (its feet's) */
const FACING = 1;
/** the walk's contacts beat the stand's */
const PRIORITY = 2;
const OWNER = 'walk';
/** how quickly a planted foot rolls to its pitch (1/s) */
const ROLL_RATE = 60;
/** the legs' elite caps: walking asks for a share (`STEPPING`) of them, running for more (`RUNNING`) */
const LEG_CAPS = legCaps(1);
/** the body as a whole, carried by a walk's or run's legs: its landings and bounce */
const ROOT_CAP = rootCap(GAIT_ROOT);

/**
 * Walking (and, fast, running) to a goal: the root goes there — setting off, speeding up,
 * braking to arrive, turning to face the way it goes — the feet step to stay under it (each
 * foot a loop of stance and step), the body is posed over them. Everything that must stay in
 * step lives here: the stepping, the feet's roll, the pelvis's bob and sway, the trunk's
 * counter-rotation, the arms' swing.
 */
export function walk<W>(h: Humanoid<W>, options: WalkOptions<W>): ReusableTimeline<Ctx<W>> {
  return function* () {
    const p = h.proportions;
    const g = new Gait(p, h.status.stance, h.status.feet, options.speed ?? 1.3, options.accel ?? 1.2);
    g.eager = options.eager ?? false;
    g.strafe = options.strafe ?? false;
    const posture = new Posture(h);
    const xcom = new Vector3();
    const pitch = [new Spring(), new Spring()];
    /** the step each foot is to take now, as the body decided it this frame */
    const lifts: [Lift | null, Lift | null] = [null, null];
    let started = false;
    let stopping = false;
    /** where it comes to rest, once stopping, and facing which way (the root as it was then: aiming at the moving root, the walk would carry on at its speed) */
    const rest = new Vector3();
    let restYaw = 0;

    const body = action<Ctx<W>>({
      update: (ctx, clock, time) => {
        if (!started) {
          started = true;
          // (facing as the pelvis does: a pelvis turned over its feet is not snapped back to them)
          g.reset(ctx.body.com, yawOf(ctx.body.rotations[0]) - h.status.stance.blade);
          g.pelvis.copy(ctx.body.positions[0]);
          g.pelvisRotation.copy(ctx.body.rotations[0]);
        }
        if (!stopping && options.until?.(ctx, clock, time)) {
          stopping = true;
          rest.copy(g.root);
          restYaw = g.yaw;
        }
        g.aim(stopping ? rest : options.to(ctx), stopping ? restYaw : (options.facing?.(ctx) ?? null), ctx.dt);
        xcomOf(ctx, h, xcom);
        g.update(ctx.dt, xcom);
        g.feet.forEach((f) => f.swinging && (f.progress = Math.min(1, f.progress + ctx.dt / f.duration)));
        const lift = nextStep(g, xcom, ctx.dt);
        if (lift) {
          const f = g.feet[lift.s];
          g.lastLift = lift.s;
          g.lastLiftAt = g.clock;
          f.from.copy(h.status.feet[lift.s].position);
          f.fromYaw = h.status.feet[lift.s].yaw;
          Object.assign(f, { swinging: true, duration: lift.duration, progress: 0, landPitch: lift.strike });
          lifts[lift.s] = lift;
        }
        posture.propose(ctx, g);
        for (const c of LEG_CAPS) ctx.propose.cap({ bone: c.bone, acceleration: c.acceleration * lerp(STEPPING, RUNNING, g.run) });
        ctx.propose.cap(ROOT_CAP);
        h.hints.facing(ctx.time, g.yaw, FACING);
        // (at rest, the walk is over)
        return !(stopping && !g.moving && !lift && g.feet.every((f) => !f.swinging));
      },
    });

    const foot = (s: number): ReusableTimeline<Ctx<W>> =>
      function* () {
        const side = SIDES[s];
        const f = g.feet[s];
        const at = new Vector3();
        const leg = (): Leg => ({ pelvis: g.pelvisRotation, hip: g.hip(side, at), facing: g.yaw });
        for (;;) {
          yield* action<Ctx<W>>({
            until: () => lifts[s] !== null,
            update: (ctx) => {
              const roll = pitch[s].step(plantedPitch(ctx, g, s), ROLL_RATE, ctx.dt);
              plant(ctx, h, side, roll, leg(), { priority: PRIORITY, owner: OWNER });
            },
          });
          const lift = lifts[s];
          lifts[s] = null;
          if (!lift) throw new Error(`the ${side} foot left its stance without a step`);
          const { duration, lift: rise, strike } = lift;
          const out = new Vector3();
          const landed = yield* step(h, side, {
            to: () => {
              const left = (1 - f.progress) * f.duration;
              const { yaw } = landing(g, s, g.moving ? leadTime(g.timing(), left) : 0, left, xcom, out);
              return { position: out, yaw };
            },
            duration,
            lift: rise,
            strike,
            run: g.run,
            leg,
            hold: { priority: PRIORITY, owner: OWNER },
          });
          if (!landed) throw new Error(`the walk lost the ${side} foot mid-step`);
          f.swinging = false;
          f.plantedTime = 0;
          pitch[s].reset(strike);
          g.lastLanded = s;
        }
      };

    yield* parallel<Ctx<W>>('race', body, foot(0), foot(1));
  };
}
