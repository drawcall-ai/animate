import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, dog, grab, humanoid, lookAt, reach } from '../../src/index';
import { DOG } from '../../skills/animate/references/dog';
import { INDEX, SIDES, readings, person, play, run } from '../kit/bodies';
import { CHEWBACCA } from '../kit/skeletons/chewbacca';
import { TROOPER } from '../kit/skeletons/trooper';
import { box, roomOf } from '../kit/things';

const pitchOf = (rotation: Quaternion) => new Euler().setFromQuaternion(rotation, 'YXZ').x;
const yawOf = (rotation: Quaternion) => new Euler().setFromQuaternion(rotation, 'YXZ').y;


it.each(['an across-body reach', 'an over-shoulder look'])('turns the trunk on the hips for %s within its range, and back after', (what) => {
  const body = person({ dev: true }), h = readings(body);
  const twist = () => Math.abs(yawOf(h.pose.rotation(INDEX.chest)) - yawOf(h.pose.rotation(INDEX.hips)));
  let most = 0;
  play(function* () {
    if (what === 'an over-shoulder look') yield* lookAt(body, new Vector3(-2, 1.4, -1), { until: 3 });
    // (across to a point the right hand reaches twisted: one further across stops short, beyond the arm, and the reach fails)
    else yield* reach(body, { right: new Vector3(0.3, 1.2, 0.25) }, { until: 3 });
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
  const body = new Body(humanoid(CHEWBACCA), { dev: true, at: new Vector3(1.1, 0, 10) }), h = readings(body);
  let straightest = Infinity;
  const up = [false, false];
  run(body, 25, () => {
    body.feet.forEach((foot, i) => {
      const landed = foot.planted && up[i];
      up[i] = !foot.planted;
      if (!landed) return;
      const side = SIDES[i], hip = h.pose.position(INDEX[`${side}UpperLeg`]), knee = h.pose.position(INDEX[`${side}LowerLeg`]), ankle = h.pose.position(INDEX[`${side}Foot`]);
      straightest = Math.min(straightest, knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)));
    });
  });
  expect(straightest).toBeGreaterThan(0.05);
  expect(body.log).toEqual([]);
});

it.each([0, 1, 2])('keeps its loaded foot down through its weight shifts, standing 40 s on its feet under its hips (life seed %i)', (seed) => {
  // (the trooper's feet stand right under its hips: shifted onto one, the hips are over it; lifted, the body stood on the other alone)
  const body = new Body(humanoid(TROOPER), { dev: true, life: { seed } });
  let lifted = 0;
  run(body, 40, () => { lifted += Number(body.feet.some((foot) => !foot.planted)); });
  expect(lifted).toBe(0);
  expect(body.log).toEqual([]);
});




it.each([1.6, 1.75, 1.85])('bends its knees for an 8 kg load taken low, on a %s m body', (height) => {
  const scale = height / 1.75;
  const body = person({ dev: true }, height), h = readings(body), room = roomOf(body);
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

// (the trial that asked for it: soldiers at attention, scripted, who glanced about and shifted their weight like bystanders)
it.each([['the default person', 1.75], ['a 2.3 m skeleton', 0]])('holds still as its life asks, scripted: %s', (_name, height) => {
  const stood = (steady: number) => {
    const body = height ? person({ dev: true, life: { seed: 3, steady } }) : new Body(humanoid(CHEWBACCA), { dev: true, life: { seed: 3, steady } });
    const h = readings(body), yaws: number[] = [], xs: number[] = [];
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
});

it('takes its steadiness as a function of its time, and says what it cannot take', () => {
  let asked = 0;
  const body = person({ dev: true, life: { steady: () => asked } });
  run(body, 1);
  asked = 2;
  expect(() => run(body, 0.1)).toThrow('life.steady 2');
  expect(() => new Body(dog(DOG), { life: { steady: 1 } })).toThrow("a person's");
});
