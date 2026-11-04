import { Matrix4, Vector3, type Object3D } from 'three';
import { CapsuleMotor, type CapsuleCastHit, type PhysicsWorld, type RigidBody } from '@drawcall/physics';

interface Support {
  body: RigidBody;
  pose: Matrix4;
  normal: Vector3;
  point: Vector3;
}

export const HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.45;
export const RADIUS = 0.3;
const BUFFER = 0.12;
/** How near the ground (m) must come for a falling capsule to land on it, and how far below one just placed it may be to stand on. */
const LANDING = 0.025, PLACING = 0.1;
/** Seconds of knee bend before the jump launches the capsule. */
export const PUSH_OFF = 0.05;
export const JUMP_SPEED = 5;
export const ACCEL = { ground: 10, air: 2 };
export const GRAVITY = -14;
export const SPEED = { forward: 1.4, back: 1.1, side: 1.1, sprint: 3.5, aiming: 0.65, crouching: 0.8 / 1.4 };
const UP = new Vector3(0, 1, 0);

/** Game policy adapted from the physics package's character recipe; CapsuleMotor owns collision (the capsule never pushes rigid bodies). */
export class Movement {
  readonly input = { move: new Vector3(), yaw: 0, sprint: false, aim: false, crouch: false, jump: false };
  /** Collision response carried into the next physics step. */
  readonly velocity = new Vector3();
  /** Completed displacement per second, excluding motion from the supporting platform. */
  readonly actualVelocity = new Vector3();
  /** Whether the capsule moves; a stopped one stays out of play until `reset`. */
  private active = true;
  private readonly motor: CapsuleMotor;
  private readonly spawn: Vector3;
  private readonly unsubscribe: () => void;
  private ground: Support | undefined;
  private readonly supportVelocity = new Vector3();
  private jumpBuffer = 0;
  private coyoteTime = 0;
  private jumped = false;
  private launch = 0;

  constructor(private readonly world: PhysicsWorld, readonly object: Object3D) {
    if (world.gravity[0] !== 0 || world.gravity[2] !== 0 || world.gravity[1] >= 0)
      throw new Error('Character movement requires downward Y gravity');
    this.motor = new CapsuleMotor(world, object, RADIUS, HEIGHT);
    this.spawn = this.motor.position.clone();
    // Supports have completed their physics step before the motor follows their actual poses.
    this.unsubscribe = world.onAfterStep((delta) => this.update(delta));
  }

  get grounded(): boolean { return this.ground !== undefined; }
  get support(): Vector3 | null { return this.ground?.point ?? null; }
  get platform(): Object3D | undefined { return this.ground?.body; }
  get position(): Vector3 { return this.motor.position; }
  get height(): number { return this.motor.height; }
  get crouched(): boolean { return this.height < HEIGHT; }
  get speed(): number { return Math.hypot(this.actualVelocity.x, this.actualVelocity.z); }
  get takeoff(): number { return this.launch > 0 ? 1 - this.launch / PUSH_OFF : 0; }
  get sprinting(): boolean {
    const { move, yaw, sprint, aim, crouch } = this.input;
    return sprint && !aim && !crouch && !this.crouched && move.x * Math.sin(yaw) + move.z * Math.cos(yaw) > 1e-6;
  }

  reset(position: Vector3 = this.spawn): void {
    this.active = true;
    this.motor.position.copy(position);
    this.motor.height = CROUCH_HEIGHT;
    if (!this.motor.resize(HEIGHT)) throw new Error('No room to stand where the capsule was placed: place it a little above the ground, clear of walls');
    this.halt();
    this.input.yaw = 0;
    // (placed just above the ground, it stands on it at once rather than landing on its first step)
    this.ground = supportOf(this.motor.ground(PLACING));
    this.supportVelocity.set(0, 0, 0);
    this.jumped = false;
    this.jumpBuffer = this.coyoteTime = 0;
    this.launch = 0;
    this.motor.commit();
  }

  /** Takes the capsule out of play until `reset`, standing still and asked nothing: a dead soldier's. */
  stop(): void {
    this.active = false;
    this.halt();
  }

  dispose(): void { this.unsubscribe(); }

