import { Vector3 } from 'three';
import type { Frame } from '../frame';
import type { RootGoal } from './stepper';
import type { Self } from '../../body/self';

/**
 * A body's root as its app drives it (`drive`), a sub-step at a time: where it is, its velocity (read off its moves when not given),
 * facing and crouch; a leap it asks is passed to the legs, and how still it holds itself to its balance (`steady`).
 */
export function drivenRoot(self: Self): (f: Frame) => RootGoal {
  const drive = self.drive;
  if (!drive) throw new Error('drivenRoot: the body is not driven');
  let last: Vector3 | null = null;
  return (f) => {
    const root = drive(f.time);
    const position = root.position.clone().setY(0);
    const velocity = root.velocity?.clone().setY(0) ?? (last ? position.clone().sub(last).divideScalar(f.dt) : new Vector3());
    last = position.clone();
    if (![position.x, position.z, velocity.x, velocity.z, root.yaw].every(Number.isFinite)) throw new Error('drive: a root that is not finite');
    if (root.jump !== undefined) self.stepper?.jump(root.jump);
    if (root.steady !== undefined) self.poise.add({ steady: root.steady });
    return { position, velocity, yaw: root.yaw, crouch: root.crouch };
  };
}
