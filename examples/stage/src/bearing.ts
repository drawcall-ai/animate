// How the soldier is built and carries himself, apart from soldier.ts: that file is an input of his cached skin weights.

/** The soldier's build and gait: a broad man in a plate carrier (`girth` for his Humanoid) who walks from the
 * shoulders more than from the hips, his upper arms hanging out from the kit (`gait` for LocomotionPlanner). */
export const SOLDIER = {
  girth: 0.6,
  gait: { hipSwing: 0.5, shoulderSwing: 1.5, armSpread: 0.3 },
}
