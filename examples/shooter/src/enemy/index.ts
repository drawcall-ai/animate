import type { PhysicsWorld } from '@drawcall/physics';
import { Vector3 } from 'three';
import { anglesOf, lookDirection } from '../angles';
import { MAGAZINE } from '../combat';
import type { Navigation } from '../nav';
import type { Soldier } from '../soldier';
import { coverAt, visible, type Cover } from './cover';
import { Path, turn } from './path';

/** Seconds by which the enemy's aim follows what it sees. */
const PERCEPTION = 0.12;

type State = 'search' | 'move' | 'hide' | 'peek' | 'burst' | 'retreat' | 'reload';

/** A small cover loop with sight, reaction time and remembered positions instead of omniscient tracking. */
export class Enemy {
  state: State = 'search';
  private readonly path: Path;
  private cover: Cover | undefined;
  private known: Vector3 | undefined;
  private readonly target = new Vector3();
  private seen = false;
  private scan = 0;
  private elapsed = 0;
  private unseen = 0;
  private shots = 0;
  private bursts = 0;
  private respawn = 0;
  private patrol = 0;

  constructor(readonly soldier: Soldier, private readonly player: Soldier, private readonly nav: Navigation, private readonly world: PhysicsWorld) {
    this.path = new Path(nav, soldier);
    soldier.combat.damage = 12;
  }

  get status() {
    if (!this.soldier.alive) return 'Regrouping';
    return { search: 'Searching', move: 'Relocating', hide: 'In cover', peek: 'Peeking', burst: 'Firing', retreat: 'Taking cover', reload: 'Reloading' }[this.state];
  }

  reset() {
    this.path.stop();
    this.state = 'search';
    this.cover = this.known = undefined;
    this.scan = this.elapsed = this.unseen = this.shots = this.bursts = this.respawn = this.patrol = 0;
    this.seen = false;
  }

  hear(position: Vector3) {
    // A sound tells it nothing about a player it sees.
    if (this.seen || position.distanceTo(this.soldier.position) > 35) return;
    this.known = position.clone();
    this.target.copy(position).y += 1.3;
    this.unseen = 0;
  }

