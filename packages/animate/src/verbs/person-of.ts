import { selfOf, type Body } from '../body';
import { nameOf } from '../species/define';
import { Person } from '../person/person';

/** `body` as the person it is, for what only a person does (`verb` names it in the error, thrown as the verb is called) */
export function personOf(body: Body, verb: string): Person {
  const self = selfOf(body);
  if (self instanceof Person) return self;
  throw new Error(`${verb}: for a person (a humanoid species) only; this body is a ${nameOf(body.species)}`);
}
