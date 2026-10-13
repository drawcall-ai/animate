import { Vector3 } from 'three';
import type { BoneDef } from './types';

/** The pull's natural frequency (Hz) on a bone that sets none: a ~0.4 s settle, a deliberate move's. */
export const STIFFNESS = 2;

/**
 * A rig: bones in order, parents before children, bone 0 the only root. Its generalized
 * coordinates are the root's position (3) and every bone's rotation in its parent's frame
 * (3 each, the root's in the world's): `dofs` = 3 + 3 · bones.
 */
export class Skeleton {
  readonly bones: readonly BoneDef[];
  readonly dofs: number;
  /** each bone's ancestors from the root down to the bone itself */
  readonly chains: readonly (readonly number[])[];
  /** each bone and its descendants */
  readonly subtrees: readonly (readonly number[])[];
  /** the coordinates that move each bone: the root's position and its ancestors' rotations (in that order) */
  readonly drivers: readonly (readonly number[])[];
  /** every coordinate, in order */
  readonly coordinates: readonly number[];
  /** each bone's subtree mass (kg) */
  readonly masses: readonly number[];
  readonly mass: number;
  /**
   * the rig's size (m): the diagonal of the box around its bone origins and centres of mass at
   * rest (1 for a rig of a single point). Position errors are measured in it, so that a
   * position target's weight pulls about as hard as a rotation's (rad).
   */
  readonly length: number;
  private readonly byName = new Map<string, number>();

  constructor(bones: readonly BoneDef[]) {
    if (bones.length === 0) throw new Error('a skeleton needs at least one bone');
    bones.forEach((b, i) => {
      if (this.byName.has(b.name)) throw new Error(`bone name "${b.name}" is used twice`);
      this.byName.set(b.name, i);
      if (i === 0 && b.parent !== -1) throw new Error(`bone 0 "${b.name}" must be the root (parent -1)`);
      if (i > 0 && !(b.parent >= 0 && b.parent < i && Number.isInteger(b.parent))) {
        throw new Error(`bone ${i} "${b.name}" has parent ${b.parent}; parents must come before children`);
      }
      if (!(b.mass >= 0 && Number.isFinite(b.mass))) throw new Error(`bone "${b.name}" has mass ${b.mass}`);
      if (b.stiffness !== undefined && !(b.stiffness > 0)) throw new Error(`bone "${b.name}" has stiffness ${b.stiffness}`);
    });
    this.bones = bones;
    this.dofs = 3 + 3 * bones.length;
    this.coordinates = Array.from({ length: this.dofs }, (_, d) => d);
    const chains: number[][] = [];
    const subtrees: number[][] = bones.map((_, i) => [i]);
    bones.forEach((b, i) => {
      chains.push(i === 0 ? [0] : [...chains[b.parent], i]);
      for (const a of chains[i]) if (a !== i) subtrees[a].push(i);
    });
    this.chains = chains;
    this.drivers = chains.map((c) => [0, 1, 2, ...c.flatMap((j) => [dof(j), dof(j) + 1, dof(j) + 2])]);
    this.subtrees = subtrees;
    this.masses = subtrees.map((s) => s.reduce((m, i) => m + bones[i].mass, 0));
    this.mass = this.masses[0];
    this.length = extent(bones) || 1;
  }

  /** the index of the bone named `name`; throws when there is none */
  index(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`no bone named "${name}"`);
    return i;
  }
}

/** the first generalized coordinate of bone `bone`'s rotation */
export const dof = (bone: number): number => 3 + 3 * bone;

/** the diagonal of the box around `bones`' origins and centres of mass at rest (m) */
function extent(bones: readonly BoneDef[]): number {
  const origins: Vector3[] = [];
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  bones.forEach((b, i) => {
    const origin = i === 0 ? new Vector3() : b.offset.clone().add(origins[b.parent]);
    origins.push(origin);
    for (const p of [origin, b.com.clone().add(origin)]) {
      min.min(p);
      max.max(p);
    }
  });
  return min.distanceTo(max);
}