  private halt(): void {
    this.velocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.input.move.set(0, 0, 0);
    this.input.sprint = this.input.aim = this.input.crouch = this.input.jump = false;
  }

  private update(delta: number): void {
    if (!this.active) return;
    this.transport(delta);
    const previous = this.position.clone();
    this.motor.recover();
    this.motor.resize(this.input.crouch ? CROUCH_HEIGHT : HEIGHT);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - delta);
    if (this.input.jump && !this.jumped) this.jumpBuffer = BUFFER;
    this.jumped = this.input.jump;
    this.coyoteTime = this.grounded ? BUFFER : Math.max(0, this.coyoteTime - delta);

    const target = this.input.move.clone().setY(0).applyAxisAngle(UP, -this.input.yaw);
    const length = target.length();
    if (length > 0) {
      // A sprint, straight or diagonal, runs at full speed; walking speed depends on direction.
      const forward = target.z > 0 ? SPEED.forward : SPEED.back;
      const speed = this.sprinting ? SPEED.sprint : 1 / Math.hypot(target.x / length / SPEED.side, target.z / length / forward);
      target.setLength(speed * (this.input.aim ? SPEED.aiming : 1) * (this.crouched ? SPEED.crouching : 1));
    }
    target.applyAxisAngle(UP, this.input.yaw);
    const horizontal = this.velocity.clone().setY(0);
    this.velocity.add(target.sub(horizontal).clampLength(0, (this.grounded ? ACCEL.ground : ACCEL.air) * delta));

    const preparing = this.launch > 0;
    this.launch = Math.max(0, this.launch - delta);
    let jumping = preparing && this.launch === 0 && this.coyoteTime > 0;
    if (!preparing && this.jumpBuffer > 0 && this.coyoteTime > 0) {
      this.jumpBuffer = 0;
      if (this.grounded) this.launch = PUSH_OFF;
      else jumping = true;
    }
    if (jumping) {
      this.velocity.y = JUMP_SPEED;
      this.jumpBuffer = this.coyoteTime = 0;
      this.ground = undefined;
    }
    this.velocity.y += this.world.gravity[1] * delta;
    const wasGrounded = this.grounded;
    const rising = this.velocity.y > 0.1 && !wasGrounded;
    const motion = this.velocity.clone();
    if (wasGrounded && this.ground)
      motion.setY(0).projectOnPlane(this.ground.normal).setLength(Math.hypot(this.velocity.x, this.velocity.z));
    const normals = this.motor.move(motion.multiplyScalar(delta), wasGrounded && !jumping);
    for (const normal of normals) {
      if (normal.y >= Math.SQRT1_2) {
        this.velocity.y = Math.max(0, this.velocity.y);
        continue;
      }
      const inward = this.velocity.dot(normal);
      if (inward < 0) this.velocity.addScaledVector(normal, -inward);
      if (wasGrounded && normal.y > 0) this.velocity.y = Math.min(0, this.velocity.y);
    }

    this.ground = !jumping && !rising ? supportOf(this.motor.ground(wasGrounded ? 0.3 : LANDING)) : undefined;
    if (this.ground) this.velocity.y = 0;
    // The platform already carried us this step. Its velocity applies on subsequent airborne steps.
    if (jumping || (wasGrounded && !this.ground)) this.velocity.add(this.supportVelocity);
    this.actualVelocity.subVectors(this.position, previous).divideScalar(delta);
    this.motor.commit();
  }

  private transport(delta: number): void {
    this.supportVelocity.set(0, 0, 0);
    const support = this.ground;
    if (!support || support.body.world !== this.world) return;
    support.body.updateWorldMatrix(true, false);
    const carried = this.position.clone().applyMatrix4(support.pose.clone().invert()).applyMatrix4(support.body.matrixWorld);
    const displacement = carried.sub(this.position);
    this.supportVelocity.copy(displacement).divideScalar(delta);
    this.motor.carry(displacement, support.body);
  }
}

function supportOf(hit: CapsuleCastHit | null): Support | undefined {
  return hit ? { body: hit.body, pose: hit.body.matrixWorld.clone(), normal: hit.normal, point: hit.point } : undefined;
}
