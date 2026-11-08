import { Box3, Matrix4, Mesh, Object3D, Quaternion, Ray, Vector3 } from 'three';
import { surfaceOf, Triangles } from '../kernel/triangles';
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
   * The named empty, a grip: where a person's hand (a creature's tip) goes, each key below in the empty's frame. A grip declares what of
   * the hand's placement is fixed and what is free; the hand verb taking it picks the rest as it starts, from where the body stands
   * (`Body.placement`), and keeps it on the thing while it holds it. What the grip fixes the arm holds exactly; what was picked within
   * its freedoms is only preferred — the hand keeps its point on the empty and turns off the picked turn where its wrist cannot hold it.
   * - Alone (no key below), the empty is where the palm's middle goes, the hand turned as the arm brings it, and kept turned as it took
   *   hold.
   * - `userData.facing`: the way the touching point (the palm, or the pad) faces into the thing; it rolls freely about it.
   * - `userData.handle`: an axis, pointing out of the fist at the thumb's end: a handle running through the empty, the palm against it and
   *   the fingers round it, rolling freely about it (with `facing`, its palm fixed so: the grip fully fixed). `userData.radius` (m) is how
   *   far the palm lies off the axis, else measured off the thing's meshes about the empty; `userData.length` (m) lets the hand slide along
   *   the axis that far, centred on the empty (a rail, a rope, a long rung).
   * - `userData.radius` without a handle: a ball about the empty, the palm anywhere on it facing its middle (with `facing`, there).
   * - `userData.point`: the digit whose pad goes on the empty instead of the palm's middle — a fingertip on a button: the hand comes as a
   *   loose fist, points before its last run in along `facing`, holds where the pad meets the face and draws back the way it came.
   * - `userData.digits` lays digits over the hand closed on the thing: a digit's values (`Finger`, `Thumb`), or the name of an empty on
   *   the thing its pad presses on (read every update; that empty's own `facing` lays the pad flat on its face).
   * A creature's tip takes the empty's position alone. Attached things' subtrees (their own `userData.mass`) are not searched.
   */
  grip(name: string) {
    const node = find(this.object, name);
    if (!node) throw new Error(`"${this.object.name}" has no empty named "${name}"`);
    const { handle, facing, radius, point, length } = node.userData, at = localOf(node, this.object), object = this.object;
    const inThing = (value: unknown, what: string) => vectorOf(value, `"${name}" userData.${what}`).normalize().applyQuaternion(at.quaternion);
    if (radius !== undefined && !(typeof radius === 'number' && radius > 0)) throw new Error(`"${name}" userData.radius ${String(radius)}: give it in m`);
    if (length !== undefined && !(typeof length === 'number' && length >= 0)) throw new Error(`"${name}" userData.length ${String(length)}: give it in m`);
    if (point !== undefined && (handle !== undefined || radius !== undefined)) throw new Error(`"${name}" has both userData.point and userData.${handle !== undefined ? 'handle' : 'radius'}: a pad goes on one point`);
    if (length !== undefined && handle === undefined) throw new Error(`"${name}" has userData.length without userData.handle: a hand slides along a handle`);
    const axis = handle === undefined ? null : inThing(handle, 'handle');
    // (up its ancestors' own matrices, as an app-owned one ends the chain: read mid-update, refreshing the world's would change what the rest of the update reads)
    const scale = () => {
      let scaled = 1;
      for (let node: Object3D | null = object; node; node = node.parent) {
        if (node.matrixAutoUpdate) node.updateMatrix();
        if (!node.matrixWorldAutoUpdate) return scaled * _size.setFromMatrixScale(node.matrixWorld).x;
        scaled *= _size.setFromMatrixScale(node.matrix).x;
      }
      return scaled;
    };
    return {
      node, at: { position: at.position.clone().multiplyScalar(scale()), quaternion: at.quaternion },
      facing: facing === undefined ? null : inThing(facing, 'facing'),
      point: point === undefined ? 'palm' as const : digitOf(point, `"${name}" userData.point`),
      ball: axis === null && typeof radius === 'number' ? { get radius(): number { return radius * scale(); } } : null,
      handle: axis === null ? null : {
        axis,
        /** how far the hand slides along it, centred on the empty (m, the world's; 0: not at all), read the first time it is asked for */
        get length(): number {
          return length ? length * scale() : 0;
        },
        /** its radius (m, the world's): as given, else measured, once, the first time it is asked for */
        get radius(): number {
          return (typeof radius === 'number' ? radius : radiusAbout(object, node, at.position, axis)) * scale();
        },
        /** how wide it is through its axis along `way` (square to it, the thing's frame; m, the thing's): none, where nothing is about it */
        width: (way: Vector3) => widthAbout(object, node, at.position, way),
      },
    };
  }
}

/** A grip on a thing, as `Thing.grip` reads it: its empty, where it is in the thing's frame (m, the world's), and what its keys ask (in the thing's frame). */
export type Grip = ReturnType<Thing['grip']>;

const things = new WeakMap<Object3D, Thing>(), _size = new Vector3();

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
  const near = trianglesNear(object, node, at);
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

/** each grip's triangles about its empty, in its thing's frame */
const about = new WeakMap<Object3D, Triangles>();

/** `object`'s triangles within 20 cm of its grip `node` at `at` (its frame), gathered once */
function trianglesNear(object: Object3D, node: Object3D, at: Vector3): Triangles {
  const known = about.get(node);
  if (known) return known;
  object.updateWorldMatrix(true, true);
  const back = new Matrix4().copy(object.matrixWorld).invert();
  const near = new Triangles(meshesOf(object).flatMap((mesh) => surfaceOf(mesh, back)), at, 0.2);
  about.set(node, near);
  return near;
}

/** how far across `object`'s meshes are through `at` along `way` (its frame): from where a line along it meets them ahead to where it
 * meets them behind, each within 10 cm; none, where it meets none either way */
function widthAbout(object: Object3D, node: Object3D, at: Vector3, way: Vector3): number | null {
  const near = trianglesNear(object, node, at), unit = way.clone().normalize();
  const ahead = near.first(new Ray(at.clone(), unit), 0.1), behind = near.first(new Ray(at.clone(), unit.negate()), 0.1);
  return ahead === null || behind === null ? null : ahead + behind;
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
