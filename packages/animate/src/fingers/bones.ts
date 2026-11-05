import type { Vector3 } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import type { DigitName } from './shape';

/** A hand's finger bones by digit, each from the palm out: the thumb's metacarpal, proximal and distal; a finger's proximal, intermediate and distal. */
export type DigitBones = Record<'thumb' | DigitName, readonly [string, string, string]>;

/** the VRM 1.0 finger bones of hand `side` (`leftThumbMetacarpal`, `leftIndexProximal`, …) */
function fingerBones(side: 'left' | 'right'): DigitBones {
  const finger = (digit: string) => [`${side}${digit}Proximal`, `${side}${digit}Intermediate`, `${side}${digit}Distal`] as const;
  return {
    thumb: [`${side}ThumbMetacarpal`, `${side}ThumbProximal`, `${side}ThumbDistal`],
    index: finger('Index'), middle: finger('Middle'), ring: finger('Ring'), little: finger('Little'),
  };
}

/** Each hand's finger bones in `skeleton`, if it has them: all fifteen of both hands or none (some is a misuse, said at once). */
export function fingersOf(skeleton: readonly SkeletonBone[]): { left: DigitBones; right: DigitBones } | undefined {
  const names = new Set(skeleton.map((bone) => bone.name));
  const hands = { left: fingerBones('left'), right: fingerBones('right') };
  const all = [...Object.values(hands.left), ...Object.values(hands.right)].flat(), missing = all.filter((name) => !names.has(name));
  if (missing.length === all.length) return undefined;
  if (missing.length) throw new Error(`humanoid: the skeleton has finger bones but not ${missing.join(', ')}`);
  // (each digit's bones a chain from the hand out)
  const parents = new Map(skeleton.map((bone) => [bone.name, bone.parent]));
  for (const side of ['left', 'right'] as const) {
    for (const chain of Object.values(hands[side])) {
      chain.forEach((name, k) => {
        const parent = parents.get(name), above = k === 0 ? `${side}Hand` : chain[k - 1];
        if (parent !== above) throw new Error(`humanoid: "${name}" hangs from "${parent}", not "${above}"`);
      });
    }
  }
  return hands;
}

/**
 * The way hand `side`'s palm faces, in the skeleton's frame at rest (a unit vector, into `out`): square to the line from the wrist to the
 * middle finger's knuckle and to the line across the knuckles from the little finger's to the index's, so either hand, built mirrored,
 * has its palm the right way.
 */
export function palmFacing(at: (bone: string) => Vector3, hand: string, bones: DigitBones, side: 'left' | 'right', out: Vector3): Vector3 {
  const along = at(bones.middle[0]).clone().sub(at(hand)), across = at(bones.index[0]).clone().sub(at(bones.little[0]));
  return side === 'left' ? out.crossVectors(along, across).normalize() : out.crossVectors(across, along).normalize();
}
