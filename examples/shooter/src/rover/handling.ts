import { MathUtils, Quaternion, Vector3 } from 'three';
import { RigidBody, type PhysicsWorld } from '@drawcall/physics';
import { GRAVITY } from '../movement';
import { Engine } from './engine';
import { CHASSIS, type Rover } from './model';

/** How the rover drives: forces in N, speeds in m/s, the front wheels' lock in rad. */
const TUNING = {
  /** stiff enough that the rover's weight settles each spring halfway */
  spring: CHASSIS.mass * -GRAVITY / 4 / (CHASSIS.suspension / 2),
  damping: 6000,
  grip: 1.5,
  driftGrip: 0.35,
  cornering: 4800,
  driveForce: 3200,
  brakeForce: 9000,
  forwardSpeed: 19,
  reverseSpeed: 5,
  steerAngle: 0.6,
  /** how much the lock is cut per m/s, for a steadier wheel at speed */
  lockFade: 0.05,
  /** rolling resistance per m/s of each wheel's rolling speed (N·s/m) */
  rolling: 50,
  /** air drag per (m/s)² (N·s²/m²) */
  drag: 1.2,
  /** how fast the front wheels steer to the asked lock (1/s) */
  steerRate: 6,
  /** the brake the engine gives with the throttle released, of full */
  engineBrake: 0.08,
  /** how fast (m/s) the rover must roll against the pedal held for it to brake rather than drive the other way */
  reversing: 0.5,
};
/** Turns of the steering wheel (rad) per radian the front wheels steer: full lock is an eighth of a turn, as far as the hands turn it
 * without letting go of the rim. */
const STEERING_RATIO = 1.4;
/** How far below the centre of mass (m) the tyres' forces act: what leans the body out of a corner. */
const ROLL_ARM = 0.15;
/** The steepest ground a tyre stands on: its normal's least upward component along the body's up. */
const STEEPEST = 0.25;
const UP = new Vector3(0, 1, 0);

/**
 * Four suspension rays and bounded tyre forces, adapted from @drawcall/physics' car recipe with the nose along +Z: throttle drives
 * forward or, held back once stopped, in reverse; braking holds the wheels.
 */
export class Handling {
  readonly input = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  /** Forward speed (m/s); negative reversing. */
  speed = 0;
  /** The front wheels' lock (rad, + to the left). */
  lock = 0;
  /** How fast the tyre sliding most slid over the ground in the last step (m/s), its grip given way. */
  slip = 0;
  /** How fast the spring compressed fastest has compressed since `jolted` was last asked (m/s): a bump or a landing. */
  private jolt = 0;
  readonly engine = new Engine();
  private readonly unsubscribe: () => void;

  constructor(private readonly world: PhysicsWorld, private readonly rover: Rover) {
    this.unsubscribe = world.onBeforeStep((delta) => this.update(delta));
    this.reset();
  }

  /** The way the nose points (rad about +Y; 0 faces +Z). */
  get yaw() {
    const forward = new Vector3(0, 0, 1).applyQuaternion(this.rover.body.quaternion);
    return Math.atan2(forward.x, forward.z);
  }

  /**
   * Drives as the pedals and wheel ask: `ahead` +1 forward, −1 back, which brakes while the rover still rolls the other way and reverses
   * once it has stopped; `steer` +1 full left; with the throttle released the engine brakes a little. The engine drives only once
   * running, and not through a gear change.
   */
  drive(ahead: number, steer: number, handbrake: boolean) {
    const braking = ahead * this.speed < -TUNING.reversing;
    Object.assign(this.input, { throttle: braking ? 0 : ahead, brake: braking ? 1 : ahead === 0 ? TUNING.engineBrake : 0, steer, handbrake });
  }

  /** Nobody drives: off the throttle, the wheel let go and the handbrake on. */
  park() { Object.assign(this.input, { throttle: 0, steer: 0, brake: 0, handbrake: true }); }

  reset() {
    this.park();
    this.speed = this.lock = this.slip = this.jolt = 0;
    this.engine.reset();
    for (const wheel of this.rover.wheels) {
      wheel.pivot.position.copy(wheel.mount).y -= CHASSIS.suspension / 2;
      wheel.pivot.rotation.y = 0;
      wheel.spin.rotation.x = 0;
    }
    this.rover.steer(0);
  }

