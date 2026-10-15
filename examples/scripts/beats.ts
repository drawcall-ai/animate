// The headless runner adds task names and source lines using the package's ordinary labels.
import * as animate from '@drawcall/animate';
import { named, type Behaviour, type World } from '@drawcall/animate';
export * from '@drawcall/animate';

function traced<A extends unknown[]>(task: string, make: (...args: A) => Behaviour<World>): (...args: A) => Behaviour<World> {
  return (...args) => {
    const at = /\/examples\/src\/(?:.*\/)?([\w.-]+\.ts):(\d+):\d+/.exec(new Error().stack ?? '');
    return named(at ? `${task}@${at[1]}:${at[2]}` : task, make(...args));
  };
}

export const walkTo = traced('walkTo', animate.walkTo<World>);
export const handTo = traced('handTo', animate.handTo<World>);
export const headTo = traced('headTo', animate.headTo<World>);
export const grab = traced('grab', animate.grab<World>);
export const approach = traced('approach', animate.approach<World>);
export const reachFor = traced('reachFor', animate.reachFor<World>);
export const carry = traced('carry', animate.carry<World>);
export const hold = traced('hold', animate.hold<World>);
export const release = traced('release', animate.release<World>);
export const wear = traced('wear', animate.wear<World>);
export const takeOff = traced('takeOff', animate.takeOff<World>);
export const withGaze = traced('withGaze', animate.withGaze<World>);
export const lookAt = traced('lookAt', animate.lookAt<World>);
export const ask = traced('ask', animate.ask<World>);
export const trunkTo = traced('trunkTo', animate.trunkTo<World>);
export const pelvisTo = traced('pelvisTo', animate.pelvisTo<World>);
export const idle = animate.idle<World>;
