import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Behaviour, Frame, Item, Placement, ReadonlyPose } from '@drawcall/animate';

/**
 * where a worn item sits: on a bone of the body, or on another worn item it hangs from (a sword in
 * its scabbard); its placement there (in that frame), from where it was put on; and where it
 * settles to, if anywhere (a helm onto the head)
 */
interface Seat {
  on: number | Item;
  at: Required<Placement> | null;
  settle: Placement | null;
}

/** how quickly a worn item settles into its seat (s: the time constant) */
const SETTLE = 0.08;

/**
 * What a body wears: items put on a bone (or on another item) that go with it from then on, rigidly,
 * as they sat when put on. `wear` is their one mover while they are worn: take an item off before
 * anything else moves it.
 */
export class Worn {
  private readonly seats = new Map<Item, Seat>();

  /** `item` worn on `on` from the next sub-step on, where it is then; given `settle` (in `on`'s frame), it settles there */
  put(item: Item, on: number | Item, settle: Placement | null = null): void {
    if (this.seats.has(item)) throw new Error('the item is worn already');
    this.seats.set(item, { on, at: null, settle });
  }

  /** `item` taken off: whatever moves it next (hands holding it) */
  take(item: Item): void {
    if (!this.seats.delete(item)) throw new Error('the item is not worn');
  }

  has(item: Item): boolean {
    return this.seats.has(item);
  }

  /** each worn item and its seat: those on bones first, then those on items (one level: what they hang from has moved by then) */
  *[Symbol.iterator](): Generator<[Item, Seat]> {
    for (const entry of this.seats) if (typeof entry[1].on === 'number') yield entry;
    for (const entry of this.seats) if (typeof entry[1].on !== 'number') yield entry;
  }
}

/**
 * The worn items carried along, every sub-step, endless: each put where its seat is now. Put it last
 * in the body's root parallel: after everything that poses the bones they are worn on (what reads a
 * worn item reads where it was a sub-step before).
 */
export function wear<W>(worn: Worn): Behaviour<W> {
  return function* () {
    yield* action<Frame<W>>({
      update: (f) => {
        for (const [item, seat] of worn) {
          // (put on: where it sat on its seat as both were last, as the hands left it)
          if (!seat.at) {
            const [position, quaternion] = placed(seat.on, f.prev, 'prev');
            const inverse = _q.copy(quaternion).invert();
            seat.at = {
              position: item.current.position.clone().sub(position).applyQuaternion(inverse),
              quaternion: inverse.multiply(item.current.quaternion).clone(),
            };
          }
          if (seat.settle) {
            const k = 1 - Math.exp(-f.dt / SETTLE);
            seat.at.position.lerp(seat.settle.position, k);
            if (seat.settle.quaternion) seat.at.quaternion.slerp(seat.settle.quaternion, k);
          }
          const [position, quaternion] = placed(seat.on, f.current, 'current');
          item.move(f.time, _p.copy(seat.at.position).applyQuaternion(quaternion).add(position), _r.copy(quaternion).multiply(seat.at.quaternion));
        }
      },
    });
  };
}

/** where a seat's bone is in `pose`, or the item it hangs from is (`when`: as it is now, or was before it last moved — what is worn moved this sub-step already) */
function placed(on: number | Item, pose: ReadonlyPose, when: 'prev' | 'current'): [Readonly<Vector3>, Readonly<Quaternion>] {
  if (typeof on === 'number') return [pose.position(on), pose.rotation(on)];
  return [on[when].position, on[when].quaternion];
}

const _p = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();