  /** How hard the rover has been jolted since this was last asked: how fast its spring compressed fastest has compressed (m/s). */
  jolted() {
    const jolt = this.jolt;
    this.jolt = 0;
    return jolt;
  }

  dispose() { this.unsubscribe(); }

  private update(delta: number) {
    const { body, wheels } = this.rover;
    body.updateWorldMatrix(true, false);
    const rotation = body.getWorldQuaternion(new Quaternion());
    const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
    const down = new Vector3(0, -1, 0).applyQuaternion(rotation);
    const velocity = body.getVelocity().linear;
    const center = body.localToWorld(new Vector3(...CHASSIS.center));
    this.speed = velocity.dot(forward);
    this.engine.update(delta, this.input.throttle, this.speed);
    this.slip = 0;
    const steer = MathUtils.clamp(this.input.steer, -1, 1);
    this.lock = MathUtils.damp(this.lock, steer * TUNING.steerAngle / (1 + Math.abs(this.speed) * TUNING.lockFade), TUNING.steerRate, delta);
    // (the steering wheel turns anticlockwise, as the driver sees it, to steer left)
    this.rover.steer(this.lock * STEERING_RATIO);
    for (const wheel of wheels) {
      const origin = body.localToWorld(wheel.mount.clone());
      const hit = this.world.raycast(origin, down, CHASSIS.suspension + CHASSIS.radius, { excludeBodies: [body] });
      wheel.pivot.rotation.y = wheel.front ? this.lock : 0;
      wheel.pivot.position.y = wheel.mount.y - CHASSIS.suspension;
      if (!hit || hit.kind !== 'body' || !(hit.body instanceof RigidBody) || hit.normal.dot(down) > -STEEPEST) continue;
      const length = Math.max(0, hit.distance - CHASSIS.radius);
      wheel.pivot.position.y = wheel.mount.y - length;
      const relative = body.getVelocityAtPoint(hit.point).sub(hit.body.getVelocityAtPoint(hit.point));
      this.jolt = Math.max(this.jolt, -relative.dot(hit.normal));
      const load = MathUtils.clamp((CHASSIS.suspension - length) * TUNING.spring - relative.dot(hit.normal) * TUNING.damping, 0,
        CHASSIS.mass * -GRAVITY);
      const suspension = hit.normal.clone().multiplyScalar(load);
      body.applyForce(suspension, origin);
      const heading = new Vector3(0, 0, 1).applyAxisAngle(UP, wheel.pivot.rotation.y).applyQuaternion(rotation).projectOnPlane(hit.normal).normalize();
      const side = new Vector3().crossVectors(heading, hit.normal);
      const longitudinal = relative.dot(heading), lateral = relative.dot(side);
      const throttle = this.engine.driving ? MathUtils.clamp(this.input.throttle, -1, 1) : 0;
      const top = throttle < 0 ? TUNING.reverseSpeed : TUNING.forwardSpeed;
      const drive = throttle * TUNING.driveForce * Math.max(0, 1 - Math.max(0, this.speed * Math.sign(throttle)) / top);
      const brake = Math.max(MathUtils.clamp(this.input.brake, 0, 1), !wheel.front && this.input.handbrake ? 1 : 0);
      const stopping = MathUtils.clamp(-longitudinal * CHASSIS.mass / (4 * delta), -brake * TUNING.brakeForce, brake * TUNING.brakeForce);
      const grip = !wheel.front && this.input.handbrake ? TUNING.driftGrip : TUNING.grip;
      const tire = heading.multiplyScalar(drive + stopping - longitudinal * TUNING.rolling).addScaledVector(side, -lateral * TUNING.cornering);
      // (asked for more than it grips, the tyre slides: sideways, and along too with its wheel braked)
      if (tire.length() > load * grip) this.slip = Math.max(this.slip, Math.hypot(lateral, brake > 0.5 ? longitudinal : 0));
      tire.clampLength(0, load * grip);
      // (applied a little below the centre of mass rather than at the ground, so the body leans out of a corner without tipping)
      body.applyForce(tire, origin.clone().addScaledVector(down, ROLL_ARM - origin.clone().sub(center).dot(down)));
      if (hit.body.bodyType === 'dynamic') hit.body.applyForce(suspension.add(tire).negate(), hit.point);
      wheel.spin.rotation.x += longitudinal * delta / CHASSIS.radius;
    }
    body.applyForce(velocity.multiplyScalar(-velocity.length() * TUNING.drag));
  }
}
