import { Quaternion, Vector3 } from 'three';
import { watch } from '../core/dev';
import type { Item } from '../core/carrier';
import type { Behaviour } from '../core/goal';
import type { Humanoid } from './humanoid';
import { INDEX, type Side } from './bones';

/** Warns when every bone stays below 5 cm/s for longer than seconds. Scope it to a beat where motion is expected. */
export function stillFor<W>(seconds: number): Behaviour<W> {
  return function* () {
    let since: number | null = null;
    yield* watch<W>('stillFor', (f) => {
      const still = f.prev.skeleton.bones.every((_, i) => f.prev.position(i).distanceTo(f.prev2.position(i)) / f.dt < 0.05 && f.prev.local(i).angleTo(f.prev2.local(i)) / f.dt < 0.05);
      if (!still) { since = null; return null; }
      since ??= f.time;
      const value = f.time - since;
      return value > seconds ? { check: 'dead time (s)', value, limit: seconds, where: 'body', severity: 'warning' } : null;
    })();
  };
}

/** A scene's expectation that this ankle stays in place through a standing beat, including across balance steps. */
export function planted<W>(h: Humanoid<W>, side: Side): Behaviour<W> {
  return function* () {
    const bone = h.rig.skeleton.index(`${side}Foot`);
    let anchor: Vector3 | null = null;
    yield* watch<W>('planted', (f) => {
      const at = f.prev.position(bone);
      anchor ??= at.clone();
      const value = anchor.distanceTo(at);
      return value > 0.01 ? { check: 'foot moved (m)', value, limit: 0.01, where: `${side}Foot` } : null;
    })();
  };
}

/**
 * Eyes should lead a new grip by seconds (0.4–0.6 s in Land, Mennie & Rusted 1999).
 * Compose before the story so holding still describes the previous final pose. Taking
 * one's own worn item by feel is excluded. The head's comfortable eye range allows the
 * eyes to look within the head: down further than up or aside (see Humanoid's gazer).
 */
export function eyesOnBefore<W>(h: Humanoid<W>, item: Item, seconds: number): Behaviour<W> {
  return function* () {
    let since: number | null = null;
    let held = false;
    yield* watch<W>('eyesOnBefore', (f) => {
      const eyes = h.gazer.eyes(f.prev, new Vector3());
      const toward = item.current.position.clone().sub(eyes).applyQuaternion(new Quaternion().copy(f.prev.rotation(INDEX.head)).invert());
      const range = h.gazer.range;
      const side = Math.atan2(toward.x, toward.z);
      const down = Math.atan2(-toward.y, Math.hypot(toward.x, toward.z));
      const on = toward.z > 0 && Math.hypot(side / range.side, down / (down > 0 ? range.down : range.up)) <= 1;
      if (on) since ??= f.time;
      else since = null;
      const holding = h.holding.left?.item === item || h.holding.right?.item === item;
      const took = holding && !held;
      held = holding;
      if (!took || h.worn.has(item)) return null;
      const value = since === null ? 0 : f.time - since;
      return value + 1e-9 < seconds ? { check: 'gaze lead shortfall (s)', value: seconds - value, limit: 0, where: 'head' } : null;
    })();
  };
}
