import type { Object3D } from 'three';
import type { Carrier } from '../../kernel/carrier';
import type { PersonLegged } from '../../legs/person/legged';
import type { Gazer } from '../../species/define';
import type { Handed } from '../handed';
import type { ArmPosture } from '../../kernel/poise';
import type { Side } from '../../species/humanoid/bones';
import type { Channel, Claim } from '../../kernel/requests';

/** A person as its hands see it: a body with hands, on legs of its proportions — and what its hands carry this sub-step, on which aim. */
export type Reacher = Handed & PersonLegged & {
  readonly gazer: Gazer;
  /** what the hands carry in both this sub-step, and along which aim: fitted to the wrists after the hands */
  readonly carrying: Map<Object3D, Carrier>;
  /** each arm's pose asked this sub-step: the free arm's hang takes it, and clears it */
  readonly armPose: Record<Side, Required<ArmPosture>>;
  /** the claim that has `channel` this sub-step, if a request claims it */
  owner(channel: Channel): Claim | undefined;
  /** how many updates it has finished (0: none of it has been shown yet) */
  readonly updates: number;
  /** `bones` as its pose being written has them, as if they had always stood so (only as it starts) */
  startAs(bones: readonly number[]): void;
};
