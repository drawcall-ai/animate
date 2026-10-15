import type { Quaternion, Vector3 } from 'three';

/** A bone of a rig: rest local rotation is identity (+Y up, facing +Z, left +X). */
export interface BoneDef {
  name: string;
  /** Development snap ceilings: angular speed (°/s) and acceleration (°/s²). */
  snap?: { speed: number; accel: number };
  /** index of the parent bone, -1 for the root (only bone 0); parents come before children */
  parent: number;
  /** rest offset of the bone's origin in its parent's frame (m); the root's is its default position in the world */
  offset: Vector3;
  /** segment mass (kg) */
  mass: number;
  /** the segment's centre of mass in the bone's frame (m) */
  com: Vector3;
}

/**
 * A joint's range of motion as swing and twist (rad) in its parent's frame, measured off
 * `neutral` (the bone's rotation `q · neutral⁻¹`): the twist about `axis`, the swing's two
 * components about the next two axes in turn (x: y, z; y: z, x; z: x, y).
 */
export interface Limit {
  bone: number;
  axis: 0 | 1 | 2;
  /** the rotation the range is measured from (default identity), e.g. an arm hanging */
  neutral?: Quaternion;
  twist: [number, number];
  swing: [[number, number], [number, number]];
}

export interface SkeletonOptions {
  /** at most one per bone */
  limits?: readonly Limit[];
  /**
   * named chains of bones for `solveChain`, each from its first joint down to its tip, every bone
   * the child of the one before (an arm: upper arm, forearm, hand)
   */
  chains?: Record<string, readonly string[]>;
}

/** A rig: bones in order, parents before children, bone 0 the only root; its joint limits and named chains. */
export class Skeleton {
  readonly bones: readonly BoneDef[];
  /** each bone's limit, if it has one */
  readonly limits: readonly (Limit | undefined)[];
  private readonly byName = new Map<string, number>();
  private readonly chains = new Map<string, readonly number[]>();

  constructor(bones: readonly BoneDef[], { limits = [], chains = {} }: SkeletonOptions = {}) {
    if (bones.length === 0) throw new Error('a skeleton needs at least one bone');
    bones.forEach((b, i) => {
      if (this.byName.has(b.name)) throw new Error(`bone name "${b.name}" is used twice`);
      this.byName.set(b.name, i);
      if (i === 0 && b.parent !== -1) throw new Error(`bone 0 "${b.name}" must be the root (parent -1)`);
      if (i > 0 && !(Number.isInteger(b.parent) && b.parent >= 0 && b.parent < i)) {
        throw new Error(`bone ${i} "${b.name}" has parent ${b.parent}; parents must come before children`);
      }
      if (!(b.mass >= 0 && Number.isFinite(b.mass))) throw new Error(`bone "${b.name}" has mass ${b.mass}`);
    });
    this.bones = bones;
    const byBone: (Limit | undefined)[] = bones.map(() => undefined);
    for (const l of limits) {
      if (!bones[l.bone]) throw new Error(`a limit for bone ${l.bone}, which does not exist`);
      if (byBone[l.bone]) throw new Error(`bone "${bones[l.bone].name}" has two limits`);
      byBone[l.bone] = l;
    }
    this.limits = byBone;
    for (const [name, names] of Object.entries(chains)) {
      const chain = names.map((n) => this.index(n));
      if (chain.length < 2) throw new Error(`chain "${name}" needs at least two bones`);
      chain.forEach((b, k) => {
        if (k > 0 && bones[b].parent !== chain[k - 1]) throw new Error(`chain "${name}": "${bones[b].name}" is not the child of "${names[k - 1]}"`);
      });
      this.chains.set(name, chain);
    }
  }

  /** the index of the bone named `name`; throws when there is none */
  index(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`no bone named "${name}"`);
    return i;
  }

  /** the bones of the chain named `name`, from its first joint to its tip; throws when there is none */
  chain(name: string): readonly number[] {
    const c = this.chains.get(name);
    if (!c) throw new Error(`no chain named "${name}"`);
    return c;
  }
}
