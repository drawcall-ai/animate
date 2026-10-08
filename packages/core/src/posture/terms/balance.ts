import { Vector3 } from 'three';
import { clamp, hypot } from '../../math';
import type { PostureCost } from '../cost';
import { MASS } from '../../pose/mass';
import { P } from '../trunk';

const _v = new Vector3();
const _c = new Vector3();
const _com = new Vector3();
const _up = new Vector3();
const _h = new Vector3();
/** hip joint → support foot distances [left, right] */
const _legs = new Float64Array(2);

/**
 * Standing on the feet: centre of mass over the support (2, with any foot bearing
 * weight; riding, over the mount, inclined with the body), knee effort (1 per supporting
 * foot), pelvis between the feet sideways (1, posture; riding, the mount holds it), legs
 * able to reach their feet (2 per supporting foot).
 */
export function balanceRows(c: PostureCost, p: Float64Array, r: Float64Array, n: number): number {
  const { d, frame: fk, planner, sit, support } = c;

  // ---- centre of mass above the support
  let cx = 0;
  let cz = 0;
  let cw = 0;
  for (const f of support) {
    if (!f) continue;
    cx += f.x;
    cz += f.z;
    cw++;
  }
  const { tilt, pivot } = c.overlay;
  if (cw > 0) {
    // centre of pressure sits slightly in front of the ankles; standing, it wanders (the overlay's sway)
    const ff = fk.forward;
    const fl = fk.left;
    const ahead = 0.012 * d.height + c.overlay.swayAhead;
    const aside = c.overlay.swayLeft;
    // (and leaning into a force at the hands, the centre of mass is held off it)
    const lean = c.tasks.lean;
    cx = cx / cw + ff.x * ahead + fl.x * aside + lean.x;
    cz = cz / cw + ff.z * ahead + fl.z * aside + lean.z;
    const com = postureCentre(c);
    // (riding: over the mount, along the effective gravity the body is inclined to)
    if (tilt) {
      const up = _v.set(0, 1, 0).applyQuaternion(tilt);
      const k = (com.y - pivot.y) / up.y;
      cx = pivot.x + up.x * k;
      cz = pivot.z + up.z * k;
    }
    // a plan is where we'll stand still, so balance always counts there
    const wb = planner ? 4 : 6 * (1 - 0.85 * c.walk) * (1 - sit);
    r[n++] = wb * (com.x - cx);
    r[n++] = wb * (com.z - cz);
  }

  // ---- knee flexion effort (quadriceps torque): steep near straight, so people
  // either stand tall or commit to a bend; a ready stance prefers its crouch
  const Ll = d.legLength;
  const prefFlex = c.preferredFlex;
  for (let s = 0; s < 2; s++) {
    const f = support[s];
    if (!f) continue;
    const dist = (_legs[s] = fk.upperLegs[s].distanceTo(f));
    const flex = 2 * Math.acos(clamp(dist / (0.9998 * Ll), 0, 1));
    // a relaxed ~10° knee bend is nearly free; beyond it effort rises
    const e = flex - prefFlex;
    r[n++] = (1 - sit) * (0.75 * Math.sign(e) * Math.max(0, Math.abs(e) - 0.3) + 0.5 * e);
  }

  // ---- (posture) the pelvis stays over the feet sideways (no leaning tower over a closed stance)
  if (!planner) {
    const lx = c.supportLeft.x;
    const lz = c.supportLeft.z;
    const [h0, h1] = c.footholds;
    const a = (h0.x - fk.hips.x) * lx + (h0.z - fk.hips.z) * lz;
    const b = (h1.x - fk.hips.x) * lx + (h1.z - fk.hips.z) * lz;
    const lo = Math.min(a, b) - 0.03;
    const hi = Math.max(a, b) + 0.03;
    r[n++] = tilt ? 0 : 45 * (lo > 0 ? lo : hi < 0 ? hi : 0);
  }

  // ---- legs must be able to reach their support feet
  for (let s = 0; s < 2; s++) {
    const f = support[s];
    if (!f) continue;
    const dist = _legs[s];
    // heels can come up (tiptoe) when the pelvis is above standing height
    r[n++] = 25 * Math.max(0, dist - 0.998 * d.legLength - Math.max(0, -p[P.DROP]));
    r[n++] = 12 * Math.max(0, 0.3 * d.legLength - dist);
  }

  // ---- (posture, riding standing) an athletic stance: the trunk leans forward about as far as
  // the shanks do (along the effective gravity), the hips back over the feet — the knees' load
  // line runs close to them (least quadriceps effort), not a crouch sitting on air
  if (!planner && c.tasks.mount) {
    const up = c.overlay.tilt ? _up.set(0, 1, 0).applyQuaternion(c.overlay.tilt) : _up.set(0, 1, 0);
    let shank = 0;
    let legs = 0;
    for (let s = 0; s < 2; s++) {
      const f = support[s];
      if (!f) continue;
      shank += shankTilt(fk.upperLegs[s], f, c.toes[s], up, d.thigh, d.shin);
      legs++;
    }
    const t = _h.subVectors(fk.neck, fk.hips);
    const trunk = Math.atan2(t.dot(fk.forward), t.dot(up));
    r[n++] = legs ? 3 * (1 - sit) * c.tasks.mount.weight * (trunk - STANCE_LEAN * (shank / legs)) : 0;
  }
  return n;
}

/** the trunk's forward lean per the shanks' (athletic stance) */
const STANCE_LEAN = 1;

/**
 * The shank's tilt over a flat foot (rad, + = the knee ahead of the ankle, toward `toes`),
 * `up` the foot's vertical: the leg from `hip` to `ankle` bending its knee toward the toes.
 */
function shankTilt(hip: Vector3, ankle: Vector3, toes: Vector3, up: Vector3, thigh: number, shin: number): number {
  const h = _h.subVectors(hip, ankle);
  const along = h.dot(toes);
  const rise = h.dot(up);
  const dist = hypot(along, rise);
  const bend = Math.acos(clamp((shin * shin + dist * dist - thigh * thigh) / (2 * shin * dist), -1, 1));
  return Math.atan2(along, rise) + bend;
}

/** Centre of mass of the evaluated posture (arms hang, or reach toward their targets). */
function postureCentre(c: PostureCost): Vector3 {
  const { frame: fk, d, tasks, support } = c;
  const com = _com.set(0, 0, 0);
  com.addScaledVector(fk.headCenter, MASS.head);
  com.addScaledVector(fk.spine, MASS.spine).addScaledVector(fk.chest, MASS.chest);
  for (let s = 0; s < 2; s++) {
    // hanging arm, blended toward the reaching arm
    _v.copy(fk.upperArms[s]);
    _v.y -= d.armLength * 0.45;
    const h = c.hands[s];
    if (h) _v.lerp(_c.copy(fk.upperArms[s]).lerp(h.pos, 0.45), h.weight);
    com.addScaledVector(_v, MASS.arm);
    const ft = tasks.feet[s];
    const foot = ft ? ft.pos : (support[s] ?? support[1 - s] ?? fk.hips);
    _v.copy(fk.upperLegs[s]).lerp(foot, 0.42);
    com.addScaledVector(_v, MASS.leg);
  }
  return com;
}
