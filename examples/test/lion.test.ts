import { Euler } from 'three';
import { expect, it } from 'vitest';
import { lionRun } from '../src/scenarios/lion';

it('a lion made of data only walks, trots and gallops after its prey — a rotary gallop, two flights a stride, its spine flexing and its head held level — then stops', () => {
  const scenario = lionRun(), stage = scenario.stage(true);
  const [lion] = stage.bodies ?? [];
  const s = lion.pose.skeleton, [spine, pelvis, head, tail, withersAt] = ['spine', 'pelvis', 'head', 'tail', 'leftFore0'].map((name) => s.index(name));
  const paws = lion.species.legs!.chains.map((leg) => leg.joints[3].bone), standing = lion.pose.position(paws[0]).y;
  const down = (paw: number) => lion.pose.position(paw).y < standing + 5e-4;
  let was = paws.map(down), fastest = 0;
  const landed: [time: number, speed: number][][] = paws.map(() => []);
  const gallop: { time: number; down: boolean[]; flex: number; pelvis: number; tail: number; head: number; withers: number }[] = [];
  const pitch = (bone: number) => new Euler().setFromQuaternion(lion.pose.rotation(bone), 'YXZ').x / DEG;
  for (let i = 0; i < scenario.duration * 60 && !stage.done(); i++) {
    lion.update(1 / 60);
    const t = lion.frame.time, speed = lion.locomotion.velocity.length(), now = paws.map(down);
    fastest = Math.max(fastest, speed);
    now.forEach((d, leg) => { if (d && !was[leg]) landed[leg].push([t, speed]); });
    was = now;
    if (speed > 13.5) gallop.push({ time: t, down: now, flex: new Euler().setFromQuaternion(lion.pose.local(spine), 'YXZ').x / DEG,
      pelvis: pitch(pelvis), tail: pitch(tail), head: lion.pose.position(head).y, withers: lion.pose.position(withersAt).y });
  }
  expect(stage.done()).toBe(true);
  expect(lion.log).toEqual([]);
  expect(lion.locomotion.velocity.length()).toBe(0);
  expect(fastest).toBeGreaterThan(13.9);

  // (trotting: each fore paw lands with the hind paw across from it)
  const at = (leg: number, slow: number, fast: number) => landed[leg].filter(([, v]) => v > slow && v < fast).map(([t]) => t);
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
});

const DEG = Math.PI / 180;
