// The weight a body bears of what it holds and wears: each thing's share taken up and given up, loaded onto the bones it bears on.
import { Vector3, Quaternion, type Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import type { BonePose } from '../kernel/bone-pose';
import { follow } from '../kernel/follow';
import { anchors } from './anchors';
import { Thing } from './thing';
import { handsOn, held, supported } from './hold';
import type { Self } from '../body/self';

/** How much of a thing's weight a body bears: its share (0 … 1) now and the two sub-steps before, its mass borne (kg) and the bones it bears on. */
export interface Bearing {
  share: number;
  prev: number;
  prev2: number;
  kg: number;
  bones: number[];
}

/** how quickly a weight is taken up and given up (share/s², share/s) */
const BEARING = { accel: 16, speed: 4 };

/**
 * The weight `self` bears, a sub-step on: each thing it holds off its support borne by the hands holding it (and by them, what hangs
 * from it), each it wears by the bone it hangs from; each share taken up and given up over a moment (what it wears from its first
 * sub-step, borne from then), and loaded onto those bones at the thing's centre of mass in this sub-step's pose.
 */
export function bear(self: Self, f: Frame, worn: readonly Thing[], borne: Map<Thing, Bearing>): void {
  const things = new Set<Thing>([...worn, ...held(self), ...borne.keys()]);
  // (a released bearing stays in this set for the sub-step that clears its loads)
  if (things.size === 0) return;
  for (const thing of things) {
    if (thing.mass === 0) continue;
    const bones = bearers(self, thing);
    let bearing = borne.get(thing);
    // (worn from the start — as the body was made — it bears it from the start)
    const start = f.time <= f.dt + 1e-9 && bones.length > 0 ? 1 : 0;
    if (!bearing) borne.set(thing, (bearing = { share: start, prev: start, prev2: start, kg: 0, bones }));
    [bearing.prev2, bearing.prev] = [bearing.prev, bearing.share];
    bearing.share = Math.min(1, Math.max(0, follow(bearing.prev2, bearing.prev, bones.length > 0 ? 1 : 0, BEARING, f.dt)));
    if (bones.length > 0) bearing.bones = bones;
    if (bearing.share === 0 && bones.length === 0) borne.delete(thing);
    else bearing.kg = bearing.share * thing.mass;
  }
  load(self, f.current, borne);
}

/** the bones `thing` bears on: the hands holding it (or what it hangs from) off its support, else the bone of `self` it hangs from */
function bearers(self: Self, thing: Thing): number[] {
  for (let at: Object3D | null = thing.object; at; at = at.parent) {
    const anchor = anchors.get(at);
    if (anchor) return anchor.body === self && anchor.bone >= 0 ? [anchor.bone] : [];
    if (at.userData.mass === undefined) continue;
    const above = Thing.of(at), hands = handsOn(self, above);
    if (hands.length) return supported(above) ? [] : hands.map((hand) => self.hands[hand]);
  }
  return [];
}

/** what `self` bears loaded onto its bones in `pose`, each thing's at its centre of mass */
function load(self: Self, pose: BonePose, borne: ReadonlyMap<Thing, Bearing>): void {
  const mass = new Map<number, number>(), moment = new Map<number, Vector3>();
  for (const [thing, bearing] of borne) {
    const placed = self.movingFrameOf(thing.object).at(self.frame.time).current;
    const centre = _c.copy(thing.centre).applyQuaternion(placed.quaternion).add(placed.position);
    for (const bone of bearing.bones) {
      mass.set(bone, (mass.get(bone) ?? 0) + bearing.kg / bearing.bones.length);
      let sum = moment.get(bone);
      if (!sum) moment.set(bone, (sum = new Vector3()));
      sum.addScaledVector(centre, bearing.kg / bearing.bones.length);
    }
  }
  for (let bone = 0; bone < pose.skeleton.bones.length; bone++) {
    const m = mass.get(bone) ?? 0, sum = moment.get(bone);
    if (m === 0 || !sum) pose.setLoad(bone, 0, ZERO);
    else pose.setLoad(bone, m, sum.divideScalar(m).sub(pose.position(bone)).applyQuaternion(_q.copy(pose.rotation(bone)).invert()));
  }
}

const ZERO = new Vector3(), _c = new Vector3(), _q = new Quaternion();
