import { Quaternion, Vector3 } from 'three';
import { idle } from '../../src/humanoid/idle';
import { describe, expect, it } from 'vitest';
import { action, parallel } from '@pmndrs/timeline';
import { headTo, type Behaviour, type Frame } from '../../src';
import { ask, type Asks } from '../../src/rig';
import { beyond } from '../../src/core/limits';

import { INDEX } from '../../src/humanoid/bones';
import { Humanoid } from '../../src/humanoid/humanoid';
import { createSkeletonModel } from '../../src/humanoid/model';

/** a humanoid stepping `behaviour` for `seconds` */
function run(behaviour: (h: Humanoid) => Behaviour, seconds: number): Humanoid {
  const h = new Humanoid(createSkeletonModel(), behaviour, { idle: false });
  for (let t = 0; t < seconds; t += 1 / 60) h.update(1 / 60);
  return h;
}

const eyes = (h: Humanoid) => h.pose.point(INDEX.head, h.proportions.eyes, new Vector3());
const turned = (yaw: number, pitch = 0) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));

/** every joint of the spine within its range */
function withinRanges(h: Humanoid) {
  for (const bone of [INDEX.spine, INDEX.chest, INDEX.neck, INDEX.head]) {
    const limit = h.rig.skeleton.limits[bone];
    if (!limit) throw new Error('no limit');
    expect(beyond(h.pose.local(bone), limit)).toBeLessThan(1e-6);
  }
}

describe('headTo', () => {
  it('puts the eyes and turns the head through the spine alone, the body where it stands', () => {
    // (a look round and down, as a headset turns about the skull's centre)
    const target = { position: new Vector3(NaN), quaternion: turned(0.9, 0.3) };
    const h = run(
      (h) =>
        headTo(h, (f) => {
          const p = h.proportions;
          if (Number.isNaN(target.position.x)) {
            const centre = f.prev.point(INDEX.head, p.headCenter, new Vector3());
            target.position.subVectors(p.eyes, p.headCenter).applyQuaternion(target.quaternion).add(centre);
          }
          return target;
        }),
      2,
    );
    // (pitched about the skull's centre, the head's base would rise past what the straight spine reaches: all but that)
    expect(eyes(h).distanceTo(target.position)).toBeLessThan(0.02);
    expect(h.pose.rotation(INDEX.head).angleTo(target.quaternion)).toBeLessThan((2 * Math.PI) / 180);
    expect(h.pose.position(0).y).toBeCloseTo(h.proportions.hipHeight, 2);
    withinRanges(h);
  });

  it('leading, brings the body down under eyes lower than it stands', () => {
    let target = { position: new Vector3() };
    const h = run((h) => {
      const p = h.proportions;
      target = { position: new Vector3(0, p.eyeHeight - 0.4, 0.15) };
      return function* () {
        yield* parallel<Frame>('all', idle(h), headTo(h, target, { lead: true }));
      };
    }, 4);
    expect(eyes(h).distanceTo(target.position)).toBeLessThan(0.03);
    expect(h.pose.position(0).y).toBeLessThan(h.proportions.hipHeight - 0.1);
    withinRanges(h);
  });
});

describe('ask', () => {
  it('asks only what it is given', () => {
    let seen: Asks | null = null;
    run(
      (h) =>
        function* () {
          yield* parallel<Frame>(
            'all',
            ask(h, { lower: 0.1 }),
            action<Frame>({ update: () => void (seen = { ...h.asks }) }),
          );
        },
      0.1,
    );
    expect(seen).toMatchObject({ lower: 0.1, bow: 0, go: null });
  });
});
