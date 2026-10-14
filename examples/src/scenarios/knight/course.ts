import { Quaternion, Vector3 } from 'three';
import { live, type Frame, type Item, type Live, type Placement, type World } from '@drawcall/animate';
import { minimumJerk } from '../../keys';

type F = Frame<World>;

/** a leg of a course: how long it takes (s), and where it goes in the course's frame — or where, given where the course set out from and where the leg before ended (both in that frame) */
export type Leg = [seconds: number, to: Placement | ((start: Required<Placement>, last: Required<Placement>) => Placement)];

/** A course an item is carried along: where it is at a sub-step (`to`), and whether it has gone all its way (`over`). */
export interface Course {
  to: (f: F) => Required<Placement>;
  over: (f: F) => boolean;
}

/**
 * A course through `frame` (a moving frame: a placement with no scale of its own) from where `item`
 * is when it is first read: each leg from where the last ended to its placement (distances × `scale`),
 * at rest at both ends (minimum jerk, the rotation turned along), one after another, `pace` times as
 * fast as its legs say.
 */
export function course(item: Item, frame: Live<Required<Placement>, World>, legs: readonly Leg[], { scale = 1, pace = 1 } = {}): Course {
  let start = NaN;
  const stops: Required<Placement>[] = [];
  const total = legs.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  const to = (f: F): Required<Placement> => {
    const at = live(frame, f);
    if (Number.isNaN(start)) {
      start = f.time;
      const inverse = at.quaternion.clone().invert();
      // (where it sets out from, in the frame unscaled: the legs' placements are scaled)
      const from = { position: item.current.position.clone().sub(at.position).applyQuaternion(inverse).divideScalar(scale), quaternion: inverse.multiply(item.current.quaternion) };
      stops.push(from);
      for (const [, leg] of legs) {
        const next = typeof leg === 'function' ? leg(from, stops[stops.length - 1]) : leg;
        stops.push({ position: next.position, quaternion: next.quaternion ?? stops[stops.length - 1].quaternion });
      }
    }
    let t = f.time - start;
    let i = 0;
    while (i < legs.length - 1 && t > legs[i][0] / pace) t -= legs[i++][0] / pace;
    const s = minimumJerk(t / (legs[i][0] / pace));
    _q.copy(stops[i].quaternion).slerp(stops[i + 1].quaternion, s);
    return {
      position: _p.lerpVectors(stops[i].position, stops[i + 1].position, s).multiplyScalar(scale).applyQuaternion(at.quaternion).add(at.position).clone(),
      quaternion: at.quaternion.clone().multiply(_q),
    };
  };
  return { to, over: (f) => !Number.isNaN(start) && f.time - start >= total };
}

/** a leg that stays where the one before ended: a moment held still */
export const still = (_: Required<Placement>, last: Placement) => last;

const _p = new Vector3();
const _q = new Quaternion();
