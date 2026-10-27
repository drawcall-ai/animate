// Absolute model-space positions in metres: +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/**
 * A lion of ~190 kg, 1.0 m at the withers, standing square : each leg's top, elbow or stifle, wrist or hock and
 * paw (the elbow bending back, the stifle forward, the hock high and back as a cat's), a spine between trunk and pelvis, a long tail.
 */
export const LION = [
  { name: 'trunk', position: [0, 0.97, 0.2] },
  { name: 'spine', parent: 'trunk', position: [0, 0.97, -0.15] },
  { name: 'pelvis', parent: 'spine', position: [0, 0.95, -0.42] },
  { name: 'neck', parent: 'trunk', position: [0, 0.95, 0.55] },
  { name: 'head', parent: 'neck', position: [0, 1.15, 0.86] },
  { name: 'jaw', parent: 'head', position: [0, 1.0, 1.1] },
  { name: 'tail', parent: 'pelvis', position: [0, 0.97, -0.62] },
  { name: 'tailTip', parent: 'tail', position: [0, 0.45, -1.2] },
  { name: 'leftFore0', parent: 'trunk', position: [0.15, 0.95, 0.45] },
  { name: 'leftFore1', parent: 'leftFore0', position: [0.15, 0.6, 0.27] },
  { name: 'leftFore2', parent: 'leftFore1', position: [0.15, 0.22, 0.42] },
  { name: 'leftFore3', parent: 'leftFore2', position: [0.15, 0.06, 0.5] },
  { name: 'rightFore0', parent: 'trunk', position: [-0.15, 0.95, 0.45] },
  { name: 'rightFore1', parent: 'rightFore0', position: [-0.15, 0.6, 0.27] },
  { name: 'rightFore2', parent: 'rightFore1', position: [-0.15, 0.22, 0.42] },
  { name: 'rightFore3', parent: 'rightFore2', position: [-0.15, 0.06, 0.5] },
  { name: 'leftHind0', parent: 'pelvis', position: [0.15, 0.93, -0.5] },
  { name: 'leftHind1', parent: 'leftHind0', position: [0.15, 0.62, -0.27] },
  { name: 'leftHind2', parent: 'leftHind1', position: [0.15, 0.3, -0.68] },
  { name: 'leftHind3', parent: 'leftHind2', position: [0.15, 0.06, -0.56] },
  { name: 'rightHind0', parent: 'pelvis', position: [-0.15, 0.93, -0.5] },
  { name: 'rightHind1', parent: 'rightHind0', position: [-0.15, 0.62, -0.27] },
  { name: 'rightHind2', parent: 'rightHind1', position: [-0.15, 0.3, -0.68] },
  { name: 'rightHind3', parent: 'rightHind2', position: [-0.15, 0.06, -0.56] },
] as const satisfies readonly SkeletonBone[];
