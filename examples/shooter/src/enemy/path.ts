import { Vector3 } from 'three';
import type { Navigation, Route } from '../nav';
import type { Soldier } from '../soldier';
import { anglesOf, wrapAngle } from '../angles';
import { ACCEL, GRAVITY, JUMP_SPEED, PUSH_OFF, SPEED } from '../movement';

const ARRIVAL = 0.2;

/** NavCat supplies destinations; the same capsule controller performs every step and jump. */
export class Path {
  private route: Route | null = null;
  private index = 0;
  private jumping = false;
  private airborne = false;
  private stalled = 0;
  private readonly previous = new Vector3();

  constructor(private readonly nav: Navigation, private readonly soldier: Soldier) {}

  go(to: Vector3) {
    this.route = this.nav.path(this.soldier.position, to);
    this.index = 0;
    this.stalled = 0;
    this.jumping = this.airborne = false;
    this.previous.copy(this.soldier.position);
    if (!this.route?.complete) this.stop();
    return this.route?.complete === true;
  }

  stop() {
    this.route = null;
    this.jumping = this.airborne = false;
    this.soldier.movement.input.move.set(0, 0, 0);
    this.soldier.movement.input.jump = this.soldier.movement.input.sprint = false;
  }

  update(dt: number, sprint: boolean): 'moving' | 'arrived' | 'blocked' {
    const { movement, position } = this.soldier, { input } = movement;
    if (!this.route?.complete) { this.stop(); return 'blocked'; }
    if (this.jumping && !movement.grounded) this.airborne = true;
    if (this.airborne && movement.grounded) this.jumping = this.airborne = false;
    let point = this.route.points[this.index];
    while (point && !point.jump && Math.hypot(point.position.x - position.x, point.position.z - position.z) < ARRIVAL
      && Math.abs(point.position.y - position.y) < 0.25 && !this.jumping) point = this.route.points[++this.index];
    if (!point) { this.stop(); return 'arrived'; }
    if (point.jump && point.position.distanceTo(position) < 0.45 && movement.grounded && !this.jumping) {
      this.jumping = true;
      point = this.route.points[++this.index];
      if (!point) throw new Error('A navigation jump needs a landing');
    }
    const direction = point.position.clone().sub(position).setY(0), distance = direction.length();
    direction.normalize();
    const ahead = position.clone().addScaledVector(direction, 0.5);
    input.crouch = !this.jumping && (point.crouch || this.nav.requiresCrouch(ahead));
    input.jump = this.jumping && !this.airborne;
    // Slow before a corner or destination using the same acceleration that the motor brakes with.
    const braking = Math.max(0, movement.speed ** 2 - SPEED.forward ** 2) / (2 * ACCEL.ground);
    let running = sprint && distance > braking + ARRIVAL;
    if (this.jumping) {
      // Steer the existing motor toward the landing's ballistic arrival time, including its push-off.
      const rise = point.position.y - position.y, vertical = this.airborne ? movement.velocity.y : JUMP_SPEED;
      const flight = (-vertical - Math.sqrt(Math.max(0, vertical ** 2 + 2 * GRAVITY * rise))) / GRAVITY;
      const remaining = flight + (this.airborne ? 0 : PUSH_OFF * (1 - movement.takeoff));
      const speed = Math.hypot(point.position.x - position.x, point.position.z - position.z) / Math.max(dt, remaining);
      running = movement.actualVelocity.dot(direction) < speed;
    }
    input.sprint = !input.crouch && running;
    input.move.copy(direction);
    if (input.sprint || !input.aim) input.yaw = turn(input.yaw, anglesOf(direction).yaw, dt * 5);
    const travelled = position.distanceTo(this.previous);
    this.stalled = travelled < 0.002 && movement.grounded ? this.stalled + dt : 0;
    this.previous.copy(position);
    if (this.stalled < 0.9) return 'moving';
    this.stop();
    return 'blocked';
  }
}

export function turn(from: number, to: number, limit: number) {
  return from + Math.max(-limit, Math.min(limit, wrapAngle(to - from)));
}
