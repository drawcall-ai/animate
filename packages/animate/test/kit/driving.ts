import { Vector3, type Object3D } from 'three';
import type { Body, Floor, Root } from '../../src/index';
import { dt, feetOf, person, readings, run, type Readings } from './bodies';

/** a driven root, as a player's controller writes it */
type Driving = Root & { velocity: Vector3; crouch: number };

/** A player-like root: velocity eased at 10 m/s², facing eased over 25 ms, as a game controller drives it. */
export function drive(T: number, velocity: (t: number) => Vector3, yaw: (t: number) => number = () => 0, each?: (t: number, root: Driving, h: Readings, body: Body) => void) {
  const root: Driving = { position: new Vector3(), velocity: new Vector3(), yaw: 0, crouch: 0 };
  const body = person({ drive: () => root, dev: true }), h = readings(body);
  let apart = 0, steps = 0;
  const phases = feetOf(h).map((foot) => foot.phase);
  for (let t = dt; t <= T + 1e-9; t += dt) {
    root.velocity.add(velocity(t).sub(root.velocity).clampLength(0, 10 * dt));
    root.position.addScaledVector(root.velocity, dt);
    root.yaw += (yaw(t) - root.yaw) * (1 - Math.exp(-dt / 0.025));
    body.update(dt);
    each?.(t, root, h, body);
    // (the hips about the root: swaying over the stance foot, shifted fore and aft as the trunk nods)
    const hips = h.pose.position(0);
    apart = Math.max(apart, Math.hypot(hips.x - root.position.x, hips.z - root.position.z));
    feetOf(h).forEach((foot, s) => { if (foot.phase === 'swing' && phases[s] === 'planted') steps++; phases[s] = foot.phase; });
  }
  return { h, apart, steps, root };
}

export const moving = (from: number, to: number, v: Vector3) => (t: number) => t > from && t < to ? v.clone() : new Vector3();

/** a person driven at `at` on `floor`, stood a second */
export function driven(floor: Floor = () => 0, at = new Vector3(0, floor(0, 0), 0), platform?: Object3D) {
  const root: Root & { velocity: Vector3 } = { position: at.clone(), velocity: new Vector3(), yaw: 0, support: at.clone(), platform };
  const body = person({ at: root.position.clone(), floor, drive: () => root, dev: true, life: { steady: 1 } });
  const h = readings(body);
  run(body, 1);
  return { root, body, h, floor };
}

/** Physics' jump: the root flies from `velocity` under `gravity` till it comes down on its floor, standing no further than `edge` (m) off
 * x = 0; `each` after every sub-step. */
export function jump({ root, body, floor }: ReturnType<typeof driven>, velocity: Vector3, gravity: number, edge = Infinity, each = () => {}) {
  root.support = null;
  root.velocity.copy(velocity);
  do {
    root.velocity.y -= gravity * dt;
    root.position.addScaledVector(root.velocity, dt);
    const x = Math.min(root.position.x, edge), level = floor(x, root.position.z);
    if (root.velocity.y < 0 && root.position.y <= level) {
      root.position.y = level;
      root.velocity.y = 0;
      root.support = root.position.clone().setX(x);
    }
    body.update(dt);
    each();
  } while (!root.support);
}

/** the hips' sway about the root at most (m): recalled (Orendurff et al. 2004), the pelvis sways 3–5 cm peak to peak walking */
export const SWAY_BAND = 0.025;
