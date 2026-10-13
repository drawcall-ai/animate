import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel } from '@pmndrs/timeline';
import { ask, beyond, headTo, idle, pelvisTo, trunkTo, type Asks, type Behaviour, type Frame } from '../../src';
import { INDEX } from '../../src/humanoid/bones';
import { Humanoid } from '../../src/humanoid/humanoid';
import { createSkeletonModel } from '../../src/humanoid/model';

/** a humanoid stepping `behaviour` for `seconds` */
function run(behaviour: (h: Humanoid) => Behaviour, seconds: number): Humanoid {
  const h = new Humanoid(createSkeletonModel(), behaviour);
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

describe('pelvisTo and trunkTo', () => {
  it('take the root, both feet with it, and turn the chest as asked', () => {
    const to = { position: new Vector3(0.1, 0.8, 0.05), quaternion: turned(0.3) };
    const chest = turned(0.6, 0.4);
    const taken: boolean[][] = [];
    const h = run(
      (h) =>
        function* () {
          yield* parallel<Frame>(
            'all',
            pelvisTo(h, to, { accel: 4, speed: 1, turnAccel: 20 }),
            trunkTo(h, chest),
            action<Frame>({ update: () => void taken.push([...h.asks.taken]) }),
          );
        },
      3,
    );
    expect(h.pose.position(0).distanceTo(to.position)).toBeLessThan(1e-3);
    expect(h.pose.rotation(0).angleTo(to.quaternion)).toBeLessThan(1e-3);
    expect(h.pose.rotation(INDEX.chest).angleTo(chest)).toBeLessThan(1e-3);
    expect(taken.every(([l, r]) => l && r)).toBe(true);
  });
});

describe('ask', () => {
  it('asks only what it is given, the feet taken copied in', () => {
    const taken: [boolean, boolean] = [true, false];
    let seen: Asks | null = null;
    run(
      (h) =>
        function* () {
          yield* parallel<Frame>(
            'all',
            ask(h, { lower: 0.1, taken }),
            action<Frame>({ update: () => void (seen = { ...h.asks, taken: [...h.asks.taken] }) }),
          );
        },
      0.1,
    );
    expect(seen).toMatchObject({ lower: 0.1, bow: 0, go: null, taken: [true, false] });
    expect(taken).toEqual([true, false]);
  });
});
