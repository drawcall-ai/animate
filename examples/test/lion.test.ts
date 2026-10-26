import { Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { Stepper } from '../../packages/animate/src/core/legs/stepper';
import { lionRun } from '../src/scenarios/lion';

it('a lion made of data only walks, trots and gallops after its prey — a rotary gallop, two flights a stride, its spine flexing and its head held level — then stops', () => {
  const scenario = lionRun(), stage = scenario.stage(true);
  const [lion] = stage.bodies ?? [];
  const s = lion.pose.skeleton, [spine, pelvis, head, tail, withersAt] = ['spine', 'pelvis', 'head', 'tail', 'leftFore0'].map((name) => s.index(name));
  const paws = lion.species.legs!.chains.map((leg) => leg.joints[3].bone), standing = lion.pose.position(paws[0]).y;
  const down = (paw: number) => lion.pose.position(paw).y < standing + 5e-4;
  let was = paws.map(down), fastest = 0, speed0 = 0;
  const landed: [time: number, speed: number][][] = paws.map(() => []);
  const gallop: { time: number; down: boolean[]; flex: number; pelvis: number; tail: number; head: number; withers: number }[] = [];
  const pitch = (bone: number) => new Euler().setFromQuaternion(lion.pose.rotation(bone), 'YXZ').x / DEG;
  // (the whole body's centre of mass, its bones' masses where they are; its trunk's pitch; whether its legs stand, as they step)
  const com = () => s.bones.reduce((sum, bone, i) => sum + bone.mass * lion.pose.point(i, bone.com, _v).y, 0) / s.bones.reduce((sum, bone) => sum + bone.mass, 0);
  const riding: Record<'trot' | 'gallop', { time: number; com: number; pitch: number; head: number; up: boolean; lands: boolean }[]> = { trot: [], gallop: [] };
  const speedingUp: number[] = [];
  let stood = [true, true, true, true];
  for (let i = 0; i < scenario.duration * 60 && !stage.done(); i++) {
    lion.update(1 / 60);
    const t = lion.frame.time, speed = lion.locomotion.velocity.length(), now = paws.map(down);
    fastest = Math.max(fastest, speed);
    now.forEach((d, leg) => { if (d && !was[leg]) landed[leg].push([t, speed]); });
    was = now;
    if (speed > 13.5) gallop.push({ time: t, down: now, flex: new Euler().setFromQuaternion(lion.pose.local(spine), 'YXZ').x / DEG,
      pelvis: pitch(pelvis), tail: pitch(tail), head: lion.pose.position(head).y, withers: lion.pose.position(withersAt).y });
    const stands = (lion.stepper as Stepper).legs.map((leg) => !leg.swing), band = speed > 3.3 && speed < 3.6 ? 'trot' : speed > 13.5 && t > (gallop[0]?.time ?? Infinity) + 0.5 ? 'gallop' : null;
    if (band) riding[band].push({ time: t, com: com(), pitch: pitch(0), head: pitch(head), up: stands.every((d) => !d), lands: stands[1] && !stood[1] });
    stood = stands;
    if (speed > 4 && speed < 13 && speed - speed0 > 1e-3) speedingUp.push(pitch(0));
    speed0 = speed;
  }
  expect(stage.done()).toBe(true);
  expect(lion.log).toEqual([]);
  expect(lion.locomotion.velocity.length()).toBe(0);
  expect(fastest).toBeGreaterThan(13.9);

  // (trotting: each fore paw lands with the hind paw across from it — on the way up to the gallop: slowing from it, the footfalls shift
  // back over a stride or two, `SHIFT`, its diagonals not yet together)
  const before = gallop[0]?.time ?? Infinity;
  const at = (leg: number, slow: number, fast: number) => landed[leg].filter(([t, v]) => v > slow && v < fast && t < before).map(([t]) => t);
  for (const [fore, hind] of [[0, 3], [1, 2]]) {
    expect(at(fore, 3.2, 3.8).length).toBeGreaterThan(4);
    for (const t of at(fore, 3.2, 3.8)) expect(Math.min(...landed[hind].map(([u]) => Math.abs(u - t)))).toBeLessThan(0.05);
  }

  // (galloping at full speed: a rotary gallop leading with the left fore — right fore, left fore, left hind, right hind — the paws down a
  // fifth of the stride [Hudson et al. 2012: a cheetah's 0.2–0.3 at 9–18 m/s], a stride ~3 a second)
  const full = gallop.filter(({ time }) => time > gallop[0].time + 0.5);
  const names = ['LF', 'RF', 'LH', 'RH'], within = (t: number) => t > full[0].time && t < full[full.length - 1].time;
  const order = names.flatMap((name, leg) => landed[leg].filter(([t]) => within(t)).map(([t]) => [t, name] as const)).sort((a, b) => a[0] - b[0]).map(([, name]) => name).join(' ');
  const strides = landed[1].filter(([t]) => within(t)).length;
  expect(order.split('RF LF LH RH').length - 1).toBeGreaterThanOrEqual(strides - 1);
  const period = (full[full.length - 1].time - full[0].time) / strides;
  expect(1 / period).toBeGreaterThan(2.5); expect(1 / period).toBeLessThan(3.5);
  for (const leg of [0, 1, 2, 3]) {
    const duty = full.filter((g) => g.down[leg]).length / full.length;
    expect(duty).toBeGreaterThan(0.15); expect(duty).toBeLessThan(0.3);
  }
  // (two flights a stride: gathered, the fore paws up before the hinds land, and extended, the hinds up before the fores land)
  const flights = full.filter((g, k) => k > 0 && g.down.every((d) => !d) && full[k - 1].down.some((d) => d));
  expect(flights.length / strides).toBeGreaterThan(1.8); expect(flights.length / strides).toBeLessThan(2.2);
  const last = (k: number) => { while (k > 0 && full[k].down.every((d) => !d)) k--; return full[k].down; };
  const kinds = flights.map((g) => last(full.indexOf(g)).slice(0, 2).some((d) => d) ? 'gathered' : 'extended');
  expect(kinds.filter((k) => k === 'gathered').length / strides).toBeGreaterThan(0.9);
  expect(kinds.filter((k) => k === 'extended').length / strides).toBeGreaterThan(0.9);
  // (the spine flexes and extends ±12° a stride, extended in the extended flight, flexed in the gathered one)
  const range = (a: number[]) => Math.max(...a) - Math.min(...a), mean = (a: number[]) => a.reduce((sum, x) => sum + x, 0) / a.length;
  expect(range(full.map((g) => g.flex))).toBeGreaterThan(20);
  const flexIn = (kind: string) => mean(flights.filter((_, k) => kinds[k] === kind).map((g) => g.flex));
  expect(flexIn('extended')).toBeGreaterThan(5); expect(flexIn('gathered')).toBeLessThan(-5);
  // (the head held level as the withers rise and fall; the tail swinging against the croup)
  expect(range(full.map((g) => g.head))).toBeLessThan(0.02);
  expect(range(full.map((g) => g.head))).toBeLessThan(0.3 * range(full.map((g) => g.withers)));
  const p = mean(full.map((g) => g.pelvis)), q = mean(full.map((g) => g.tail - g.pelvis));
  expect(mean(full.map((g) => (g.pelvis - p) * (g.tail - g.pelvis - q)))).toBeLessThan(0);

  // (riding its legs' push, trotting and galloping: its centre of mass falls as in flight while all four feet are off the floor — on the
  // whole: the legs' own swing, a third of its mass, moves it too — and rises and falls a few centimetres a stride — a cheetah's 5.7 ±
  // 1.2 cm at 15–18 m/s, a Thoroughbred's 8.3 cm at 17 m/s [read: PMC9049215; Pfau et al. 2006, J Exp Biol 209:3742]; galloping its trunk pitches with the fores' and the hinds' pushes in turn — a cheetah's 11.5°,
  // a Thoroughbred's 19° — its head pitching no more than a third of that [read: a cheetah's 0.37, bioRxiv 2026.09.03.748592])
  for (const [band, rows] of Object.entries(riding)) {
    const starts = rows.flatMap((row, k) => row.lands && k > 0 && row.time - rows[k - 1].time < 0.02 ? [k] : []);
    const each = starts.slice(1).map((end, k) => rows.slice(starts[k], end)).filter((stride) => stride[stride.length - 1].time - stride[0].time < 1);
    // (each stride as the 60 Hz sub-steps sample it: a 0.05 s stance's lowest is caught or not)
    const rises = each.map((stride) => range(stride.map((r) => r.com)));
    expect(rises.length, band).toBeGreaterThanOrEqual(3);
    expect(mean(rises), band).toBeGreaterThan(0.03); expect(Math.max(...rises), band).toBeLessThan(0.09);
    expect(Math.min(...rises), band).toBeGreaterThan(0.02);
    const falling = rows.flatMap((r, k) => k > 0 && k < rows.length - 1 && [rows[k - 1], r, rows[k + 1]].every((n) => n.up) && rows[k + 1].time - rows[k - 1].time < 0.04
      ? [(rows[k + 1].com - 2 * r.com + rows[k - 1].com) * 3600] : []);
    expect(falling.length, band).toBeGreaterThan(20);
    expect(mean(falling), band).toBeLessThan(-0.75 * 9.81); expect(mean(falling), band).toBeGreaterThan(-1.25 * 9.81);
    if (band !== 'gallop') continue;
    for (const stride of each) {
      expect(range(stride.map((r) => r.pitch))).toBeGreaterThan(8); expect(range(stride.map((r) => r.pitch))).toBeLessThan(20);
      expect(range(stride.map((r) => r.head))).toBeLessThan(0.37 * range(stride.map((r) => r.pitch)));
    }
  }
  // (speeding up, it pitches head-end down into its acceleration [read: Walter & Carrier 2009, a dog setting off])
  expect(mean(speedingUp)).toBeGreaterThan(2);
});

const DEG = Math.PI / 180;
const _v = new Vector3();
