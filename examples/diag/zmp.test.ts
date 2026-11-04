import { Vector3 } from 'three';
import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/simulation';
import { hullOf, nearest } from '../../packages/animate/src/core/polygon';

const id = process.env.SC ?? 'stroll';
it('zmp', () => {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation(sc);
  const h = sim.actors[0] as any;
  const sk = h.rig.skeleton;
  const g = 9.81;
  const hist: Vector3[][] = [];
  const offs: number[] = [];
  const lipm: number[] = [];
  while (sim.t < sc.duration) {
    sim.step();
    const s = h.state;
    hist.push(sk.bones.map((b: any, i: number) => s.point({ bone: i, at: b.com }, new Vector3())));
    if (hist.length < 3) continue;
    const [a0, a1, a2] = hist.slice(-3);
    const m = h.body.merged;
    const sup = m.contacts.filter((c: any) => (c.support ?? 0) > 0);
    if (!sup.length) continue;
    const pts = sup.flatMap((c: any) => c.footprint ?? []);
    if (!pts.length) continue;
    const ys = pts.reduce((t: number, p: Vector3) => t + p.y, 0) / pts.length;
    let num = [0, 0], den = 0, M = 0;
    const cx = [0,0,0], ca=[0,0,0];
    sk.bones.forEach((b: any, i: number) => {
      const x = a1[i];
      const acc = a2[i].clone().sub(a1[i].clone().multiplyScalar(2)).add(a0[i]).multiplyScalar(3600);
      const mi = b.mass;
      num[0] += mi * ((acc.y + g) * x.x - acc.x * (x.y - ys));
      num[1] += mi * ((acc.y + g) * x.z - acc.z * (x.y - ys));
      den += mi * (acc.y + g);
      M += mi; cx[0]+=mi*x.x; cx[1]+=mi*x.y; cx[2]+=mi*x.z; ca[0]+=mi*acc.x; ca[1]+=mi*acc.y; ca[2]+=mi*acc.z;
    });
    const zmp: [number, number] = [num[0] / den, num[1] / den];
    const hull = hullOf(pts.map((p: Vector3) => [p.x, p.z] as [number, number]));
    const n = nearest(hull, zmp, [0, 0]);
    offs.push(Math.hypot(zmp[0] - n[0], zmp[1] - n[1]));
    // lumped (LIPM) zmp
    const c = cx.map(v=>v/M), a = ca.map(v=>v/M);
    const lz: [number, number] = [c[0] - a[0]*(c[1]-ys)/(a[1]+g), c[2] - a[2]*(c[1]-ys)/(a[1]+g)];
    const n2 = nearest(hull, lz, [0, 0]);
    lipm.push(Math.hypot(lz[0] - n2[0], lz[1] - n2[1]));
  }
  const st = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return `n ${a.length} p50 ${a[a.length*0.5|0].toFixed(3)} p90 ${a[a.length*0.9|0].toFixed(3)} p99 ${a[a.length*0.99|0].toFixed(3)} max ${a[a.length-1].toFixed(3)} >2cm ${(100*a.filter(x=>x>0.02).length/a.length).toFixed(1)}%`; };
  console.log('ZMP out of support (multibody):', st(offs));
  console.log('ZMP out of support (lumped)   :', st(lipm));
});
