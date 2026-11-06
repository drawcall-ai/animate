import { Box3, Matrix4, Mesh, Object3D, Quaternion, Ray, Vector3 } from 'three';
import { Triangles } from '../kernel/triangles';
import type { Placement } from '../kernel/goal';
import type { Holder } from './resolve';
import { digitOf } from '../fingers/shape';

/** Object mass (`userData.mass`, kg), centre (`userData.centre`, local; default origin), and bounds excluding attached things.
 * Without mass it cannot be lifted. Support persists until lifting and resumes on release into the room. */
export class Thing {
  readonly mass: number;
  readonly centre: Vector3;
  readonly bounds: Box3;
  readonly parts: readonly Box3[];
  /** lifted by a body since it last rested in the room */
  lifted = false;
  /** where it was as it was lifted (world): let go there, it was put back, not dropped */
  taken: Vector3 | null = null;
  /** the parent the library last gave it: another (a stray `scene.add`, a physics sync) under a holding hand is a problem */
  parent: Object3D | null = null;
  /** the bodies whose hands hold it */
  readonly holders = new Set<Holder>();

  private constructor(readonly object: Object3D) {
    const { mass, centre } = object.userData;
    if (mass !== undefined && !(typeof mass === 'number' && mass >= 0 && Number.isFinite(mass))) {
      throw new Error(`"${object.name}" has userData.mass ${String(mass)}: give it in kg`);
    }
    this.mass = mass ?? 0;
    this.centre = vectorOf(centre, `"${object.name}" userData.centre`);
    this.parts = boundsOf(object, this.centre);
    this.bounds = this.parts.reduce((box, part) => box.union(part), new Box3());
  }

  /** `object` as a thing (one record per object) */
  static of(object: Object3D): Thing {
    let thing = things.get(object);
    if (!thing) things.set(object, (thing = new Thing(object)));
    return thing;
  }

  /** whether it has a mass: whether a body may lift it */
  get massive(): boolean {
    return this.object.userData.mass !== undefined;
  }

  /**
   * The named empty, a grip: where a person's hand (a creature's tip) goes, each key below in the empty's frame. Alone it is where the
   * palm's middle goes, the hand turned as the arm brings it. `userData.handle` (an axis, pointing out of the fist at the thumb's end)
   * makes it a handle running through it, the palm against it and the fingers round it; its radius is measured off the thing's meshes
   * about the empty, or given as `userData.radius` (m). `userData.pad` names a digit whose pad goes on it instead of the palm (a fingertip
   * on a button: the hand comes as a loose fist, points late, comes in along `facing` and holds where the pad meets the face; it draws back
   * the way it came as it is released). `userData.facing` is the way the touching part — the palm, or the pad — faces into the surface,
   * the hand turned so as far as the wrist allows (a palm without a handle free to roll about it). `userData.fingers` lays digits over the
   * closed hand: a digit's values (`Finger`, `Thumb`), or the name of an empty on the thing its pad presses on (read every update; that
   * empty's own `facing` lays the pad flat on its face). `userData.approach` (names of empties beside it, outermost first) is the way a
   * carry takes a thing out of it or in to it (a pouch's mouth, a scabbard's), as `carry` says. A creature's tip takes the empty's position alone. Attached things' subtrees (their
   * own `userData.mass`) are not searched.
   */
  grip(name: string) {
    const node = find(this.object, name);
    if (!node) throw new Error(`"${this.object.name}" has no empty named "${name}"`);
    const { handle, facing, radius, pad } = node.userData, at = localOf(node, this.object), object = this.object;
    const inThing = (value: unknown, what: string) => vectorOf(value, `"${name}" userData.${what}`).normalize().applyQuaternion(at.quaternion);
    if (radius !== undefined && !(typeof radius === 'number' && radius > 0)) throw new Error(`"${name}" userData.radius ${String(radius)}: give it in m`);
    if (pad !== undefined && handle !== undefined) throw new Error(`"${name}" has both userData.pad and userData.handle: a handle lies across the palm`);
    const digit = pad === undefined ? null : digitOf(pad, `"${name}" userData.pad`);
    const axis = handle === undefined ? null : inThing(handle, 'handle');
    return {
      node, at,
      facing: facing === undefined ? null : inThing(facing, 'facing'),
      pad: digit,
      handle: axis === null ? null : {
        axis,
        /** its radius (m, the world's): as given, else measured, once, the first time it is asked for */
        get radius(): number {
          object.updateWorldMatrix(true, false);
          return (typeof radius === 'number' ? radius : radiusAbout(object, node, at.position, axis)) * new Vector3().setFromMatrixScale(object.matrixWorld).x;
        },
      },
    };
  }
}

