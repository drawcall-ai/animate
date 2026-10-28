import type { Object3D } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, humanoid } from '@drawcall/animate';
import { SOLDIER } from './skeletons/soldier';
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
 * Every character standing at its mark. Until each has its own model and skeleton, they all wear the soldier.
 * The owner of a character replaces its line here (its skeleton, species and options).
 */
export function createCast(marks: Marks, dress: Dress = () => undefined, starts: Partial<Record<keyof Cast, keyof Marks>> = {}, dev = true): Cast {
  const at = (name: keyof Cast, fallback: keyof Marks) => marks[starts[name] ?? fallback];
  const person = (mark: Object3D, skeleton: readonly SkeletonBone[] = SOLDIER) =>
    new Body(humanoid(skeleton as typeof SOLDIER), { at: mark.position.clone(), face: mark.rotation.y, model: dress(skeleton), dev });
  return {
    luke: person(at('luke', 'lukeEnter')),
    han: person(at('han', 'hanEnter')),
    chewbacca: person(at('chewbacca', 'chewbaccaEnter')),
    leia: person(at('leia', 'leia')),
    medalBearer: person(at('medalBearer', 'medalBearer')),
    dodonna: person(at('dodonna', 'dodonna')),
    threepio: person(at('threepio', 'threepio')),
    artoo: createArtoo(at('artoo', 'artoo'), dress, dev),
  };
}

/** all of the cast's bodies */
export const castBodies = (cast: Cast): Body[] => Object.values(cast);
