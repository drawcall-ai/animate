import { Vector3, type Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import { OFF_FLOOR } from '../kernel/dev';
import type { Steering } from './state';
import type { Self } from '../body/self';

/** What a body's root does when the app drives it (a player's): its position, velocity, facing and stance. */
export interface Root {
  /** its point at the feet (m). Without support, y is ignored and the body stands on its floor at x/z. */
  position: Vector3;
  /** its velocity (m/s); default read off its moves. Required with support, relative to the supporting platform.
   * Vertical velocity is used only with support. */
  velocity?: Vector3;
  /** its facing (rad about +Y; 0 faces +Z) */
  yaw: number;
  /** how far it crouches (0 standing … 1 a deep crouch): a key's 0 or 1 as it is, the legs ease it */
  crouch?: number;
  /** leap at this speed (m/s up) as soon as the feet can */
  jump?: number;
  /** Physics-owned motion: a contact point on the supporting surface, or null in flight. Position.y and velocity.y follow physics;
   * landing only bends the knees. Give the real floor for foot placement; do not also set jump. */
  support?: Vector3 | null;
  /** The supporting object's world frame, when it moves; switching to another carries the body with that one from the next
   * sub-step. Omit it in flight. The body follows its actual transform, including while both feet swing. Without floor.platform, this also carries every foot. */
  platform?: Object3D;
}

/**
 * A body's root as its app drives it (`drive`), a sub-step at a time: where it is, its velocity (read off its moves when not given),
 * facing and crouch; a leap it asks is passed to the legs.
 */
export function drivenRoot(self: Pick<Self, 'drive' | 'driven' | 'stepper' | 'poise' | 'floor' | 'warn'>): (f: Frame) => Steering {
  if (!self.drive) throw new Error('drivenRoot: the body is not driven');
  let last: Vector3 | null = null;
  return (f) => {
    const root = self.driven;
    if (!root) throw new Error('drivenRoot: no root driven this sub-step');
    // (without external support, a root driven above or below its floor stands on it)
    const physical = root.support !== undefined;
    if (root.platform && !physical) throw new Error('drive: a platform requires physics support');
    if (physical && !root.velocity) throw new Error('drive: physics support requires velocity relative to its platform');
    const height = Math.abs(root.position.y - self.floor(root.position.x, root.position.z));
    if (!physical && height > OFF_FLOOR) self.warn('driven root', `a root driven ${height.toFixed(2)} m off its floor stands on it: its height is ignored (give \`support\` if your physics holds it there)`);
    const position = root.position.clone();
    if (!physical) position.y = 0;
    const velocity = root.velocity?.clone() ?? (last ? position.clone().sub(last).divideScalar(f.dt) : new Vector3());
    if (!physical) velocity.y = 0;
    last = position.clone();
    if (![...position.toArray(), ...velocity.toArray(), root.yaw].every(Number.isFinite)) throw new Error('drive: a root that is not finite');
    if (root.support && !root.support.toArray().every(Number.isFinite)) throw new Error('drive: a support that is not finite');
    if (physical && root.jump !== undefined) throw new Error('drive: support owns vertical motion; do not also request jump');
    if (root.jump !== undefined) self.stepper?.jump(root.jump);
    const vertical = velocity.y;
    return {
      position, velocity: velocity.setY(0), vertical, yaw: root.yaw, crouch: root.crouch,
      support: root.support?.clone() ?? root.support,
      platform: root.platform,
    };
  };
}
