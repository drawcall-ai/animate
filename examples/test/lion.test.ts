import { Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { selfOf } from '../../packages/animate/src/body/body';
import { lionRun } from '../src/scenarios/lion';
import { Simulation } from '../src/simulation';

const DEG = Math.PI / 180;

it('walks, trots and gallops after its prey — a rotary gallop, two flights a stride, its spine flexing and its head held level — then stops', () => {
  const sim = new Simulation(lionRun(), { dev: true });
  const [lion] = sim.stage.bodies;
  const bone = (name: string) => lion.pose.skeleton.index(name);
  const spine = bone('spine'), pelvis = bone('pelvis'), head = bone('head'), tail = bone('tail'), withersAt = bone('leftFore0');
  const paws = lion.species.legs!.chains.map((leg) => leg.joints[3].bone), standing = lion.pose.position(paws[0]).y;
  const down = (paw: number) => lion.pose.position(paw).y < standing + 5e-4;
  // (the pace its legs run it at: its walk's, not its centre of mass's, which rides on its strides)
  const paceOf = () => selfOf(lion).locomotion.velocity.length();
  let was = paws.map(down), fastest = 0, lastSpeed = 0;
  const landed: [time: number, speed: number][][] = paws.map(() => []);
  const gallop: { time: number; down: boolean[]; flex: number; pelvis: number; tail: number; head: number; withers: number }[] = [];
  const pitch = (index: number) => new Euler().setFromQuaternion(lion.pose.rotation(index), 'YXZ').x / DEG;
  // (its centre of mass's height, its trunk's pitch, whether its legs stand as they step)
  const riding: Record<'trot' | 'gallop', { time: number; com: number; pitch: number; head: number; up: boolean; lands: boolean }[]> = { trot: [], gallop: [] };
  const speedingUp: number[] = [];
  let stood = [true, true, true, true];
  while (sim.t < sim.scenario.duration && !sim.stage.done()) {
    sim.step();
    const time = sim.t, speed = paceOf(), now = paws.map(down);
    fastest = Math.max(fastest, speed);
    now.forEach((isDown, leg) => { if (isDown && !was[leg]) landed[leg].push([time, speed]); });
    was = now;
    if (speed > 13.5) gallop.push({ time, down: now, flex: new Euler().setFromQuaternion(lion.pose.local(spine), 'YXZ').x / DEG,
      pelvis: pitch(pelvis), tail: pitch(tail), head: lion.pose.position(head).y, withers: lion.pose.position(withersAt).y });
    const stands = lion.feet.map((foot) => foot.planted);
    const band = speed > 3.3 && speed < 3.6 ? 'trot' : speed > 13.5 && time > (gallop[0]?.time ?? Infinity) + 0.5 ? 'gallop' : null;
    if (band) riding[band].push({ time, com: lion.pose.com(new Vector3()).y, pitch: pitch(0), head: pitch(head), up: stands.every((planted) => !planted), lands: stands[1] && !stood[1] });
    stood = stands;
    if (speed > 4 && speed < 13 && speed - lastSpeed > 1e-3) speedingUp.push(pitch(0));
    lastSpeed = speed;
  }
  expect(sim.stage.done()).toBe(true);
  expect(lion.log).toEqual([]);
  expect(paceOf()).toBe(0);
  expect(fastest).toBeGreaterThan(13.9);

  // (trotting: each fore paw lands with the hind paw across from it — on the way up to the gallop: slowing from it, the footfalls shift
  // back over a stride or two, their diagonals not yet together)
  const before = gallop[0]?.time ?? Infinity;
  const landings = (leg: number, slow: number, fast: number) => landed[leg].filter(([time, speed]) => speed > slow && speed < fast && time < before).map(([time]) => time);
  for (const [fore, hind] of [[0, 3], [1, 2]]) {
    expect(landings(fore, 3.2, 3.8).length).toBeGreaterThan(4);
    for (const time of landings(fore, 3.2, 3.8)) expect(Math.min(...landed[hind].map(([other]) => Math.abs(other - time)))).toBeLessThan(0.05);
  }

  // (galloping at full speed: a rotary gallop leading with the left fore — right fore, left fore, left hind, right hind — the paws down a
  // fifth of the stride [Hudson et al. 2012: a cheetah's 0.2–0.3 at 9–18 m/s], a stride ~3 a second)
  const full = gallop.filter(({ time }) => time > gallop[0].time + 0.5);
  const names = ['LF', 'RF', 'LH', 'RH'], within = (time: number) => time > full[0].time && time < full[full.length - 1].time;
  const order = names.flatMap((name, leg) => landed[leg].filter(([time]) => within(time)).map(([time]) => [time, name] as const)).sort((a, b) => a[0] - b[0]).map(([, name]) => name).join(' ');
  const strides = landed[1].filter(([time]) => within(time)).length;
  expect(order.split('RF LF LH RH').length - 1).toBeGreaterThanOrEqual(strides - 1);
  const period = (full[full.length - 1].time - full[0].time) / strides;
  expect(1 / period).toBeGreaterThan(2.5); expect(1 / period).toBeLessThan(3.5);
  for (const leg of [0, 1, 2, 3]) {
    const duty = full.filter((sample) => sample.down[leg]).length / full.length;
    expect(duty).toBeGreaterThan(0.15); expect(duty).toBeLessThan(0.3);
  }
  // (two flights a stride: gathered, the fore paws up before the hinds land, and extended, the hinds up before the fores land)
  const flights = full.filter((sample, k) => k > 0 && sample.down.every((isDown) => !isDown) && full[k - 1].down.some((isDown) => isDown));
  expect(flights.length / strides).toBeGreaterThan(1.8); expect(flights.length / strides).toBeLessThan(2.2);
  const lastDown = (k: number) => { while (k > 0 && full[k].down.every((isDown) => !isDown)) k--; return full[k].down; };
  const kinds = flights.map((sample) => lastDown(full.indexOf(sample)).slice(0, 2).some((isDown) => isDown) ? 'gathered' : 'extended');
  expect(kinds.filter((kind) => kind === 'gathered').length / strides).toBeGreaterThan(0.9);
  expect(kinds.filter((kind) => kind === 'extended').length / strides).toBeGreaterThan(0.9);
  // (the spine flexes and extends ±12° a stride, extended in the extended flight, flexed in the gathered one)
  const range = (a: number[]) => Math.max(...a) - Math.min(...a), mean = (a: number[]) => a.reduce((sum, x) => sum + x, 0) / a.length;
  expect(range(full.map((sample) => sample.flex))).toBeGreaterThan(20);
  const flexIn = (kind: string) => mean(flights.filter((_, k) => kinds[k] === kind).map((sample) => sample.flex));
  expect(flexIn('extended')).toBeGreaterThan(5); expect(flexIn('gathered')).toBeLessThan(-5);
  // (the head held level as the withers rise and fall; the tail swinging against the croup)
  expect(range(full.map((sample) => sample.head))).toBeLessThan(0.02);
  expect(range(full.map((sample) => sample.head))).toBeLessThan(0.3 * range(full.map((sample) => sample.withers)));
  const croup = mean(full.map((sample) => sample.pelvis)), swung = mean(full.map((sample) => sample.tail - sample.pelvis));
  expect(mean(full.map((sample) => (sample.pelvis - croup) * (sample.tail - sample.pelvis - swung)))).toBeLessThan(0);

  // (riding its legs' push, trotting and galloping: its centre of mass falls as in flight while all four feet are off the floor — on the
  // whole: the legs' own swing, a third of its mass, moves it too — and rises and falls a few centimetres a stride — a cheetah's 5.7 ±
  // 1.2 cm at 15–18 m/s, a Thoroughbred's 8.3 cm at 17 m/s [read: PMC9049215; Pfau et al. 2006, J Exp Biol 209:3742]; galloping its trunk
  // pitches with the fores' and the hinds' pushes in turn — a cheetah's 11.5°, a Thoroughbred's 19° — its head pitching no more than a
  // third of that [read: a cheetah's 0.37, bioRxiv 2026.09.03.748592])
  for (const [band, rows] of Object.entries(riding)) {
    const starts = rows.flatMap((row, k) => row.lands && k > 0 && row.time - rows[k - 1].time < 0.02 ? [k] : []);
    const each = starts.slice(1).map((end, k) => rows.slice(starts[k], end)).filter((stride) => stride[stride.length - 1].time - stride[0].time < 1);
    // (each stride as the 60 Hz sub-steps sample it: a 0.05 s stance's lowest is caught or not)
    const rises = each.map((stride) => range(stride.map((row) => row.com)));
    expect(rises.length, band).toBeGreaterThanOrEqual(3);
    expect(mean(rises), band).toBeGreaterThan(0.03); expect(Math.max(...rises), band).toBeLessThan(0.09);
    expect(Math.min(...rises), band).toBeGreaterThan(0.02);
    const falling = rows.flatMap((row, k) => k > 0 && k < rows.length - 1 && [rows[k - 1], row, rows[k + 1]].every((near) => near.up) && rows[k + 1].time - rows[k - 1].time < 0.04
      ? [(rows[k + 1].com - 2 * row.com + rows[k - 1].com) * 3600] : []);
    expect(falling.length, band).toBeGreaterThan(20);
    expect(mean(falling), band).toBeLessThan(-0.75 * 9.81); expect(mean(falling), band).toBeGreaterThan(-1.25 * 9.81);
    if (band !== 'gallop') continue;
    for (const stride of each) {
      expect(range(stride.map((row) => row.pitch))).toBeGreaterThan(8); expect(range(stride.map((row) => row.pitch))).toBeLessThan(20);
      expect(range(stride.map((row) => row.head))).toBeLessThan(0.37 * range(stride.map((row) => row.pitch)));
    }
  }
  // (speeding up, it pitches head-end down into its acceleration [read: Walter & Carrier 2009, a dog setting off])
  expect(mean(speedingUp)).toBeGreaterThan(2);
});
