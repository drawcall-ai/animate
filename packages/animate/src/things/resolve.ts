import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { ReadonlyPose } from '../kernel/pose';
import type { Local } from './thing';

/**
 * A body as targets resolve against it: the pose its frames are read from by a reader — its own as posed so far this sub-step,
 * another body's as it was before that body's update this frame — its bones as they stand in the scene, and where a thing it moves
 * itself is, read the same way (its own this sub-step: its moves come after its hands). As a reader: how many updates it has finished,
 * the share of the update's time its sub-step has reached, and the local transforms it has seen.
 */
export interface Resolving {
  readonly updates: number;
  readonly share: number;
  readonly frames: WeakMap<Object3D, Interpolated>;
  poseFor(reader: Resolving): ReadonlyPose;
  movedFor(reader: Resolving, node: Object3D): Local | null;
  /** a moving bone's rest frame in the scene (`turn⁻¹ · rest`), and its scale */
  restOf(bone: number): Readonly<Quaternion>;
  scaleOf(bone: number): number;
}

/** each body's object (bone −1) and moving bones, by node */
export const anchors = new WeakMap<Object3D, { body: Resolving; bone: number }>();

/** the body that moves each thing it carries in both hands itself (one hand's hangs from that hand's bone) */
export const movers = new WeakMap<Object3D, Resolving>();

/** a node's local transform from one update to the next, the update it was last read in, and under which parent */
export interface Interpolated {
  update: number;
  parent: Object3D | null;
  from: Matrix4;
  to: Matrix4;
}

/**
 * Where `node` is in the world this sub-step, as `reader` finds it (into `out`): the frame of the nearest anchor among its ancestors
 * (a body's object or moving bone, from that body's pose; a thing a body moves, from where it moves it), times the local chain
 * below it — each local the app moves eased from where it was at the reader's last update to where it is now across the update's
 * sub-steps, exact at its end. Scale is left out of the result (a body's frames are metres) but carried through the chain.
 */
export function resolve(reader: Resolving, node: Object3D, out: Local): Local {
  const chain = _chain.identity();
  for (let at: Object3D | null = node; at; at = at.parent) {
    const moved = movers.get(at)?.movedFor(reader, at);
    if (moved) {
      chain.premultiply(_anchor.compose(moved.position, moved.quaternion, at.scale));
      break;
    }
    const anchor = anchors.get(at);
    if (anchor) {
      chain.premultiply(frameOf(anchor.body.poseFor(reader), anchor.body, anchor.bone));
      break;
    }
    chain.premultiply(localOf(reader, at));
  }
  chain.decompose(out.position, out.quaternion, _scale);
  return out;
}

/** a body's object (bone −1) or moving bone, as `pose` places it */
function frameOf(pose: ReadonlyPose, body: Resolving, bone: number): Matrix4 {
  if (bone < 0) {
    const root = pose.position(0);
    return _anchor.compose(_p.set(root.x, 0, root.z), _q.setFromAxisAngle(UP, pose.facing), ONE);
  }
  const scale = body.scaleOf(bone);
  return _anchor.compose(pose.position(bone), _q.copy(pose.rotation(bone)).multiply(body.restOf(bone)), _s.set(scale, scale, scale));
}

/** `node`'s local transform, eased across the reader's update if the app moved it since the last (not if it re-parented it: a new frame) */
function localOf(reader: Resolving, node: Object3D): Matrix4 {
  node.updateMatrix();
  let seen = reader.frames.get(node);
  if (!seen) reader.frames.set(node, (seen = { update: reader.updates, parent: node.parent, from: node.matrix.clone(), to: node.matrix.clone() }));
  if (seen.parent !== node.parent) {
    seen.from.copy(node.matrix);
    seen.to.copy(node.matrix);
    seen.parent = node.parent;
    seen.update = reader.updates;
  }
  if (seen.update !== reader.updates) {
    seen.from.copy(seen.update === reader.updates - 1 ? seen.to : node.matrix);
    seen.to.copy(node.matrix);
    seen.update = reader.updates;
  }
  if (seen.from.equals(seen.to)) return seen.to;
  seen.from.decompose(_a, _qa, _sa);
  seen.to.decompose(_b, _qb, _sb);
  const t = reader.share;
  return _local.compose(_a.lerp(_b, t), _qa.slerp(_qb, t), _sa.lerp(_sb, t));
}

const UP = new Vector3(0, 1, 0), ONE = new Vector3(1, 1, 1);
const _chain = new Matrix4(), _anchor = new Matrix4(), _local = new Matrix4();
const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _scale = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _sa = new Vector3(), _sb = new Vector3(), _qa = new Quaternion(), _qb = new Quaternion();
