import { forwardOf, leftOf, wrapAngle } from '@drawcall/animate';
import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { comOf } from './com';
import { Peak, type Frame, type Actor } from './frame';


/** Foot geometry regressions that a joint-local range check cannot express. */
export class Feet {
  hyper = 0;
  crossings = 0;
  /** the most a planted foothold (its flat-foot ankle) is out of the leg's reach (m): the foot dangles off it */
  readonly reach = new Peak();
  /**
   * the ankle's angle between the shank (knee → ankle) and the foot (ankle → ball) (°): ~120
   * standing; smaller pointed (plantarflexed), larger flexed up (dorsiflexed)
   */
  readonly ankle = { min: new Peak(), max: new Peak() };
  see({ t, h }: Frame) {
    for (const s of ['left', 'right'] as const) {
      const hip = jointOf(h, `${s}UpperLeg`);
      const knee = jointOf(h, `${s}LowerLeg`);
      const ankle = jointOf(h, `${s}Foot`);
      // the knee behind the hip–ankle line: its front is where the knee's hinge (across the
      // foot) turns the leg — the toes' way for a standing leg, up for one raised forward, down
      // for one drawn back (whose pointed toes point back: the hinge is across the body's facing)
      const toes = jointOf(h, `${s}BigToe`).sub(jointOf(h, `${s}Heel`)).setY(0);
      if (toes.dot(forwardOf(h.locomotion.facing)) < 0) toes.negate();
      const hinge = new Vector3(0, 1, 0).cross(toes).normalize();
      const front = ankle.clone().sub(hip).cross(hinge).normalize();
      if (knee.clone().sub(hip.clone().lerp(ankle, 0.5)).dot(front) < -0.02) this.hyper++;
      const a = (ankle.clone().sub(knee).angleTo(jointOf(h, `${s}Toes`).sub(ankle)) * 180) / Math.PI;
      this.ankle.max.see(a, t);
      this.ankle.min.see(180 - a, t);
    }
    h.feet.forEach((f, s) => {
      if (f.phase === 'planted') this.reach.see(jointOf(h, s === 0 ? 'leftUpperLeg' : 'rightUpperLeg').distanceTo(f.position) - h.proportions.legLength, t);
    });
    if (jointOf(h, 'leftFoot').sub(jointOf(h, 'rightFoot')).dot(leftOf(h.locomotion.facing)) < 0.02) this.crossings++;
  }

  toString() {
    return `planted foothold out of reach ${this.reach}, knee-backward frames ${this.hyper}, ankle ${(180 - this.ankle.min.value).toFixed(0)}° (@${this.ankle.min.at.toFixed(2)}s) … ${this.ankle.max.value.toFixed(0)}° (@${this.ankle.max.at.toFixed(2)}s), leg-crossing frames ${this.crossings}`;
  }
}

/** the latest 40% of a swing: where the foot lands is settled by then (m) */
const LATE = 0.6;
/** below this speed (m/s) a step is a slow one: stopping, turning, standing */
const SLOW = 0.6;
/** a slow step turns (rad: the body's facing over its swing, or the foot against the other) or side-steps (its way's share across the
 * facing: 30° off it or more) beyond these */
const TURNED = 0.26, ACROSS = 0.5;

/** how far apart sideways the feet may land, slow (× height), by the step's kind (`Landings.wide`) */
export const SLOW_WIDTH = {
  /** stopping or standing straight: a quiet stance is narrower (decided 2026-10-21 as the user's bound) */
  straight: 0.15,
  /**
   * turning: read (Xu et al. 2022, J Biomech, "Frontal plane balance during pre-planned and late-cued 90 degree turns while walking",
   * PMC10722562, Table 1): the widest stride of a 90° turn 0.28 m (IQR 0.24–0.33) pre-planned, up to 0.34 m late-cued, for 1.79 m
   * walkers — 0.19 H at the top of either (straight walking's widest 0.13 m, 0.07 H)
   */
  turning: 0.19,
  /** lifting (a wide base under a load): the user's provisional 0.25 H (2026-10-21); no source read yet */
  wide: 0.25,
  /**
   * side-stepping: read (Fujimoto et al. 2021, Front Sports Act Living 3:670649, Methods, following Tateuchi et al. 2011): a lateral
   * step of 10–20% of body height from a stance of 10% inter-malleolar — the feet 0.20–0.30 H apart as it lands; the top of that
   * (2026-10-22, test-changes.md)
   */
  sideways: 0.3,
} as const;

/**
 * Late retargeting: how far a swinging foot's planned landing still moves in the last 40%
 * of its swing. A landing that moves late reads as a stumble — the foot comes down, then
 * reaches on. (Peak distance from where it lands, over the late part of every swing.)
 */
export class Landings {
  readonly late = new Peak();
  /** slow steps' width: the feet apart sideways as one lands, below SLOW, as a share of what its kind allows (`SLOW_WIDTH`: 1 at the bound) */
  readonly wide = new Peak();
  private readonly swings = new Map<Actor, ({ t: number; p: Vector3; facing: number }[] | null)[]>();