  update(dt: number) {
    const { soldier } = this, { movement } = soldier, { input } = movement;
    if (!soldier.alive) {
      this.respawn += dt;
      if (this.respawn > 4) { soldier.reset(undefined, Math.PI); this.reset(); }
      return;
    }
    if (!this.player.alive) { this.path.stop(); return; }
    this.elapsed += dt;
    this.scan -= dt;
    if (this.scan <= 0) { this.sense(); this.scan = 0.12; }
    // What it sees it follows every step, a perception's lag behind; sensing decides, at its reaction pace, whether it sees the player.
    if (this.seen) {
      this.known = this.player.position.clone();
      const chest = this.player.avatar.body.bones.chest.getWorldPosition(new Vector3());
      chest.y += 0.1;
      this.target.lerp(chest, 1 - Math.exp(-dt / PERCEPTION));
    }
    this.unseen = this.seen ? 0 : this.unseen + dt;
    if (this.unseen > 10) this.known = undefined;
    soldier.aim = this.state === 'peek' || this.state === 'burst' || this.state === 'retreat';
    input.sprint = input.crouch = input.jump = false;
    if (this.state !== 'move' && this.state !== 'search') this.look(dt, true);

    if (this.state === 'search') {
      if (this.known && this.elapsed > 0.3) { this.relocate(); return; }
      if (this.elapsed > 1 && this.path.update(dt, false) !== 'moving') {
        const box = this.nav.covers[this.patrol++ % this.nav.covers.length];
        if (box) this.path.go(box.getCenter(new Vector3()).setY(box.min.y).add(new Vector3(0, 0, 1)));
        this.elapsed = 0;
      }
      this.look(dt, false);
      return;
    }
    if (!this.known) { this.enter('search'); this.path.stop(); return; }
    if (this.state === 'move' || this.state === 'peek' || this.state === 'retreat') {
      const result = this.path.update(dt, this.state === 'move');
      if (!input.aim) this.look(dt, false);
      if (result === 'blocked') { this.relocate(); return; }
      if (result === 'arrived') {
        this.path.stop();
        this.enter(this.state === 'peek' ? 'burst' : this.cover ? 'hide' : 'burst');
      }
      return;
    }
    input.move.set(0, 0, 0);
    if (this.state === 'reload') {
      input.crouch = !!this.cover;
      if (!soldier.avatar.reloading && soldier.combat.ammo === MAGAZINE) this.enter('hide');
      return;
    }
    if (this.state === 'hide') {
      input.crouch = true;
      if (soldier.combat.ammo <= 8 || this.bursts >= 2 && soldier.combat.ammo < MAGAZINE) { soldier.reload(); this.enter('reload'); return; }
      if (this.elapsed < 0.65) return;
      if (!this.cover || this.bursts >= 2 || !visible(this.world, this.cover.peek.clone().add(new Vector3(0, 1.6, 0)), this.target)) { this.relocate(); return; }
      this.path.go(this.cover.peek);
      this.enter('peek');
      return;
    }
    if (this.state !== 'burst' || this.elapsed < 0.3) return;
    const eye = soldier.avatar.look().eye, muzzle = soldier.avatar.muzzle.getWorldPosition(new Vector3());
    const direction = soldier.avatar.muzzle.getWorldDirection(new Vector3());
    const aimed = direction.angleTo(this.target.clone().sub(muzzle)) < 0.075;
    if (this.seen && aimed && visible(this.world, eye, this.target) && visible(this.world, muzzle, this.target) && soldier.shoot()) this.shots++;
    if (this.shots < 4 && soldier.combat.ammo > 0 && this.elapsed < 2) return;
    this.bursts++;
    if (this.cover) { this.path.go(this.cover.hide); this.enter('retreat'); }
    else if (soldier.combat.ammo <= 8) { soldier.reload(); this.enter('reload'); }
    else this.relocate();
  }

  private sense() {
    const eye = this.soldier.avatar.look().eye;
    const chest = this.player.avatar.body.bones.chest.getWorldPosition(new Vector3());
    const head = this.player.avatar.body.bones.head.getWorldPosition(new Vector3());
    const direction = chest.clone().sub(eye);
    // Metres the chest lies ahead of the eye along the heading: anything less than 1 m behind it can be seen.
    const ahead = direction.dot(lookDirection(this.soldier.movement.input.yaw, 0));
    this.seen = direction.length() < 40 && ahead > -1 && (visible(this.world, eye, chest) || visible(this.world, eye, head));
  }

  private look(dt: number, atThreat: boolean) {
    const { movement, view, avatar } = this.soldier, eye = avatar.look().eye;
    let pitch = -0.06, distance = 20;
    if (atThreat && this.known) {
      const direction = this.target.clone().sub(eye), toward = anglesOf(direction);
      movement.input.yaw = turn(movement.input.yaw, toward.yaw, dt * 4);
      pitch = toward.pitch;
      distance = direction.length();
    }
    view.pitch += Math.max(-dt * 2, Math.min(dt * 2, pitch - view.pitch));
    lookDirection(movement.input.yaw, view.pitch, view.aimPoint).multiplyScalar(distance).add(eye);
  }

  private relocate() {
    if (!this.known) { this.enter('search'); return; }
    this.cover = coverAt(this.nav, this.world, this.soldier.position, this.target, this.cover);
    this.bursts = 0;
    const toward = this.soldier.position.clone().sub(this.known).setY(0).normalize();
    const goal = this.cover?.hide ?? this.known.clone().addScaledVector(toward, 5);
    if (!this.path.go(goal) && !this.path.go(this.known)) { this.enter('search'); return; }
    this.enter('move');
  }

  private enter(state: State) { this.state = state; this.elapsed = this.shots = 0; }
}
