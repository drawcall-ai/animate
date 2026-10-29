import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, carry, dog, grab, humanoid, lookAt, reach, walkTo } from '../../src/index';
import { DOG } from '../../skills/animate/references/dog';
import { INDEX, SIDES, type Side } from '../../src/species/humanoid/bones';
import { CHEWBACCA } from '../skeletons/chewbacca';
import { Quiet } from '../../src/legs/person/quiet';
import { insides, person, play, run } from '../bodies';
import { box, roomOf } from '../things';

const pitchOf = (rotation: Quaternion) => new Euler().setFromQuaternion(rotation, 'YXZ').x;
const yawOf = (rotation: Quaternion) => new Euler().setFromQuaternion(rotation, 'YXZ').y;

it('stands alive, deterministically: breathing, millimetre sway and a weight shift within 25 s', () => {
  const sample = () => {
    const body = person({ dev: true }), h = insides(body);
    const x: number[] = [], pitch: number[] = [];
    run(body, 25, () => {
      x.push(h.pose.com(new Vector3()).x);
      pitch.push(pitchOf(h.pose.rotation(INDEX.chest)));
    });
    const sign = Math.sign(h.locomotion.quiet.x);
    expect(Math.abs(h.locomotion.quiet.x)).toBeGreaterThan(0.04);
    const loaded = sign > 0 ? 'left' : 'right', unloaded = sign > 0 ? 'right' : 'left';
    const hip = (side: Side) => h.pose.position(INDEX[`${side}UpperLeg`]).y;
    const knee = (side: Side) => h.pose.local(INDEX[`${side}LowerLeg`]).angleTo(new Quaternion());
    expect(hip(unloaded)).toBeLessThan(hip(loaded) - 0.005);
    expect(knee(unloaded)).toBeGreaterThan(0.2);
    expect(knee(unloaded)).toBeGreaterThan(knee(loaded));
    run(body, 3);
    expect(h.locomotion.quiet.x * sign).toBeGreaterThan(0.04);
    expect(body.log).toEqual([]);
    return { x, pitch };
  };
  const a = sample(), b = sample();
  expect(a).toEqual(b);
  expect(Math.max(...a.x.slice(0, 600)) - Math.min(...a.x.slice(0, 600))).toBeGreaterThan(0.003);
  expect(Math.max(...a.x) - Math.min(...a.x)).toBeGreaterThan(0.04);
  expect(Math.max(...a.pitch.slice(120, 600)) - Math.min(...a.pitch.slice(120, 600))).toBeGreaterThan(0.02);
});

it.each(['an across-body reach', 'an over-shoulder look'])('turns the trunk on the hips for %s within its range, and back after', (what) => {
  const body = person({ dev: true }), h = insides(body);
  const twist = () => Math.abs(yawOf(h.pose.rotation(INDEX.chest)) - yawOf(h.pose.rotation(INDEX.hips)));
  let most = 0;
  play(function* () {
    if (what === 'an over-shoulder look') yield* lookAt(body, new Vector3(-2, 1.4, -1), { until: 3 });
    // (across to a point the right hand reaches twisted: one at x 0.45 stayed 5 cm short, beyond the arm, hidden by `until` before reaches
    // failed as their hands stopped)
    else yield* reach(body, { right: new Vector3(0.38, 1.2, 0.25) }, { until: 3 });
  }, [body], 3.1, () => void (most = Math.max(most, twist())));
  expect(most).toBeGreaterThan(0.12);
  run(body, 3);
  expect(twist()).toBeLessThan(0.05);
  expect(body.log).toEqual([]);
});

// (a weight shift rolls the pelvis onto the loaded leg, raising that hip: the legs are planned from it, so the loaded foot stays on its
// sole and a foot stepped in place beside it lands bent — before, the 2.28 m Chewbacca skeleton's loaded leg stood over-reached, its foot
// rolled 6 mm up, and an idle step landed on a straight knee that snapped bent at 2800°/s)
it('keeps a shifted stance in reach: an idle step lands on a bent knee, standing 25 s on a tall rigged skeleton', () => {
  const body = new Body(humanoid(CHEWBACCA), { dev: true, at: new Vector3(1.1, 0, 10) }), h = insides(body);
  let straightest = Infinity;
  run(body, 25, () => {
    h.stepper?.legs.forEach((leg, i) => {
      if (!leg.landed) return;
      const side = SIDES[i], hip = h.pose.position(INDEX[`${side}UpperLeg`]), knee = h.pose.position(INDEX[`${side}LowerLeg`]), ankle = h.pose.position(INDEX[`${side}Foot`]);
      straightest = Math.min(straightest, knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)));
    });
  });
  expect(straightest).toBeGreaterThan(0.05);
  expect(body.log).toEqual([]);
});

