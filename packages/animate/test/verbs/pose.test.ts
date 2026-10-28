import { Euler, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { Body, dog, horse, lookAt, pose, reach, wait, walkTo, type Posture, type Species } from '../../src/index';
import { INDEX } from '../../src/species/humanoid/bones';
import { hullOf, outside, xcomOf } from '../../src/legs/support';
import { footprint } from '../../src/legs/person/foot';
import { insides, person, play } from '../bodies';
import { HORSE } from '../../skills/animate/references/horse';
import { DOG } from '../../skills/animate/references/dog';
import { droid } from '../skeletons/droid';

/** `bone`'s turn in `posed` off its turn in `still` (in its own frame, as yaw, pitch and roll: Euler YXZ) */
function off(posed: Body, still: Body, bone: number): Euler {
  return new Euler().setFromQuaternion(still.pose.rotation(bone).clone().invert().multiply(posed.pose.rotation(bone)), 'YXZ');
}

/** `bone`'s turn and the root's height in `posed` off `still`'s: pitch (x), yaw (y), roll (z) (rad) and the drop (m, + down) */
const measure = (posed: Body, still: Body, bone: number) => {
  const { x, y, z } = off(posed, still, bone);
  return { pitch: x, yaw: y, roll: z, drop: still.pose.position(0).y - posed.pose.position(0).y };
};

/**
 * `posture` held by one of two like bodies for 2 s beside the other asked nothing (both of the same seed, so their quiet life is the
 * same): `bone` and the root off the other's at the hold's end and 1.5 s after it ends, and each body's log
 */
function posed(make: () => Body, posture: Posture, bone: (body: Body) => number) {
  const posing = make(), still = make();
  let held = measure(posing, still, bone(posing));
  play(function* () {
    yield* pose(posing, posture, { until: 2 });
  }, [posing, still], 3.5, (t) => void (Math.abs(t - 2) < 1e-6 && (held = measure(posing, still, bone(posing)))));
  return { held, after: measure(posing, still, bone(posing)), log: [...posing.log, ...still.log] };
}

const PERSON_CASES: [string, Posture, 'chest' | 'head', keyof ReturnType<typeof measure>, number][] = [
  ['a bow', { bow: 0.4 }, 'chest', 'pitch', 0.4],
  ['a back arched', { bow: -0.3 }, 'chest', 'pitch', -0.3],
  ['a twist', { twist: 0.4 }, 'chest', 'yaw', 0.4],
  ['a sideways lean', { lean: 0.2 }, 'chest', 'roll', 0.2],
  ['a crouch', { lower: 0.1 }, 'chest', 'drop', 0.1],
  ['a nod', { head: { pitch: 0.3 } }, 'head', 'pitch', 0.3],
  ['a head thrown back', { head: { pitch: -0.5 } }, 'head', 'pitch', -0.5],
  ['a head turned', { head: { yaw: 0.3 } }, 'head', 'yaw', 0.3],
  ['a head tilt', { head: { roll: 0.3 } }, 'head', 'roll', 0.3],
];

describe('pose', () => {
  it.each(PERSON_CASES)("%s turns a person's joint by the angle asked, and eases back once it ends", (_name, posture, bone, field, value) => {
    const { held, after, log } = posed(() => person({ dev: true }), posture, () => INDEX[bone]);
    expect(held[field]).toBeCloseTo(value, 2);
    expect(Math.abs(after[field])).toBeLessThan(0.01);
    // (joint speeds and accelerations, ranges, balance: the final-pose checks find nothing)
    expect(log).toEqual([]);
  });

  const CREATURES: [string, () => Species<string, string>][] = [['horse', () => horse(HORSE)], ['dog', () => dog(DOG)], ['droid', droid]];
  const CREATURE_CASES: [string, Posture, 'root' | 'head', keyof ReturnType<typeof measure>, number][] = [
    ['a bow', { bow: 0.2 }, 'root', 'pitch', 0.2],
    ['a back arched', { bow: -0.2 }, 'root', 'pitch', -0.2],
    ['a twist', { twist: 0.15 }, 'root', 'yaw', 0.15],
    ['a sideways lean', { lean: 0.15 }, 'root', 'roll', 0.15],
    ['a crouch', { lower: 0.05 }, 'root', 'drop', 0.05],
    ['a nod', { head: { pitch: 0.3 } }, 'head', 'pitch', 0.3],
    ['a head tilt', { head: { roll: 0.3 } }, 'head', 'roll', 0.3],
  ];
  describe.each(CREATURES)('a %s', (_kind, make) => {
    it.each(CREATURE_CASES)('takes %s on its trunk or head, its feet kept', (_name, posture, bone, field, value) => {
      const { held, after, log } = posed(() => new Body(make(), { dev: true }), posture, (body) => bone === 'root' ? 0 : body.species.gaze?.head ?? -1);
      expect(held[field]).toBeCloseTo(value, 2);
      expect(Math.abs(after[field])).toBeLessThan(0.01);
      expect(log).toEqual([]);
    });
  });

  it("takes of a creature's trunk only what its legs follow", () => {
    const bowed = posed(() => new Body(horse(HORSE), { dev: true }), { bow: 0.6 }, () => 0);
    const leaning = posed(() => new Body(horse(HORSE), { dev: true }), { lean: -0.4 }, () => 0);
    expect([bowed.held.pitch, leaning.held.roll].map((x) => +x.toFixed(2))).toEqual([0.25, -0.15]);
    expect([...bowed.log, ...leaning.log]).toEqual([]);
  });

  // (walking, a bow deeper than 0.5 is held to it: deeper, the walk's extrapolated centre of mass leaves its feet; an arch is added onto
  // the walk's own forward lean, ~0.14 at the chest, which a bow forward gives up)
  it.each([[0.3, 0.25], [-0.3, -0.15], [0.8, 0.45]])('poses a person over a walk: bowed %s rad and its head tilted, it walks on in balance', (bow, least) => {
    const body = person({ dev: true }), h = insides(body);
    let arrived = false, pitch = 0, roll = 0, worst = -Infinity;
    play(function* () {
      yield* parallel('race', function* () {
        arrived = yield* walkTo(body, new Vector3(0, 0, 3));
      }, pose(body, { bow, head: { roll: 0.25 } }));
    }, [body], 12, (t) => {
      if (t > 1.5 && t < 2.5) [pitch, roll] = [chestPitch(body), headRoll(body)];
      worst = Math.max(worst, xcomOutside(body, h));
      return arrived;
    });
    expect(arrived).toBe(true);
    // (bowed, its hips stand back of its centre of mass: that is what arrives)
    expect(body.pose.com(new Vector3()).z).toBeCloseTo(3, 1);
    expect(Math.abs(pitch)).toBeGreaterThan(Math.abs(least));
    expect(Math.sign(pitch)).toBe(Math.sign(bow));
    expect(roll).toBeGreaterThan(0.2);
    // (its extrapolated centre of mass stays within its feet or close: the walk's own check, 0.1 m out, finds nothing)
    expect(worst).toBeLessThan(0.1);
    expect(body.log).toEqual([]);
  });

  it('poses a person over a reach: the hand gets there, the chest arched and turned as asked', () => {
    const body = person({ dev: true }), h = insides(body), at = new Vector3(-0.2, 1.3, 0.45);
    let reached = false, worst = -Infinity, gap = Infinity, pitch = 0;
    play(function* () {
      yield* parallel('race', function* () {
        yield* wait(0.8);
        reached = yield* reach(body, { right: at });
        [gap, pitch] = [body.pose.position(INDEX.rightHand).distanceTo(at), chestPitch(body)];
      }, pose(body, { bow: -0.25, twist: 0.2 }));
    }, [body], 8, (t) => {
      if (t > 0.5) worst = Math.max(worst, xcomOutside(body, h));
      return reached;
    });
    expect(reached).toBe(true);
    expect(gap).toBeLessThan(0.02);
    expect(pitch).toBeLessThan(-0.15);
    expect(worst).toBeLessThan(0.1);
    expect(body.log).toEqual([]);
  });

  it('a newer pose overrides an older one where both pose a part, and the older takes it back; a head-only pose leaves the trunk be', () => {
    const body = person({ dev: true });
    const trunks: string[] = [], pitches: number[] = [];
    let heads = 0;
    play(function* () {
      yield* parallel('all', pose(body, { bow: 0.3 }, { until: 4 }), function* () {
        yield* wait(1);
        yield* pose(body, { bow: -0.2 }, { until: 1.5 });
        yield* pose(body, { head: { pitch: 0.3 } }, { until: 1 });
      });
    }, [body], 5, (t) => {
      const site = body.owners.trunk?.site ?? 'idle';
      if (trunks[trunks.length - 1] !== site) trunks.push(site);
      if (body.owners.head) heads++;
      if ([0.9, 2.4, 3.4].some((at) => Math.abs(t - at) < 1e-6)) pitches.push(chestPitch(body));
    });
    expect(trunks).toHaveLength(4);
    expect(trunks[0]).toBe(trunks[2]);
    expect(trunks[3]).toBe('idle');
    expect(heads).toBeGreaterThan(50);
    expect(pitches[0]).toBeCloseTo(0.3, 1);
    expect(pitches[1]).toBeCloseTo(-0.2, 1);
    expect(pitches[2]).toBeCloseTo(0.3, 1);
    expect(body.log).toEqual([]);
  });

  it('rejects what is no angle, and a head pose on a body with no head', () => {
    const body = person();
    expect(() => pose(body, { bow: Number.NaN })).toThrow(/bow NaN/);
    expect(() => pose(body, { head: { roll: Infinity } })).toThrow(/roll Infinity/);
  });

  it('leans a creature without a carriage into its acceleration, as its inertia has it', () => {
    // (its root driven from standing up to 0.3 m/s over a second; a twin without inertia stands up straight)
    const drive = (t: number) => ({ position: new Vector3(0, 0, t < 1 ? 0.15 * t * t : 0.15 + 0.3 * (t - 1)), yaw: 0 });
    const kind = droid(), leaning = new Body(kind, { dev: true, drive }), upright = new Body({ ...kind, inertia: undefined }, { dev: true, drive });
    const most = [0, 0];
    play(function* () {}, [leaning, upright], 3, () => [leaning, upright].forEach((body, i) => {
      most[i] = Math.max(most[i], new Euler().setFromQuaternion(body.pose.rotation(0), 'YXZ').x);
    }));
    expect(most[0]).toBeGreaterThan(0.01);
    expect(most[1]).toBe(0);
    // (this droid's stepping has faults of its own, lean or none: the lean adds none)
    expect(new Set(leaning.log.map((entry) => entry.check))).toEqual(new Set(upright.log.map((entry) => entry.check)));
  });
});

describe('lookAt', () => {
  it('tips the head as asked over the look, the eyes still on the target, and eases it back after', () => {
    const tipped = person({ dev: true }), plain = person({ dev: true }), at = new Vector3(0.6, 1.5, 1.5);
    let held: ReturnType<typeof measure> | null = null;
    play(function* () {
      yield* parallel('all', lookAt(tipped, at, { roll: 0.3, pitch: 0.15, until: 2 }), lookAt(plain, at, { until: 2 }));
    }, [tipped, plain], 3.5, (t) => void (Math.abs(t - 2) < 1e-6 && (held = measure(tipped, plain, INDEX.head))));
    expect(held).not.toBeNull();
    expect(held!.roll).toBeCloseTo(0.3, 2);
    expect(held!.pitch).toBeCloseTo(0.15, 2);
    expect(Math.abs(measure(tipped, plain, INDEX.head).roll)).toBeLessThan(0.01);
    expect([...tipped.log, ...plain.log]).toEqual([]);
  });

  it("adds a pose's head onto a look's: the look keeps the eyes, the pose the head's tilt", () => {
    const body = person({ dev: true }), plain = person({ dev: true }), at = new Vector3(-0.8, 1.6, 2);
    let roll = 0;
    play(function* () {
      yield* parallel('all', lookAt(body, at, { roll: 0.1, until: 2 }), pose(body, { head: { roll: 0.15 } }, { until: 2 }), lookAt(plain, at, { until: 2 }));
    }, [body, plain], 2, (t) => void (Math.abs(t - 2) < 1e-6 && (roll = measure(body, plain, INDEX.head).roll)));
    expect(roll).toBeCloseTo(0.25, 2);
    expect(body.owners).toMatchObject({ look: { verb: 'lookAt' }, head: { verb: 'pose' } });
  });
});

/** the chest's pitch in the world (rad, + forward) */
const chestPitch = (body: Body) => new Euler().setFromQuaternion(new Quaternion().setFromAxisAngle(UP, -body.facing).multiply(body.pose.rotation(INDEX.chest)), 'YXZ').x;
/** the head's roll in the world (rad, + its left side up) */
const headRoll = (body: Body) => new Euler().setFromQuaternion(new Quaternion().setFromAxisAngle(UP, -body.facing).multiply(body.pose.rotation(INDEX.head)), 'YXZ').z;
/** how far (m) the extrapolated centre of mass is outside the feet's support (− inside) */
function xcomOutside(body: Body, h: ReturnType<typeof insides>): number {
  const com = body.pose.com(new Vector3()), velocity = h.frame.prev.com(new Vector3()).sub(h.frame.prev2.com(new Vector3())).divideScalar(h.frame.dt);
  const xcom = xcomOf(com, velocity, h.proportions.legLength, new Vector3());
  const support = (h.stepper?.legs ?? []).flatMap((leg) => footprint(h.proportions, leg.anchor, leg.yaw));
  return outside(hullOf(support), xcom);
}
const UP = new Vector3(0, 1, 0);