/** A grip on a thing, as `Thing.grip` reads it: its empty, where it is in the thing's frame, and what its keys ask (in the thing's frame). */
export type Grip = ReturnType<Thing['grip']>;

const things = new WeakMap<Object3D, Thing>();

/** `object`'s own meshes a hand can touch: the shown ones, not those of things attached to it (their own `userData.mass`) */
export function meshesOf(object: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  const visit = (node: Object3D) => {
    if (node !== object && node.userData.mass !== undefined) return;
    if (!node.visible) return;
    if (node instanceof Mesh) meshes.push(node);
    for (const child of node.children) visit(child);
  };
  visit(object);
  return meshes;
}

/** each handle's radius as measured, by its empty */
const radii = new WeakMap<Object3D, number>();

/**
 * how far `object`'s meshes lie out from the line through `at` along `axis` (its frame), all round it: the middle of eight measures square
 * to it, once per empty `node`; a handle with no mesh about it is a misuse, said at once
 */
function radiusAbout(object: Object3D, node: Object3D, at: Vector3, axis: Vector3): number {
  const known = radii.get(node);
  if (known !== undefined) return known;
  const meshes = meshesOf(object);
  object.updateWorldMatrix(true, true);
  // (its triangles about the empty, in its frame)
  const back = new Matrix4().copy(object.matrixWorld).invert();
  const near = new Triangles(meshes.map((mesh) => ({ geometry: mesh.geometry, matrix: back.clone().multiply(mesh.matrixWorld) })), at, 0.2);
  const square = new Vector3(1, 0, 0).cross(axis);
  if (square.lengthSq() < 1e-6) square.set(0, 1, 0).cross(axis);
  square.normalize();
  const hits: number[] = [];
  for (let k = 0; k < 8; k++) {
    const hit = near.first(new Ray(at.clone(), square.clone().applyAxisAngle(axis, (k * Math.PI) / 4)), 0.2);
    if (hit !== null) hits.push(hit);
  }
  if (hits.length < 4) throw new Error(`"${node.name}" userData.handle: no handle about it on "${object.name}" (give userData.radius)`);
  const radius = hits.sort((a, b) => a - b)[Math.floor(hits.length / 2)];
  radii.set(node, radius);
  return radius;
}

/** the descendant of `root` named `name` (or `root`), not looking into things attached to it */
function find(root: Object3D, name: string): Object3D | undefined {
  if (root.name === name) return root;
  for (const child of root.children) {
    if (child.userData.mass !== undefined) continue;
    const found = find(child, name);
    if (found) return found;
  }
}

/** `node` in `ancestor`'s frame (its scale left out: a body's frames are metres) */
export function localOf(node: Object3D, ancestor: Object3D): Placement {
  const matrix = new Matrix4();
  for (let at: Object3D | null = node; at && at !== ancestor; at = at.parent) {
    if (!at.parent) throw new Error(`"${node.name}" is not under "${ancestor.name}"`);
    at.updateMatrix();
    matrix.premultiply(at.matrix);
  }
  const local = { position: new Vector3(), quaternion: new Quaternion() };
  matrix.decompose(local.position, local.quaternion, new Vector3());
  return local;
}

/** a thing's own meshes in its frame, or the points of its empties and centre where it has none */
function boundsOf(object: Object3D, centre: Vector3): Box3[] {
  const boxes: Box3[] = [], points: Vector3[] = [centre.clone()];
  const visit = (node: Object3D, matrix: Matrix4) => {
    if (node instanceof Mesh) {
      node.geometry.computeBoundingBox();
      const own = node.geometry.boundingBox;
      if (own && !own.isEmpty()) boxes.push(own.clone().applyMatrix4(matrix));
    } else if (node !== object) points.push(new Vector3().setFromMatrixPosition(matrix));
    for (const child of node.children) {
      if (child.userData.mass !== undefined) continue;
      child.updateMatrix();
      visit(child, new Matrix4().multiplyMatrices(matrix, child.matrix));
    }
  };
  visit(object, new Matrix4());
  return boxes.length ? boxes : [new Box3().setFromPoints(points)];
}

/** `value` as a vector: a `Vector3` or [x, y, z]; none, the zero vector; anything else a misuse, said at once (`what`: what gave it) */
export function vectorOf(value: unknown, what: string): Vector3 {
  if (value === undefined) return new Vector3();
  if (value instanceof Vector3) return value.clone();
  if (Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x))) return new Vector3(value[0], value[1], value[2]);
  throw new Error(`${what} is neither a Vector3 nor [x, y, z]`);
}
