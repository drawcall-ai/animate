import { Vector3 } from 'three';
import type { Fingers } from '../../src/index';
import { dt, type Readings, type Side } from './bodies';

/** a hand pointing, as `pose`'s `point` has it: for what takes its shape by the digit */
export const POINTING: Fingers = { thumb: { curl: 0.3, oppose: 0.45, spread: 0.25 }, index: { curl: 0.05, hook: 0.1 }, middle: { curl: 0.8, hook: 0.3 }, ring: { curl: 0.85, hook: 0.3 }, little: { curl: 0.9, hook: 0.3 } };

/** each hand's speed (m/s) each frame from when `going()` turns true */
export function handSpeeds(h: Readings, going: () => boolean) {
  const speed: Record<Side, number[]> = { left: [], right: [] };
  const was = { left: new Vector3(), right: new Vector3() };
  return {
    speed,
    sample() {
      for (const side of ['left', 'right'] as const) {
        const hand = h.pose.position(h.hands[side]);
        if (going()) speed[side].push(hand.distanceTo(was[side]) / dt);
        was[side].copy(hand);
      }
    },
  };
}
