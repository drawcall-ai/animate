import type { Object3D } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, humanoid } from '@drawcall/animate';
import { PERSON } from './skeletons/person';
import { LUKE } from './skeletons/luke';
import { HAN } from './skeletons/han';
import { CHEWBACCA } from './skeletons/chewbacca';
import { LEIA } from './skeletons/leia';
import { THREEPIO } from './skeletons/threepio';
import { MEDAL_BEARER } from './skeletons/bearer';
import { DODONNA } from './skeletons/dodonna';
import type { Marks } from './hall';
import { createArtoo } from './droids/artoo';

/**
 * How the viewer puts a rigged model on a body: a fresh copy of the mesh rigged on `skeleton`, or none (the body stays bare).
 * Headless runs pass nothing, so every body is bare.
 */
export type Dress = (skeleton: readonly SkeletonBone[]) => Object3D | undefined;

/** The named characters of the scene. Crowds and extras belong to the beats that need them. */
export interface Cast {
  luke: Body;
  han: Body;
  chewbacca: Body;
  leia: Body;
  medalBearer: Body;
  dodonna: Body;
  threepio: Body;
  artoo: Body;
}

/**
 * Every character standing at its mark, each on the skeleton measured for its own model (see models.ts).
 * R2-D2 is a stand-in until the droid has its own skeleton and species (droids/artoo.ts).
 */
export function createCast(marks: Marks, dress: Dress = () => undefined, starts: Partial<Record<keyof Cast, keyof Marks>> = {}, dev = true): Cast {
  const at = (name: keyof Cast, fallback: keyof Marks) => marks[starts[name] ?? fallback];
  const person = (mark: Object3D, skeleton: readonly SkeletonBone[]) =>
    new Body(humanoid(skeleton as typeof PERSON), { at: mark.position.clone(), face: mark.rotation.y, model: dress(skeleton), dev });
  return {
    luke: person(at('luke', 'lukeEnter'), LUKE),
    han: person(at('han', 'hanEnter'), HAN),
    chewbacca: person(at('chewbacca', 'chewbaccaEnter'), CHEWBACCA),
    leia: person(at('leia', 'leia'), LEIA),
    medalBearer: person(at('medalBearer', 'medalBearer'), MEDAL_BEARER),
    dodonna: person(at('dodonna', 'dodonna'), DODONNA),
    threepio: person(at('threepio', 'threepio'), THREEPIO),
    artoo: createArtoo(at('artoo', 'artoo'), dress, dev),
  };
}

/** all of the cast's bodies */
export const castBodies = (cast: Cast): Body[] => Object.values(cast);
