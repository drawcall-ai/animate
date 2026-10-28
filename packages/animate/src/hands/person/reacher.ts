import type { Object3D } from 'three';
import type { Carrier } from '../../kernel/carrier';
import type { PersonLegged } from '../../legs/person/legged';
import type { Gazer } from '../../species/define';
import type { Handed } from '../handed';

/** A person as its hands see it: a body with hands, on legs of its proportions — and what its hands carry this sub-step, on which aim. */
export type Reacher = Handed & PersonLegged & {
  readonly gazer: Gazer;
  /** what the hands carry in both this sub-step, and along which aim: fitted to the wrists after the hands */
  readonly carrying: Map<Object3D, Carrier>;
};