  see({ t, h }: Frame) {
    const swings = this.swings.get(h) ?? [null, null];
    this.swings.set(h, swings);
    h.feet.forEach((f, s) => {
      const track = swings[s];
      if (f.phase === 'swing') {
        swings[s] = track ?? [];
        swings[s].push({ t, p: f.position.clone(), facing: h.locomotion.facing });
        return;
      }
      swings[s] = null;
      if (f.phase !== 'planted' || !track?.length) return;
      const from = track[0].t + LATE * (t - track[0].t);
      for (const q of track) if (q.t >= from) this.late.see(q.p.distanceTo(f.position), t);
      // (slow, stopping or standing, the feet land about a stance apart sideways)
      const other = h.feet[1 - s];
      if (Math.hypot(h.locomotion.velocity.x, h.locomotion.velocity.z) >= SLOW || other.phase !== 'planted') return;
      const across = Math.abs(f.position.clone().sub(other.position).dot(leftOf(h.locomotion.facing)));
      // (its kind: turning — the body turned over the swing, or the foot landing turned against the other — side-stepping or lifting, else straight)
      const turned = Math.abs(wrapAngle(h.locomotion.facing - track[0].facing)) > TURNED || Math.abs(wrapAngle(f.yaw - other.yaw)) > TURNED + 0.24;
      const v = h.locomotion.velocity, sideways = Math.hypot(v.x, v.z) > 0.05 && Math.abs(v.dot(leftOf(h.locomotion.facing))) > ACROSS * Math.hypot(v.x, v.z);
      const lifting = Object.values(h.holding).some((held) => held && held.item.mass > 0);
      // (a step of several kinds gets the largest bound among them: a turning side-step is a side-step too — not the turn's first, as it
      // was; 2026-10-22, test-changes.md)
      const bound = Math.max(SLOW_WIDTH.straight, turned ? SLOW_WIDTH.turning : 0, lifting ? SLOW_WIDTH.wide : 0, sideways ? SLOW_WIDTH.sideways : 0);
      this.wide.see(across / (bound * h.proportions.height), t);
    });
  }

  toString() {
    return `late landing retarget max ${this.late}, slow step width max ${this.wide.value.toFixed(2)} of its bound @${this.wide.at.toFixed(2)}s`;
  }
}

const DEG = 180 / Math.PI;

/** how a body stands at rest (m, ×height, °) */
export interface Rest {
  /** heel centres apart (× height) */
  heels: number;
  /** the feet's midpoint off the centre of mass's ground point: sideways, fore-aft (m) */
  aside: number;
  ahead: number;
  /** the pelvis off the feet's midpoint, sideways (m) */
  pelvis: number;
  /** the centre of mass's ground point ahead of the ankle joints' midpoint (m) */
  overAnkles: number;
  /** each foot's toe-out (°) */
  toeOut: [number, number];
}

/**
 * The stance the first actor last stood still in (feet planted, not moving): how
 * wide, centred under the body and turned out its feet are — and whether the scene ends in it.
 */
export class FinalStance {
  rest: Rest | null = null;
  /** the last frame stood still */
  endsStanding = false;

  see({ h }: Frame) {
    const still = Math.hypot(h.locomotion.velocity.x, h.locomotion.velocity.z) < 0.05 && h.feet.every((f) => f.phase === 'planted');
    this.endsStanding = still;
    if (!still) return;
    const j = (n: string) => jointOf(h, n);
    const fwd = forwardOf(h.locomotion.facing);
    const left = leftOf(h.locomotion.facing);
    const heels = [j('leftHeel'), j('rightHeel')];
    const mid = heels[0].clone().add(heels[1]).add(j('leftBigToe')).add(j('rightBigToe')).multiplyScalar(0.25);
    const com = comOf(h).sub(mid).setY(0);
    const toeOut = (['left', 'right'] as const).map((s, i) => {
      const toes = j(`${s}BigToe`).add(j(`${s}SmallToe`)).multiplyScalar(0.5).sub(heels[i]);
      return Math.atan2(toes.dot(left) * (i === 0 ? 1 : -1), toes.dot(fwd)) * DEG;
    }) as [number, number];
    this.rest = {
      heels: heels[0].distanceTo(heels[1]) / h.proportions.height,
      // A deliberate quiet displacement changes the stance's requested centre, not its tolerance.
      aside: -com.clone().sub(h.locomotion.quiet).dot(left),
      ahead: -com.clone().sub(h.locomotion.quiet).dot(fwd),
      pelvis: j('hips').sub(mid).sub(h.locomotion.quiet).dot(left),
      overAnkles: comOf(h).sub(j('leftFoot').add(j('rightFoot')).multiplyScalar(0.5)).sub(h.locomotion.quiet).dot(fwd),
      toeOut,
    };
  }

  toString() {
    const r = this.rest;
    if (!r) return 'rest: never stood still';
    const cm = (m: number) => (m * 100).toFixed(1);
    return `rest${this.endsStanding ? ' (at the end)' : ''}: heels ${r.heels.toFixed(3)} H apart, feet's midpoint off the CoM ${cm(r.aside)} cm aside ${cm(r.ahead)} cm ahead, pelvis ${cm(r.pelvis)} cm aside, CoM ${cm(r.overAnkles)} cm ahead of the ankles, toe-out ${r.toeOut.map((a) => a.toFixed(0)).join('/')}°`;
  }
}
