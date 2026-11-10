import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { ReadonlyBonePose } from '../kernel/bone-pose';
import type { Placement } from '../kernel/goal';
import { anchors, movers, orienters } from './anchors';
import type { Self } from '../body/self';

/**
 * Where `node` is in the world this sub-step, as `reader` finds it (into `out`): the frame of the nearest anchor among its ancestors
 * (a body's object or moving bone, from that body's pose; a thing a body moves, from where it moves it), times the local chain
 * below it — each local the app moves eased from where it was at the reader's last update to where it is now across the update's
 * sub-steps, exact at its end, or as it is now if `fresh` (the app moves it every sub-step). Scale is left out of the result (a body's
 * frames are metres) but carried through the chain. An app-owned world matrix (`matrixWorldAutoUpdate = false`) ends the chain.
 */
export function placedFor(reader: Self, node: Object3D, out: Placement, fresh = false): Placement {
  chainOf(reader, node, fresh, _chain).decompose(out.position, out.quaternion, _scale);
  return out;
}

/** `node`'s world matrix as `placedFor` finds it, scale and all, into `chain` */
function chainOf(reader: Self, node: Object3D, fresh: boolean, chain: Matrix4): Matrix4 {
  chain.identity();
  for (let at: Object3D | null = node; at; at = at.parent) {
    const turned = orienters.get(at)?.oriented.get(at);
    if (turned) {
      // (turned in the world as its app keeps it, where its parent, as found now, carries its position)
      const parent = at.parent ? chainOf(reader, at.parent, fresh, new Matrix4()) : new Matrix4();
      matrixOf(reader, at, fresh).decompose(_p, _q, _s);
      _sa.setFromMatrixScale(parent);
      chain.premultiply(_anchor.compose(_p.applyMatrix4(parent), turned, _s.multiply(_sa)));
      break;
    }
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
    chain.premultiply(matrixOf(reader, at, fresh));
    if (!at.matrixWorldAutoUpdate) break;
  }
  return chain;
}

/** a body's object (bone −1) or moving bone, as `pose` places it */
function frameOf(pose: ReadonlyBonePose, body: Self, bone: number): Matrix4 {
  if (bone < 0) {
    const root = pose.position(0);
    return _anchor.compose(_p.set(root.x, body.floor(root.x, root.z), root.z), _q.setFromAxisAngle(UP, pose.facing), ONE);
  }
  const scale = body.scaleOf(bone);
  return _anchor.compose(pose.position(bone), _q.copy(pose.rotation(bone)).multiply(body.restOf(bone)), _s.set(scale, scale, scale));
}

/**
 * Where `node` was in the world (into `out`, scale and all) as the scene stood when `reader` last finished an update: below the nearest
 * body's bone or thing a body moves (as last written to the scene), each local the app moves as `reader` read it at the end of its last
 * update (one it did not read then, as it is now). An app-owned world matrix ends the chain.
 */
export function writtenFor(reader: Self, node: Object3D, out: Matrix4): Matrix4 {
  out.identity();
  for (let at: Object3D | null = node; at; at = at.parent) {
    if (anchors.has(at) || movers.has(at)) {
      at.updateWorldMatrix(true, false);
      return out.premultiply(at.matrixWorld);
    }
    if (at.matrixAutoUpdate) at.updateMatrix();
    const owned = !at.matrixWorldAutoUpdate, matrix = owned ? at.matrixWorld : at.matrix, seen = reader.frames.get(at);
    const read = seen?.parent === (owned ? null : at.parent) ? seen : undefined;
    out.premultiply(read?.update === reader.updates ? read.from : read?.update === reader.updates - 1 ? read.to : matrix);
    if (owned) return out;
  }
  return out;
}

/** The app's matrix (local, or world if it owns that), eased across the update unless its frame changed; fresh reads are exact. */
function matrixOf(reader: Self, node: Object3D, fresh = false): Matrix4 {
  if (node.matrixAutoUpdate) node.updateMatrix();
  const parent = node.matrixWorldAutoUpdate ? node.parent : null, matrix = node.matrixWorldAutoUpdate ? node.matrix : node.matrixWorld;
  if (fresh) return matrix;
  let seen = reader.frames.get(node);
  if (!seen) reader.frames.set(node, (seen = { update: reader.updates, parent, from: matrix.clone(), to: matrix.clone() }));
  if (seen.parent !== parent || seen.update !== reader.updates) {
    seen.from.copy(seen.parent === parent && seen.update === reader.updates - 1 ? seen.to : matrix);
    seen.to.copy(matrix);
    seen.parent = parent;
    seen.update = reader.updates;
  }
  if (seen.from.equals(seen.to)) return seen.to;
  seen.from.decompose(_a, _qa, _sa);
  seen.to.decompose(_b, _qb, _sb);
  return _local.compose(_a.lerp(_b, reader.share), _qa.slerp(_qb, reader.share), _sa.lerp(_sb, reader.share));
}

const UP = new Vector3(0, 1, 0), ONE = new Vector3(1, 1, 1);
const _chain = new Matrix4(), _anchor = new Matrix4(), _local = new Matrix4();
const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _scale = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _sa = new Vector3(), _sb = new Vector3(), _qa = new Quaternion(), _qb = new Quaternion();
