import type { Object3D, Vector3 } from 'three';
import type { Carrier } from '../../kernel/carrier';
import type { PersonLegged } from '../../legs/person/legged';
import type { Gazer } from '../../species/define';
import type { Hold } from '../../things/resolve';
import type { Handed } from '../handed';

/** A person as its hands see it: a body with hands, on legs of its proportions — and what its hands carry this sub-step, on which aim. */
export interface Reacher extends Handed, PersonLegged {
  readonly gazer: Gazer;
  look: Readonly<Vector3> | null;
  readonly holding: Record<string, Hold | null>;
  /** what the hands carry in both this sub-step, and along which aim: fitted to the wrists after the hands */
  readonly carrying: Map<Object3D, Carrier>;
}