it('prepares a heavy lift before its support leaves it, and carries it slower than a light one', () => {
  const lift = (mass: number) => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(-0.15, 1, 0.4), { mass, solid: false });
    let held = NaN, off = NaN, end = NaN, down = 0, preparation = 0, hips = NaN;
    play(function* () {
      yield* grab(body, load, { right: 'right' });
      yield* carry(body, load, new Vector3(-0.15, 1.2, 0.4));
      end = h.frame.time;
    }, [body], 6, (time) => {
      if (Number.isNaN(held) && body.holds(load)) [held, hips] = [time, h.pose.position(0).y];
      if (!Number.isNaN(held) && Number.isNaN(off)) {
        if (load.parent === room) {
          down = Math.max(down, hips - h.pose.position(0).y);
          preparation = Math.max(preparation, h.poise.lower);
        } else off = time;
      }
      return !Number.isNaN(end);
    });
    expect(body.log).toEqual([]);
    return { delay: off - held, down, preparation, seconds: end - off, pitch: pitchOf(h.pose.rotation(INDEX.chest)) };
  };
  const light = lift(0), heavy = lift(5);
  // (an anticipatory dip of 100 ms and 5 mm before a heavy load leaves its support; a light one is just taken)
  expect(heavy.delay - light.delay).toBeGreaterThanOrEqual(0.05);
  expect(heavy.delay - light.delay).toBeLessThanOrEqual(0.15);
  expect(heavy.preparation).toBeGreaterThanOrEqual(0.005);
  expect(heavy.down).toBeLessThan(0.01);
  expect(heavy.seconds).toBeGreaterThan(light.seconds + 0.2);
  expect(heavy.pitch).toBeLessThan(light.pitch - 0.01);
});

it('slows its walk under a load, counting a load held in both hands once', () => {
  const pace = (mass: number, both: boolean) => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 1, 0.4), { mass, solid: false });
    let speed = 0;
    play(function* () {
      yield* grab(body, load, both ? { left: 'left', right: 'right' } : { right: 'right' });
      yield* walkTo(body, new Vector3(0, 0, 3), { until: 0.3 });
    }, [body], 4, () => {
      if (h.going && body.owners.go?.verb === 'walkTo') speed = h.going.speed;
    });
    expect(body.log).toEqual([]);
    return speed;
  };
  const light = pace(0, false), heavy = pace(5, false);
  expect(heavy).toBeGreaterThan(0);
  expect(heavy).toBeLessThan(light);
  expect(pace(5, true)).toBeCloseTo(heavy, 8);
});

it('keeps its sway and breathing after a loaded walk, without spontaneous weight shifts', () => {
  const body = person({ dev: true }), h = insides(body), room = roomOf(body);
  const load = box(room, new Vector3(-0.15, 1.05, 0.35), { mass: 5, solid: false });
  play(function* () {
    yield* grab(body, load, { right: 'right' });
    yield* walkTo(body, new Vector3(0, 0, 2));
  }, [body], 8);
  const sway: number[] = [], breath: number[] = [];
  run(body, 15, () => {
    sway.push(h.pose.com(new Vector3()).x);
    breath.push(pitchOf(h.pose.rotation(INDEX.chest)));
    expect(h.locomotion.quiet.length()).toBeLessThan(0.02);
  });
  expect(body.holds(load)).toBe(true);
  expect(Math.max(...sway) - Math.min(...sway)).toBeGreaterThan(0.004);
  expect(Math.max(...breath) - Math.min(...breath)).toBeGreaterThan(0.02);
  expect(body.log).toEqual([]);
});

it('seeds the side of its first weight shift and alternates the later ones, after activity too', () => {
  for (const seed of [0, 1, 42]) {
    const life = new Quiet(seed);
    const shifts: Side[] = [];
    let previous: Side | null = null;
    for (let step = 0; step < 6000; step++) {
      life.update(0.1, step < 2000 || step >= 2100, 0, 0);
      if (life.onto && life.onto !== previous) shifts.push(life.onto);
      previous = life.onto;
    }
    expect(shifts.length).toBeGreaterThan(8);
    expect(shifts.every((side, i) => i === 0 || side !== shifts[i - 1])).toBe(true);
  }
});

