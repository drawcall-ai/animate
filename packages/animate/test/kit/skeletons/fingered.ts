import type { SkeletonBone } from '@drawcall/rig';
import { Vector3 } from 'three';
import { PERSON } from '../../../skills/animate/references/person';

/** the reference person with VRM finger bones, laid out in its T-pose: palms down, thumbs forward, each finger straight out */
export const FINGERED: SkeletonBone[] = [...PERSON, ...(['left', 'right'] as const).flatMap((side) => {
  const hand = PERSON.find((bone) => bone.name === `${side}Hand`);
  if (!hand) throw new Error('no hand');
  const out = side === 'left' ? 1 : -1, [x, y, z] = hand.position;
  const digit = (name: string, joints: readonly string[], across: number, step: Vector3, from: Vector3) => joints.map((joint, k) => ({
    name: `${side}${name}${joint}`, parent: k === 0 ? `${side}Hand` : `${side}${name}${joints[k - 1]}`,
    position: from.clone().addScaledVector(step, k).add(new Vector3(x, y, z + across)).toArray(),
  }));
  const finger = ['Proximal', 'Intermediate', 'Distal'];
  return [
    ...digit('Thumb', ['Metacarpal', 'Proximal', 'Distal'], 0.02, new Vector3(out * 0.025, -0.01, 0.025), new Vector3(out * 0.025, -0.01, 0)),
    ...digit('Index', finger, 0.025, new Vector3(out * 0.028, 0, 0), new Vector3(out * 0.09, 0, 0)),
    ...digit('Middle', finger, 0.005, new Vector3(out * 0.03, 0, 0), new Vector3(out * 0.093, 0, 0)),
    ...digit('Ring', finger, -0.015, new Vector3(out * 0.028, 0, 0), new Vector3(out * 0.088, 0, 0)),
    ...digit('Little', finger, -0.033, new Vector3(out * 0.022, 0, 0), new Vector3(out * 0.08, 0, 0)),
  ];
})];
