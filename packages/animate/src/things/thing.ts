import { Box3, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { Placement } from '../kernel/goal';
import type { Holder } from './resolve';

/** Object mass (`userData.mass`, kg), centre (`userData.centre`, local; default origin), and bounds excluding attached things.
 * Without mass it cannot be lifted. Support persists until lifting and resumes on release into the room. */
export class Thing {
  readonly mass: number;
  readonly centre: Vector3;
  readonly bounds: Box3;
  readonly parts: readonly Box3[];
  /** lifted by a body since it last rested in the room */
  lifted = false;
  /** the parent it was lifted from, and where it was then (world): where a release with nowhere else to go puts it */
  home: Object3D | null = null;
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
   * The named empty, where a person's palm (a creature's tip) goes: position-only unless `userData.handTurn` is true (its axes are the
   * hand bone's), or an axis ([x, y, z], the empty's frame) about which that turn may roll. Attached things' subtrees are not searched.
   */
  grip(name: string) {
    const node = find(this.object, name);
    if (!node) throw new Error(`"${this.object.name}" has no empty named "${name}"`);
    const turn = node.userData.handTurn;
    return { node, at: localOf(node, this.object), turn: turn === undefined ? null : turn === true ? true as const : vectorOf(turn, `"${name}" userData.handTurn`) };
  }
}

/** A grip on a thing: its empty, where it is in the thing's frame, and its hand turn (null: unconstrained; true: the empty’s; a vector: free to roll about that axis). */
export type Grip = ReturnType<Thing['grip']>;

const things = new WeakMap<Object3D, Thing>();

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

function vectorOf(value: unknown, what: string): Vector3 {
  if (value === undefined) return new Vector3();
  if (value instanceof Vector3) return value.clone();
  if (Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x))) return new Vector3(value[0], value[1], value[2]);
  throw new Error(`${what} is neither a Vector3 nor [x, y, z]`);
}
