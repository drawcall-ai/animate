import { Vector3, Quaternion } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Pose } from '../core/pose';
import type { Item } from '../core/carrier';
import { follow } from '../core/follow';
import type { Behaviour } from '../core/goal';
import type { Dressed } from '../core/worn';
import { moveWorn, SETTLING } from '../core/worn';
import { INDEX, SIDES } from './bones';
import type { Humanoid } from './humanoid';

/**
 * How much of an item's weight a body bears (`Humanoid.borne`): its share (0 … 1) now and the two
 * sub-steps before, its mass borne (kg), and the bones it bears on (or last bore on).
 */
export interface Bearing {
  share: number;
  prev: number;
  prev2: number;
  kg: number;
  bones: number[];
}

const BEARING = { accel: 16, speed: 4 };

/** Load held and worn items onto the humanoid's bones after its tasks. */
export function carryWorn<W>(h: Humanoid<W>): Behaviour<W> {
  return function* () {
    yield* action<Frame<W>>({ update: (f) => { moveWorn(h, f); load(h, f); } });
  };
}

/** `wearing` worn and borne from the start, each item placed where it sits on its bone in `pose` (the body's first) and its weight loaded there */
export function dress<W>(h: Humanoid<W>, pose: Pose, wearing: readonly Dressed[]) {
  for (const { item, on, at } of wearing) {
    const position = at.position.clone();
    const quaternion = at.quaternion?.clone() ?? new Quaternion();
    h.worn.set(item, { on, to: null, motion: SETTLING, sits: { position, quaternion, prev: position.clone(), prev2: position.clone(), prevQ: quaternion.clone(), prev2Q: quaternion.clone() } });
    item.wornBy = h;
    item.supported = false;
    item.move(0, position.clone().applyQuaternion(pose.rotation(on)).add(pose.position(on)), pose.rotation(on).clone().multiply(quaternion));
    h.borne.set(item, { share: 1, prev: 1, prev2: 1, kg: item.mass, bones: [on] });
  }
  loadBones(h, pose);
}

/** the weight the body bears, its share of each item's followed on, loaded onto its bones in this sub-step's pose */
function load<W>(h: Humanoid<W>, f: Frame<W>) {
  /** the bones `item` bears on: the one it is worn on (through what it hangs from), or the hands holding it (or what it hangs from) off its support */
  const bearers = (item: Item): number[] => {
    let at: number | Item = item;
    for (;;) {
      if (typeof at === 'number') return [at];
      const wearing = h.worn.get(at);
      if (!wearing) break;
      at = wearing.on;
    }
    const top = at;
    if (top.supported) return [];
    return SIDES.filter((s) => h.holding[s]?.item === top).map((s) => INDEX[`${s}Hand`]);
  };
  const items = new Set<Item>([...h.worn.keys(), ...SIDES.flatMap((s) => h.holding[s]?.item ?? []), ...h.borne.keys()]);
  for (const item of items) {
    if (item.mass === 0) continue;
    const bones = bearers(item);
    let bearing = h.borne.get(item);
    if (!bearing) h.borne.set(item, (bearing = { share: 0, prev: 0, prev2: 0, kg: 0, bones }));
    // (followed from its history: taken up, or given up, within an acceleration)
    [bearing.prev2, bearing.prev] = [bearing.prev, bearing.share];
    bearing.share = Math.min(1, Math.max(0, follow(bearing.prev2, bearing.prev, bones.length > 0 ? 1 : 0, BEARING, f.dt)));
    if (bones.length > 0) bearing.bones = bones;
    if (bearing.share === 0 && bones.length === 0) {
      h.borne.delete(item);
      continue;
    }
    bearing.kg = bearing.share * item.mass;
  }
  loadBones(h, f.current);
}

/** what the body bears (`borne`) loaded onto the bones bearing it in `pose`, each item's at its centre of mass */
function loadBones<W>(h: Humanoid<W>, pose: Pose) {
  const mass = new Map<number, number>();
  const moment = new Map<number, Vector3>();
  for (const [item, bearing] of h.borne) {
    const centre = _c.copy(item.centre).applyQuaternion(item.current.quaternion).add(item.current.position);
    for (const bone of bearing.bones) {
      mass.set(bone, (mass.get(bone) ?? 0) + bearing.kg / bearing.bones.length);
      let sum = moment.get(bone);
      if (!sum) moment.set(bone, (sum = new Vector3()));
      sum.addScaledVector(centre, bearing.kg / bearing.bones.length);
    }
  }
  for (let bone = 0; bone < pose.skeleton.bones.length; bone++) {
    const m = mass.get(bone) ?? 0;
    const sum = moment.get(bone);
    if (m === 0 || !sum) {
      pose.setLoad(bone, 0, ZERO);
      continue;
    }
    pose.setLoad(bone, m, sum.divideScalar(m).sub(pose.position(bone)).applyQuaternion(_q.copy(pose.rotation(bone)).invert()));
  }
}

const ZERO = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
