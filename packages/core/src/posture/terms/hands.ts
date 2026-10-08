import { Vector3 } from 'three';
import { hypot, lerp, smoothstep, yawOf } from '../../math';
import type { HandTask } from '../../intent/tasks';
import type { Proportions } from '../../proportions';
import type { PostureCost } from '../cost';
import { P } from '../trunk';

const _v = new Vector3();
/** hands further out than this (× arm length) are reached for with the body: a bent arm held forward is no reach */
const REACH = 0.8;
/** braced against a force, the hands are held this far out from the shoulders: horizontally where to stand, and all told (× arm length) */
const BRACE = 0.7;
const BRACED = 0.85;
/** things held are carried a forearm out, the upper arms hanging a little forward (their share of it) */
const HOLD = 0.2;
/** a thing held in both hands is aimed at what is looked at when the line through the hands points this close to it (cos, from … to) */
const AIMED = [0.96, 0.985] as const;
/** aimed at what is this far past the front hand (m, default body: from … to) */
const PAST = [0.2, 0.5] as const;
/** the line of sight runs this far above the rear hand (× height): a rifle's grip below its bore, the sights above it */
const SIGHT = 0.085;
const _e = new Vector3();
const _sight: Sight = { origin: new Vector3(), dir: new Vector3(), rear: 0 };

/** a line of sight: from `origin` along `dir`; `rear` the side (0 left, 1 right) of the rear hand, whose eye sights */
export interface Sight {
  readonly origin: Vector3;
  readonly dir: Vector3;
  rear: number;
}

/**
 * Hands and gaze: reach targets with the body, work in front of it, face what matters.
 * 4 rows per hand target, facing the hands and what is looked at
 * (planner), sighting along what both hands aim (3, posture), following a tracked head (1).
 */
export function handRows(c: PostureCost, p: Float64Array, r: Float64Array, n: number): number {
  const { d, tasks: t, frame: fk, planner } = c;
  const L = d.armLength;
  let midX = 0;
  let midZ = 0;
  let midW = 0;
  for (let s = 0; s < 2; s++) {
    const h = c.hands[s];
    if (!h) continue;
    const w = h.weight;
    const shoulder = fk.upperArms[s];
    const dist = h.pos.distanceTo(shoulder);
    r[n++] = 14 * w * Math.max(0, dist - 0.96 * L);
    // reach with the body (trunk turn / lean) rather than a locked arm
    const overhead = smoothstep(0.1, 0.35, h.pos.y - shoulder.y);
    r[n++] = (planner ? 4 : 2.6 * (1 - 0.8 * overhead)) * w * Math.max(0, dist - REACH * L);
    // pushing or pulling something heavy, the arms are braced, nearly straight: the trunk holds back
    if (c.strain > 0) r[n++] = 8 * w * c.strain * Math.max(0, BRACED * L - dist);
    // hands work in front of the body, not inside it (the trunk's front: its bladed facing)
    _v.subVectors(h.pos, fk.chest);
    const ahead = _v.dot(fk.forward);
    const lateral = Math.abs(_v.dot(fk.left));
    const inTrunkBand = h.pos.y > fk.hips.y - 0.15 && h.pos.y < fk.neck.y + 0.1;
    r[n++] = inTrunkBand && lateral < d.shoulderHalfWidth * 1.3 ? 6 * w * Math.max(0, 0.16 - ahead) : 0;
    // (planner) objects are handled in front of the feet, in the facing (not the blade);
    // low ones further out (room for the knees)
    const fwd = c.supportForward;
    const fromFeet = (h.pos.x - p[P.X]) * fwd.x + (h.pos.z - p[P.Z]) * fwd.z;
    const low = 1 - smoothstep(0.3 * d.height, 0.6 * d.height, h.pos.y);
    if (planner) r[n++] = 5 * w * Math.max(0, 0.2 + 0.22 * low - fromFeet);
    // (planner) and, from waist to shoulder height, held a forearm's length out from the
    // shoulders, the upper arms hanging a little forward and the elbows bent (HOLD): nobody
    // carries things pressed to the belly, elbows back. (How far out, not which way: the
    // facing is the gait's to choose.)
    // (pushing or pulling something heavy, the arms are braced: nearly at arm's length)
    const fromShoulder = hypot(h.pos.x - shoulder.x, h.pos.z - shoulder.z);
    const held = lerp(d.forearm + HOLD * d.upperArm, BRACE * L, c.strain);
    if (planner) r[n++] = 5 * w * (1 - overhead) * (1 - low) * Math.max(0, held - fromShoulder);
    // (posture) extended reaches turn the chest toward the target (punches rotate the
    // trunk) — only for reaches well out in front: not overhead, not close to the body;
    // riding, the hands hold the mount (a bar): the chest doesn't turn after them
    const dx = h.pos.x - fk.chest.x;
    const dz = h.pos.z - fk.chest.z;
    const out = smoothstep(0.35, 0.6, hypot(dx, dz));
    const ext = smoothstep(0.65, 0.95, dist / L) * out * (1 - overhead);
    const chestYaw = p[P.YAW] + c.stance.blade + p[P.TWIST];
    if (!planner) r[n++] = ext > 0 && !t.mount ? 3 * w * ext * c.yawError(chestYaw, yawOf(dx, dz)) : 0;
    midX += h.pos.x * w;
    midZ += h.pos.z * w;
    midW += w;
  }

  // (planner) face the hands' work
  if (planner && midW > 0) {
    const dx = midX / midW - p[P.X];
    const dz = midZ / midW - p[P.Z];
    const hd = hypot(dx, dz);
    // (a tracked head decides facing; hands only nudge it)
    r[n++] = hd > 0.25 ? (t.headYaw !== null ? 0.5 : 1.5) * Math.min(1, midW) * smoothstep(0.25, 0.5, hd) * c.yawError(p[P.YAW], yawOf(dx, dz)) : 0;
  }

  // (planner) face what is looked at
  if (planner && t.look) {
    const dx = t.look.x - p[P.X];
    const dz = t.look.z - p[P.Z];
    r[n++] = hypot(dx, dz) > 0.5 ? 2 * c.yawError(p[P.YAW], yawOf(dx, dz)) : 0;
  }

  // (posture) aiming something held in both hands: the eyes come down behind it
  const [a, b] = c.hands;
  if (!planner && t.look && a && b) n = sightRows(c, a, b, t.look, r, n);

  // the body follows a tracked head once it turns past comfortable neck rotation
  if (t.headYaw !== null) {
    const e = c.yawError(p[P.YAW] + p[P.TWIST] * 0.8, t.headYaw);
    const dead = planner ? 0.7 : 0.5;
    r[n++] = (planner ? 3 : 2.5) * Math.sign(e) * Math.max(0, Math.abs(e) - dead);
  }
  return n;
}

