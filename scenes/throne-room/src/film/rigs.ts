import { Vector3, type Object3D } from 'three';
import type { Body } from '@drawcall/animate';
import type { Framing, Rig } from './camera';

// Ways to frame subjects for the story camera, each from where its subjects are drawn this frame (bones' world positions, which include
// the floor's raise), so a shot follows the motion.

/** where `node` is drawn now (into `out`) */
export function placeOf(node: Object3D, out = new Vector3()): Vector3 {
  return node.getWorldPosition(out);
}

/** the middle of several bones as drawn now (into `out`) */
export function middleOf(nodes: readonly Object3D[], out = new Vector3()): Vector3 {
  out.set(0, 0, 0);
  const at = new Vector3();
  for (const node of nodes) out.add(node.getWorldPosition(at));
  return out.divideScalar(nodes.length);
}

/** a fixed camera: from `eye`, looking at `at` */
export function fixed(eye: readonly [number, number, number], at: readonly [number, number, number], fov: number): Rig {
  return (out) => {
    out.eye.set(...eye);
    out.at.set(...at);
    out.fov = fov;
    return out;
  };
}

/** a fixed camera looking at a moving subject (a pan that follows it): from `eye`, at `subject()` raised by `up` */
export function panning(eye: readonly [number, number, number], subject: (out: Vector3) => Vector3, fov: number, up = 0): Rig {
  return (out) => {
    out.eye.set(...eye);
    subject(out.at).y += up;
    out.fov = fov;
    return out;
  };
}

/**
 * a camera that travels with a subject (a tracking shot): its eye at `offset` from the subject (world axes, m) and its aim at `aim` from
 * it; `subject` is read each frame
 */
export function tracking(subject: (out: Vector3) => Vector3, offset: readonly [number, number, number], aim: readonly [number, number, number], fov: number): Rig {
  const base = new Vector3();
  return (out) => {
    subject(base);
    out.eye.set(...offset).add(base);
    out.at.set(...aim).add(base);
    out.fov = fov;
    return out;
  };
}

/**
 * a camera on `body`'s face: `distance` m from its head along the way it faces turned by `around` (rad, + to its left), `up` m above
 * the eyes, looking at the head raised by `lift`
 */
export function onFace(body: Body, { distance, around = 0, up = 0, lift = 0.05, fov = 26 }: { distance: number; around?: number; up?: number; lift?: number; fov?: number }): Rig {
  const head = new Vector3();
  return (out: Framing) => {
    placeOf(body.bones.head, head);
    const yaw = body.facing + around;
    out.eye.set(Math.sin(yaw) * distance, up + lift, Math.cos(yaw) * distance).add(head);
    out.at.copy(head).setY(head.y + lift);
    out.fov = fov;
    return out;
  };
}
