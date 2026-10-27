import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Body, horse, dog, humanoid } from '../src/index';
import { PERSON } from '../skills/animate/references/person';
import { DOG } from '../skills/animate/references/dog';
import { HORSE as REFERENCE_HORSE } from '../skills/animate/references/horse';

// Trial 2's authored rig: all required names, but fully extended legs.
const HORSE = [
  { name: 'trunk', position: [0, 1.4, .4] },
  { name: 'back', parent: 'trunk', position: [0, 1.4, 0] },
  { name: 'pelvis', parent: 'back', position: [0, 1.4, -.65] },
  { name: 'neck', parent: 'trunk', position: [0, 1.55, .65] },
  { name: 'head', parent: 'neck', position: [0, 1.9, 1.1] },
  { name: 'jaw', parent: 'head', position: [0, 1.53, 1.4] },
  { name: 'tail', parent: 'pelvis', position: [0, 1.4, -.85] },
  { name: 'leftEar', parent: 'head', position: [.1, 2.1, 1.1] },
  { name: 'rightEar', parent: 'head', position: [-.1, 2.1, 1.1] },
  ...(['left', 'right'] as const).flatMap(side => {
    const x = side === 'left' ? .24 : -.24;
    return [
      { name: `${side}Scapula`, parent: 'trunk', position: [x, 1.4, .45] },
      { name: `${side}Humerus`, parent: `${side}Scapula`, position: [x, 1.15, .45] },
      { name: `${side}Forearm`, parent: `${side}Humerus`, position: [x, .85, .45] },
      { name: `${side}ForeCannon`, parent: `${side}Forearm`, position: [x, .5, .45] },
      { name: `${side}ForePastern`, parent: `${side}ForeCannon`, position: [x, .18, .45] },
      { name: `${side}ForeHoof`, parent: `${side}ForePastern`, position: [x, .06, .45] },
      { name: `${side}Femur`, parent: 'pelvis', position: [x, 1.35, -.65] },
      { name: `${side}Gaskin`, parent: `${side}Femur`, position: [x, .95, -.65] },
      { name: `${side}HindCannon`, parent: `${side}Gaskin`, position: [x, .55, -.65] },
      { name: `${side}HindPastern`, parent: `${side}HindCannon`, position: [x, .18, -.65] },
      { name: `${side}HindHoof`, parent: `${side}HindPastern`, position: [x, .06, -.65] },
    ] as const;
  }),
] as const;

test('rejects infeasible legs at construction, naming the chain, joint, constraint and rig edit', () => {
  for (const dev of [false, true]) {
    expect(() => new Body(horse(HORSE), { dev })).toThrow(/leg leftScapula → leftForeHoof: joint leftScapula.*sole flat.*Lower leftScapula's skeleton position.y.*leftHumerus/);
  }
  // Bending the shoulder and stifle adds reach without changing standing height.
  const bent = HORSE.map(bone => ({ ...bone, position: [bone.position[0], bone.position[1],
    bone.position[2] + (/Humerus|Gaskin/.test(bone.name) ? .25 : 0)] as const }));
  expect(() => new Body(horse(bent))).not.toThrow();
});

test('update errors identify the species, optional scene name, time and original cause even outside sub-steps', () => {
  const bodies = [new Body(humanoid(PERSON)), new Body(dog(DOG)),
    new Body(horse(REFERENCE_HORSE), { life: { tether: () => ({ position: new Vector3(), length: -1 }) } })];
  for (const body of bodies.slice(0, 2)) {
    expect(() => body.update(-1)).toThrow(`${body.species.name}, 0.000 s, idle: cannot update by -1 s`);
  }
  const mare = bodies[2];
  mare.object.name = 'mare';
  expect(() => mare.update(1 / 60)).toThrow('horse "mare", 0.017 s, idle: horse tether needs a finite point and positive length');
});