/**
 * Sighting (3 rows): with both hands on a thing pointed at what is looked at (a rifle), the
 * eyes come onto its line of sight, the trunk leaning into it (a cheek weld).
 */
function sightRows(c: PostureCost, a: HandTask, b: HandTask, look: Vector3, r: Float64Array, n: number): number {
  const eyes = c.frame.eyes;
  const w = 10 * sightLine(a, b, look, eyes, c.d, _sight);
  const { origin, dir } = _sight;
  // the eyes off the line, across it
  const off = _e.subVectors(eyes, origin);
  off.addScaledVector(dir, -off.dot(dir));
  r[n++] = w * off.x;
  r[n++] = w * off.y;
  r[n++] = w * off.z;
  return n;
}

/**
 * How surely a thing held in both hands (`a` left, `b` right) is aimed at `look` (0..1) —
 * the line through the hands pointing at it, past the front hand (looking at that hand is
 * no aim) — and its line of sight (into `out`): SIGHT above the rear hand (the one nearer the
 * `eyes`), toward `look`.
 */
export function sightLine(a: HandTask, b: HandTask, look: Vector3, eyes: Vector3, d: Proportions, out: Sight): number {
  out.rear = a.pos.distanceToSquared(eyes) < b.pos.distanceToSquared(eyes) ? 0 : 1;
  const [rear, front] = out.rear === 0 ? [a, b] : [b, a];
  const held = _v.subVectors(front.pos, rear.pos).normalize();
  out.origin.copy(rear.pos).y += SIGHT * d.height;
  out.dir.subVectors(look, out.origin).normalize();
  const past = _e.subVectors(look, front.pos).dot(held);
  return Math.min(a.weight, b.weight) * smoothstep(AIMED[0], AIMED[1], held.dot(out.dir)) * smoothstep(PAST[0] * d.scale, PAST[1] * d.scale, past);
}
