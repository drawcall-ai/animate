import { CachedRigLoader, ModelLoader, type SkeletonBone } from "@drawcall/rig"
import { SkinnedMesh } from "three"

/** A generated model at `url` rigged to `skeleton`, measured on it, with skin weights cached by vitecache: the cache
 * holds them for the model's geometry, the skeleton and the resolution, whichever example loads it. */
export async function rig(url: string, skeleton: readonly SkeletonBone[]) {
  // The fingers set the resolution: rig smooths weights over about ten voxels, so a 2 cm phalanx needs voxels under
  // 2 mm (1024 over 1.85 m) to own its part of the finger. Solving costs a few minutes and ~3 GB, once, in Node.
  const rigged = await new CachedRigLoader().loadAsync({ object: async () => (await new ModelLoader().loadAsync(url)).scene, skeleton, resolution: 1024 })
  // A body takes the bones anywhere, while a skinned mesh's bounds stay where it was bound: never cull it on those.
  rigged.object.traverse((o) => {
    if (o instanceof SkinnedMesh) o.frustumCulled = false
  })
  return rigged
}
