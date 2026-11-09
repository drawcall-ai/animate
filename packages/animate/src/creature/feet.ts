// A species' leg chains as the stepper's feet.
import { Euler, Quaternion, Vector3 } from 'three';
import type { ReadonlyBonePose } from '../kernel/bone-pose';
import { offsetAt, type Gait } from '../species/gait';
import type { LegChain } from '../species/leg-chain';
import { GRAVITY } from '../kernel/math';
import type { Spot } from '../step/support';
import type { Feet, GaitStepping } from '../step/types';

/** A foot's turn: heading `yaw`, pitched `pitch` (rad, + toes up). */
export const yawPitch = (yaw: number, pitch: number, out: Quaternion) => out.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));

/**
 * The stepper's feet for leg `chains` standing as in `rest` (the root at its standing height): each foot's terminal bone, its leg's top,
 * side and the leg across its girdle (the nearest on the other side), its home under it, the leg's length as it stands; planted, a foot rolls
 * about its heel or toe; its print is the sole between them.
 */
export function feetOf(chains: readonly LegChain[], rest: ReadonlyBonePose, depths: readonly ((out: number, ahead: number, pitch?: number) => number)[]): Feet {
  const root = rest.position(0), turn = _q.copy(rest.rotation(0)).invert();
  const local = (bone: number) => rest.position(bone).clone().sub(root).applyQuaternion(turn);
  const legs = chains.map((chain) => {
    const top = chain.joints[0].bone, foot = chain.joints[chain.joints.length - 1].bone, at = local(top), home = local(foot);
    // (a leg reaches a little further than it stands, `STRAIGHTER`: further, it is past what its joints' ranges let it reach)
    const length = STRAIGHTER * at.distanceTo(home);
    const sign = (home.x >= 0 ? 1 : -1) as 1 | -1;
    return { sign, foot, toes: chain.toes?.bone, top, ahead: at.z, home: home.z, hip: Math.abs(at.x), up: at.y, length, out: sign * (home.x - at.x), stand: at.y - home.y };
  });
  const partnerOf = (leg: (typeof legs)[number]) => legs.reduce((best, other, j) =>
    other.sign !== leg.sign && (best < 0 || Math.abs(other.ahead - leg.ahead) < Math.abs(legs[best].ahead - leg.ahead)) ? j : best, -1);
  const partnered = legs.map((leg) => ({ ...leg, partner: partnerOf(leg) }));
  const ankleHeight = -Math.min(chains[0].heel.y, chains[0].toe.y);
  const length = Math.min(...legs.map((leg) => leg.length));
  return {
    legs: partnered.map((leg, i) => ({
      ...leg,
      partner: leg.partner < 0 ? undefined : leg.partner,
      depth: depths[i],
      stray: strayOf(depths[i], leg.out, leg.home - leg.ahead, leg.stand),
      span: (drop: number) => {
        const rocker = Math.min(0, ...chains[i].rocker.map(([, pitch]) => pitch)) * Math.PI / 180;
        return spanOf(depths[i], leg.out, leg.home - leg.ahead, leg.stand - drop, rocker);
      },
    })),
    hip: Math.max(...legs.map((leg) => leg.hip)), length, thigh: length / 2, shin: length / 2, ankleHeight,
    // (a hoof or paw has no knee of its own to fold under it, nor a shank to lean past an ankle's bend)
    fold: Math.PI,
    ankle(i, anchor, yaw, pitch, out) {
      // (rolled about its heel, or its toe, the contact kept where it is)
      const { heel, toe } = chains[i], pivot = pitch >= 0 ? heel : toe;
      return out.copy(pivot).applyQuaternion(yawPitch(yaw, 0, _a)).add(anchor).sub(_v.copy(pivot).applyQuaternion(yawPitch(yaw, pitch, _b)));
    },
    rotation: (yaw, pitch, out) => yawPitch(yaw, pitch, out),
    soles(i, ankle, foot) {
      const { heel, toe } = chains[i];
      return [heel, toe].map((end) => end.clone().applyQuaternion(foot).add(ankle));
    },
    lean: () => 0,
    turnAbout(i, anchor, from, to, pitch) {
      // (about the end of the sole it stands on: its middle flat, its toe rolled over it, its heel rolled back onto it)
      const { heel, toe } = chains[i], middle = (pitch < 0 ? _v.copy(toe) : pitch > 0 ? _v.copy(heel) : _v.copy(heel).add(toe).multiplyScalar(0.5)).setY(0);
      const contact = _w.copy(middle).applyQuaternion(yawPitch(from, 0, _a)).add(anchor);
      anchor.copy(contact).sub(middle.applyQuaternion(yawPitch(to, 0, _b)));
    },
    print(i, anchor, yaw): Spot[] {
      const { heel, toe } = chains[i], half = 0.4 * Math.abs(toe.z - heel.z), turn = yawPitch(yaw, 0, _a);
      return [heel, toe].flatMap((end) => [-half, half].map((x): Spot => {
        const at = _v.set(end.x + x, 0, end.z).applyQuaternion(turn).add(anchor);
        return [at.x, at.z];
      }));
    },
  };
}

