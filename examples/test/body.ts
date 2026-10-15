import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { forwardOf, leftOf } from '../src/math';
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
      if (toes.dot(forwardOf(h.gait.facing)) < 0) toes.negate();
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
    if (jointOf(h, 'leftFoot').sub(jointOf(h, 'rightFoot')).dot(leftOf(h.gait.facing)) < 0.02) this.crossings++;
  }

  toString() {
    return `planted foothold out of reach ${this.reach}, knee-backward frames ${this.hyper}, ankle ${(180 - this.ankle.min.value).toFixed(0)}° (@${this.ankle.min.at.toFixed(2)}s) … ${this.ankle.max.value.toFixed(0)}° (@${this.ankle.max.at.toFixed(2)}s), leg-crossing frames ${this.crossings}`;
  }
}

/** the latest 40% of a swing: where the foot lands is settled by then (m) */
const LATE = 0.6;
/** below this speed (m/s) a step is a slow one: stopping, turning, standing */
const SLOW = 0.6;
/** the default stance's width, ankle to ankle (× height) */
const STANCE = 0.13;

/**
 * Late retargeting: how far a swinging foot's planned landing still moves in the last 40%
 * of its swing. A landing that moves late reads as a stumble — the foot comes down, then
 * reaches on. (Peak distance from where it lands, over the late part of every swing.)
 */
export class Landings {
  readonly late = new Peak();
  /** slow steps' width: the feet apart sideways as one lands, below SLOW (× the stance's width, STANCE) */
  readonly wide = new Peak();
  private readonly swings = new Map<Actor, ({ t: number; p: Vector3 }[] | null)[]>();

  see({ t, h }: Frame) {
    const swings = this.swings.get(h) ?? [null, null];
    this.swings.set(h, swings);
    h.feet.forEach((f, s) => {
      const track = swings[s];
      if (f.phase === 'swing') {
        swings[s] = track ?? [];
        swings[s].push({ t, p: f.position.clone() });
        return;
      }
      swings[s] = null;
      if (f.phase !== 'planted' || !track?.length) return;
      const from = track[0].t + LATE * (t - track[0].t);
      for (const q of track) if (q.t >= from) this.late.see(q.p.distanceTo(f.position), t);
      // (slow, stopping or standing, the feet land about a stance apart sideways)
      const other = h.feet[1 - s];
      if (Math.hypot(h.gait.velocity.x, h.gait.velocity.z) >= SLOW || other.phase !== 'planted') return;
      const across = Math.abs(f.position.clone().sub(other.position).dot(leftOf(h.gait.facing)));
      this.wide.see(across / (STANCE * h.proportions.height), t);
    });
  }

  toString() {
    return `late landing retarget max ${this.late}, slow step width max ${this.wide.value.toFixed(2)} stances @${this.wide.at.toFixed(2)}s`;
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
    const still = Math.hypot(h.gait.velocity.x, h.gait.velocity.z) < 0.05 && h.feet.every((f) => f.phase === 'planted');
    this.endsStanding = still;
    if (!still) return;
    const j = (n: string) => jointOf(h, n);
    const fwd = forwardOf(h.gait.facing);
    const left = leftOf(h.gait.facing);
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
      aside: -com.clone().sub(h.gait.quiet).dot(left),
      ahead: -com.clone().sub(h.gait.quiet).dot(fwd),
      pelvis: j('hips').sub(mid).sub(h.gait.quiet).dot(left),
      toeOut,
    };
  }

  toString() {
    const r = this.rest;
    if (!r) return 'rest: never stood still';
    const cm = (m: number) => (m * 100).toFixed(1);
    return `rest${this.endsStanding ? ' (at the end)' : ''}: heels ${r.heels.toFixed(3)} H apart, feet's midpoint off the CoM ${cm(r.aside)} cm aside ${cm(r.ahead)} cm ahead, pelvis ${cm(r.pelvis)} cm aside, toe-out ${r.toeOut.map((a) => a.toFixed(0)).join('/')}°`;
  }
}
