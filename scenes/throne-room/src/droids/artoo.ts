import type { Object3D } from 'three';
import { Body, humanoid } from '@drawcall/animate';
import type { Dress } from '../cast';
import { PERSON } from '../skeletons/person';

/** R2-D2 at `mark`. A stand-in until the droid has its own skeleton and species: a person scaled to R2's 1.09 m. */
export function createArtoo(mark: Object3D, dress: Dress, dev: boolean): Body {
  const scale = 1.09 / 1.75;
  const skeleton = PERSON.map((bone) => ({ ...bone, position: bone.position.map((value) => value * scale) as [number, number, number] }));
  return new Body(humanoid(skeleton as unknown as typeof PERSON), { at: mark.position.clone(), face: mark.rotation.y, model: dress(skeleton), dev });
}
