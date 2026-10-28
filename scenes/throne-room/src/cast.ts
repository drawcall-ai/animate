import type { Object3D } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, humanoid } from '@drawcall/animate';
import { SOLDIER } from './skeletons/soldier';
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
 * R2-D2 is still a scaled person; the owner of a character replaces its line here (its skeleton, species and options).
 */
export function createCast(marks: Marks, dress: Dress = () => undefined, starts: Partial<Record<keyof Cast, keyof Marks>> = {}, dev = true): Cast {
  const at = (name: keyof Cast, fallback: keyof Marks) => marks[starts[name] ?? fallback];
  const person = (mark: Object3D, skeleton: readonly SkeletonBone[]) =>
    new Body(personOf(skeleton), { at: mark.position.clone(), face: mark.rotation.y, model: dress(skeleton), dev });
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

/**
 * The person of a skeleton, its hands turned with its forearms. humanoid() turns each forearm of a skeleton standing with its arms
 * lowered or bent (an A-pose, as every generated model here stands) onto the straight T-pose arm its solvers use, but gives the hand
 * no such turn: the hand keeps its rest direction while its forearm turns, so every posed wrist is bent by as much as the forearm was
 * turned (about 40° on Han and Chewbacca, palms flared out and fingers forward). Until the library turns the hand with its forearm,
 * this does.
 */
export function personOf(skeleton: readonly SkeletonBone[]) {
  const person = humanoid(skeleton as typeof SOLDIER), turns = new Map(person.turns);
  for (const side of ['left', 'right'] as const) {
    const forearm = person.turns.get(`${side}LowerArm`);
    if (forearm) turns.set(`${side}Hand`, forearm.clone());
  }
  return { ...person, turns };
}

/** all of the cast's bodies */
export const castBodies = (cast: Cast): Body[] => Object.values(cast);