/**
 * How far a planted foot may stray across from where it stands under its top (m) while its leg still holds the top at its standing
 * height (`stand` below it), its joints' ranges as they allow (`depth`): of the two ways, the nearer, `STRAYING` of it.
 */
function strayOf(depth: (out: number, ahead: number, pitch?: number) => number, out: number, ahead: number, stand: number): number {
  const step = 0.005, most = 0.5;
  const reach = (way: number) => { let d = 0; while (d < most && depth(out + way * (d + step), ahead) >= stand) d += step; return d; };
  return STRAYING * Math.min(reach(1), reach(-1));
}

/** How far fore and aft together a planted foot reaches from under its top (m) while its leg holds the top `stand` above it, behind rolled as far as `ball` (rad). */
function spanOf(depth: (out: number, ahead: number, pitch?: number) => number, out: number, ahead: number, stand: number, ball: number): number {
  const step = 0.005, most = 2;
  const reach = (way: number, pitch: number) => { let d = 0; while (d < most && depth(out, ahead + way * (d + step), pitch) >= stand) d += step; return d; };
  // (behind, rolled over its toe as far as it breaks over)
  return reach(1, 0) + Math.max(reach(-1, 0), reach(-1, ball));
}

/**
 * A four-legged species' stepping, from its gait and feet: the gait's offsets; a stance travelling at most
 * `SPANNING` of how far its legs reach fore and aft let down on them as the gait has it (`drop`) — running (the gait's `run`), let down
 * further and reaching as far as they reach so; feet landing a little ahead (`LANDS_AHEAD` of the stance), as wide apart as they stand; a swing lifting
 * `LIFT` × the gait's clearance at its height; the legs reaching `REACH` of their length; a foot landing turned from the body no
 * further than `twist` (rad: as far as its legs stand turned, `ChainLeg.turn`), the body turning on over a planted one
 * as its foot pivots; behind, rolling over its toe as far as `ball` (rad, − toes down: its rocker's breakover) as the leg needs. No heel
 * strike or crouch: a hoof or paw lands flat.
 */
export function steppingOf(gait: Gait, feet: Feet, twist: number, ball: number): GaitStepping {
  const scale = 1, width = feet.hip, length = feet.length, clearance = Math.max(...gait.clearance);
  const run = gait.run;
  const lowered = (gait.drop ?? 0) * length;
  const drop = lowered + (run?.drop ?? 0) * length;
  const speedAt = (froude: number) => Math.sqrt(froude * GRAVITY * gait.height);
  const travelAt = (drop: number) => SPANNING * Math.min(...feet.legs.map((leg) => leg.span?.(drop) ?? Infinity));
  const travel = travelAt(lowered);
  return {
    scale, offsets: gait.contacts.map((_, i) => offsetAt(gait, 0, i)), toeOut: 0,
    run: run ? [speedAt(run.froude[0]), speedAt(run.froude[1])] : [NEVER, 2 * NEVER], travel: { forward: travel, run: run ? travelAt(drop) : travel, back: travel / 2, side: travel / 3 },
    landAhead: { share: LANDS_AHEAD, side: LANDS_AHEAD, most: length, run: length }, width: { stand: width, walk: width, run: width, narrowest: width },
    bob: 0, drop: { walk: lowered, side: lowered, run: drop }, lift: { walk: LIFT * clearance, run: LIFT * clearance, jump: LIFT * clearance }, arc: ARC,
    strike: { walk: 0, run: 0, ahead: 1 }, pitch: { heel: 0, ball }, dorsiflexion: Math.PI,
    crouch: { depth: 0, wider: 0, ahead: 0, travel: 0, lift: 0 }, reach: REACH, swingReach: SWING_REACH, clearance, gait, twist,
  };
}

/** Tuned: a foot lands this share of a stance ahead; a swing lifts this × the clearance; a leg reaches this share of its length */
const LANDS_AHEAD = 0.55, LIFT = 2.5, REACH = 0.99;
/** Tuned: a stance travels at most this share of how far its legs reach fore and aft, walking: the rest is the landing's spare */
const SPANNING = 0.65;
/** Tuned: a planted foot strays across at most this share of how far its leg reaches either way at its standing height */
const STRAYING = 0.6;
/** [D from recalled] a hoof or paw lifts early, peaking ~30% into its swing, and comes down long: u^ARC (1 − u)³ */
const ARC = 1.3;
/** Tuned: a swinging foot is not drawn in toward its top short of this share of its leg (its joints bound it) */
const SWING_REACH = 1.2;
/** Tuned: a leg reaches this much further than it stands */
export const STRAIGHTER = 1.04;
/** a speed (m/s) no creature runs at: it never runs as a person does (its gait has its own) */
const NEVER = 1e3;

const _e = new Euler(), _q = new Quaternion(), _a = new Quaternion(), _b = new Quaternion(), _v = new Vector3(), _w = new Vector3();