it.each([1.6, 1.75, 1.85])('bends its knees for an 8 kg load taken low, on a %s m body', (height) => {
  const scale = height / 1.75;
  const body = person({ dev: true }, height), h = insides(body), room = roomOf(body);
  const load = box(room, new Vector3(0, 0.88 * scale, 0.45 * scale), { size: new Vector3(0.36 * scale, 0.2, 0.25), mass: 8, solid: false });
  let knee = NaN, pitch = NaN, drop = NaN;
  play(function* () {
    yield* grab(body, load, { left: 'left', right: 'right' });
  }, [body], 6, () => {
    // (judged as the hands close on it, before it is lifted)
    if (!Number.isNaN(knee) || !body.holds(load)) return;
    knee = (h.pose.local(INDEX.leftLowerLeg).angleTo(new Quaternion()) + h.pose.local(INDEX.rightLowerLeg).angleTo(new Quaternion())) * 90 / Math.PI;
    pitch = pitchOf(h.pose.rotation(INDEX.chest)) * 180 / Math.PI;
    drop = h.proportions.hipHeight - h.pose.position(0).y;
  });
  // Recalled: ≥10–15° knee flexion under load; derived from geometry: ~15–25° trunk flexion at a typical waist-height target, not a
  // measured universal limit. The stronger 20–30° knee bounds, 35° pitch ceiling and 1.5 cm drop below are tuned.
  expect(knee).toBeGreaterThanOrEqual(20);
  expect(knee).toBeLessThanOrEqual(30);
  expect(pitch).toBeGreaterThan(0.2 * 180 / Math.PI);
  expect(pitch).toBeLessThanOrEqual(35);
  expect(drop).toBeGreaterThan(0.015 * scale);
  expect(body.log).toEqual([]);
});

it('glances about on its own schedule: bodies without a seed do not look aside in step', () => {
  const headYaws = (at: Vector3) => {
    const body = person({ at }), h = insides(body), yaws: number[] = [];
    run(body, 20, () => yaws.push(yawOf(h.pose.rotation(INDEX.head))));
    return yaws;
  };
  const a = headYaws(new Vector3(0, 0, 0)), b = headYaws(new Vector3(3, 0, 1));
  expect(Math.max(...a.map((yaw, i) => Math.abs(yaw - b[i])))).toBeGreaterThan(0.2);
});

// (the trial that asked for it: soldiers at attention, scripted, who glanced about and shifted their weight like bystanders)
it.each([['the default person', 1.75], ['a 2.3 m skeleton', 0]])('holds still as its life asks, scripted: %s', (_name, height) => {
  const stood = (steady: number) => {
    const body = height ? person({ dev: true, life: { seed: 3, steady } }) : new Body(humanoid(CHEWBACCA), { dev: true, life: { seed: 3, steady } });
    const h = insides(body), yaws: number[] = [], xs: number[] = [];
    run(body, 40, (t) => {
      if (t < 2) return;
      yaws.push(yawOf(h.pose.rotation(INDEX.head)));
      xs.push(h.pose.com(new Vector3()).x);
    });
    const range = (values: number[]) => Math.max(...values) - Math.min(...values);
    return { glances: range(yaws), sway: range(xs), log: body.log };
  };
  const ease = stood(0), attention = stood(1), half = stood(0.5);
  // (at ease: glances up to 0.7 rad aside and weight shifts of several centimetres; at attention: eyes ahead, the weight where it is)
  expect(ease.glances).toBeGreaterThan(0.3);
  expect(attention.glances).toBeLessThan(0.05);
  expect(half.glances).toBeLessThan(0.6 * ease.glances);
  expect(ease.sway).toBeGreaterThan(0.03);
  expect(attention.sway).toBeLessThan(0.01);
  expect([...ease.log, ...attention.log, ...half.log]).toEqual([]);
}, 20000);

it('takes its steadiness as a function of its time, and says what it cannot take', () => {
  let asked = 0;
  const body = person({ dev: true, life: { steady: () => asked } });
  run(body, 1);
  asked = 2;
  expect(() => run(body, 0.1)).toThrow('life.steady 2');
  expect(() => new Body(dog(DOG), { life: { steady: 1 } })).toThrow("a person's");
});
