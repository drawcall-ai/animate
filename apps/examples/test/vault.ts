import { Vector3 } from 'three';
import type { Box } from '@prohuman/core';
import { jointOf } from '../src/joints';
import { FIXED_DT } from '../src/scenario';
import { depthIn, onTop, PARTS, type Part } from './climb';
import type { Frame } from './frame';

/** walls vaulted: tops beyond a step (× height) */
const LOW = 0.35;
/** a wrist this close above the top presses on it (m, default body) */
const PRESS = 0.07;

/** one vault's measures (m, s, m/s) */
export interface VaultMeasure {
  /** the hands on the top: first and last */
  plant: number;
  release: number;
  /** the feet: the last off the floor before, the first down after */
  takeoff: number;
  touchdown: number;
  /** the deepest each part reached into the wall */
  depth: Record<Part, number>;
  /** the soles' least clearance over the top while over it, and the hip joints' */
  feetOver: number;
  hipsOver: number;
  /** the horizontal speed before (1 s) and after (1 s) */
  speedIn: number;
  speedOut: number;
  /** the root's peak acceleration (m/s²) from takeoff to touchdown + 0.5 s */
  accel: number;
  accelAt: number;
}

interface Sample {
  t: number;
  hand: boolean;
  down: boolean;
  depth: Record<Part, number>;
  soles: Vector3[];
  hips: Vector3;
  root: Vector3;
}

/**
 * Vaults over walls (floor obstacles too tall to step over), of the first actor: nothing of the
 * body inside the wall, a hand on its top, the feet and hips clearing it, the speed carried
 * over, and a continuous root.
 */
export class Vaulting {
  private readonly samples: Sample[] = [];
  private wall: Box | null = null;
  private cached: VaultMeasure[] | null = null;

  see({ t, h, input }: Frame) {
    const H = h.proportions.height;
    const wall = (input.floorObstacles ?? []).find((o) => o.max.y > LOW * H);
    if (!wall || input.ground?.length) return;
    this.wall = wall;
    const j = (n: string) => jointOf(h, n);
    const depth = {} as Record<Part, number>;
    for (const k of Object.keys(PARTS) as Part[]) {
      const { r, joints } = PARTS[k];
      // (the hands press on it)
      depth[k] = k === 'hand' ? 0 : Math.max(...joints.map((n) => depthIn(wall, j(n)) + r * H));
    }
    this.samples.push({
      t,
      hand: (['left', 'right'] as const).some((s) => onTop(wall, j(`${s}Hand`), PRESS * h.proportions.scale)),
      down: h.feet.some((f) => f.phase === 'planted'),
      depth,
      soles: PARTS.sole.joints.map((n) => j(n)),
      hips: j('leftUpperLeg').add(j('rightUpperLeg')).multiplyScalar(0.5),
      root: h.model.scene.position.clone(),
    });
    this.cached = null;
  }

  get vaults(): VaultMeasure[] {
    this.cached ??= this.measure();
    return this.cached;
  }

  private measure(): VaultMeasure[] {
    const S = this.samples;
    const o = this.wall;
    const plant = S.findIndex((s) => s.hand);
    if (!o || plant < 0) return [];
    let release = plant;
    while (release + 1 < S.length && S[release + 1].hand) release++;
    let takeoff = plant;
    while (takeoff > 0 && !S[takeoff].down) takeoff--;
    let touchdown = release;
    while (touchdown < S.length - 1 && !S[touchdown].down) touchdown++;
    const over = (p: Vector3) => p.x >= o.min.x && p.x <= o.max.x && p.z >= o.min.z && p.z <= o.max.z;
    let feetOver = Infinity;
    let hipsOver = Infinity;
    for (const s of S) {
      for (const p of s.soles) if (over(p)) feetOver = Math.min(feetOver, p.y - o.max.y);
      if (over(s.hips)) hipsOver = Math.min(hipsOver, s.hips.y - o.max.y);
    }
    // (a hand on it but the body not over it: no vault)
    if (hipsOver === Infinity) return [];
    const depth = {} as Record<Part, number>;
    for (const p of Object.keys(PARTS) as Part[]) depth[p] = Math.max(...S.map((s) => s.depth[p]));
    const speed = (a: number, b: number) => S[b].root.clone().sub(S[a].root).setY(0).length() / (S[b].t - S[a].t);
    const n = Math.round(1 / FIXED_DT);
    let accel = 0;
    let accelAt = 0;
    for (let k = Math.max(2, takeoff); k < Math.min(S.length, touchdown + n / 2); k++) {
      const a = S[k].root.clone().sub(S[k - 1].root).sub(S[k - 1].root).add(S[k - 2].root).length() / FIXED_DT ** 2;
      if (a > accel) [accel, accelAt] = [a, S[k].t];
    }
    return [
      {
        plant: S[plant].t,
        release: S[release].t,
        takeoff: S[takeoff].t,
        touchdown: S[touchdown].t,
        depth,
        feetOver,
        hipsOver,
        speedIn: speed(Math.max(0, takeoff - n), takeoff),
        speedOut: speed(touchdown, Math.min(S.length - 1, touchdown + n)),
        accel,
        accelAt,
      },
    ];
  }

  toString() {
    const cm = (m: number) => (m * 100).toFixed(1);
    return (
      this.vaults
        .map(
          (v) =>
            `vault: takeoff ${v.takeoff.toFixed(2)} s, hand on the top ${v.plant.toFixed(2)}–${v.release.toFixed(2)} s, touchdown ${v.touchdown.toFixed(2)} s; ` +
            `deepest into the wall: ${Object.entries(v.depth).map(([k, d]) => `${k} ${cm(d)}`).join(', ')} cm; over the top: soles ${cm(v.feetOver)}, hips ${cm(v.hipsOver)} cm; ` +
            `speed ${v.speedIn.toFixed(2)} → ${v.speedOut.toFixed(2)} m/s; root peak ${v.accel.toFixed(1)} m/s² @${v.accelAt.toFixed(2)}s`,
        )
        .join('\n') || 'vaults: none'
    );
  }
}
