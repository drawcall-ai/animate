import { Vector3 } from 'three';
import type { Person } from '../src/body/person';
import type { Side } from '../src/species/humanoid/bones';
import { dt } from './bodies';

/** each hand's speed (m/s) each frame from when `going()` turns true */
export function handSpeeds(h: Person, going: () => boolean) {
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
