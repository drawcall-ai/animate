import { BoxCollider, RigidBody, type PhysicsWorld } from '@drawcall/physics';
import { BoxGeometry, CylinderGeometry, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';

export type Level = 'down' | 'up';

/** A button of the lift's: on its own panel, sending it `to` the other level; or on a landing's post (`call`), calling it there. */
export interface Button {
  readonly part: Object3D;
  readonly to: Level;
  readonly call: boolean;
}

/** How far the lift rises from its foot to the upper deck (m), how long a ride takes (s), and how long after a press it sets off (s). */
const RISE = 2.2;
const RIDE = 4.5;
const DEPARTS = 0.8;
/**
 * A button panel (m, its frame: its foot on the floor below its face's middle, +Z out of the face): a post up to a housing `height` up,
 * just above a standing soldier's elbow, so that the forearm comes to a button level, the elbow low; a face plate `z` thick on its front;
 * each button `radius` round in a dark bezel `bezel` round, `apart` from the next, its cap standing `out` off the plate and pushed `travel`
 * in by a press (still proud of its bezel, and seen to go in), over `pushing` (s).
 */
const PANEL = { height: 1.2, post: 0.07, wide: 0.15, deep: 0.06, z: 0.004 };
const BUTTON = { radius: 0.02, bezel: 0.027, out: 0.012, apart: 0.09, travel: 0.008, pushing: 0.08 };
/** Where the game offers a press to the player, whose body cannot step to the button itself: its feet within a forearm's to an arm's
 * reach of the panel's face (m), a little to its right (`aside`, m) so that the left hand presses while the rifle in the right passes the
 * panel (the library does not keep held things out of props), and facing it (the cosine of the most it may look away). */
const REACH = { near: 0.38, far: 0.55, aside: { least: 0.085, most: 0.2 }, facing: Math.cos(1.1) };
const UP = new Vector3(0, 1, 0);

/**
 * The course's lift: a kinematic platform that stays at the foot or at the upper deck until one of its buttons is pressed, then rides to
 * the other level. On it a panel sends it up or down; on each landing a post calls it there. Each button is a thing of its own (massless: a
 * fixture) with one grip, `press`: its cap's face, where the left index's pad goes (`userData.point`), pressed straight in (`facing`): the
 * hand comes as a loose fist to before it, points and pushes in; the cap and the pad on it go in with the press.
 * A pressed button lights until the lift arrives.
 */
export class Lift {
  /** the buttons on its own panel, by the level each sends it to */
  readonly buttons: Record<Level, Button>;
  /** the call buttons on its landings' posts, by the level each calls it to */
  readonly calls: Record<Level, Button>;
  private readonly panels: { frame: Object3D; buttons: Button[] }[] = [];
  private readonly caps = new Map<Button, Mesh>();
  private level: Level = 'down';
  /** where it is riding to and when it set off (s, the world's time), while it rides or is about to */
  private ride: { to: Level; from: number } | null = null;
  private pressed: { button: Button; at: number } | null = null;
  private time = 0;
  private readonly foot: Vector3;
  private readonly lit = new MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb020', emissiveIntensity: 1.4, roughness: 0.4 });
  private readonly unlit = new MeshStandardMaterial({ color: '#d9dfdb', roughness: 0.5 });
  private readonly bezel = new MeshStandardMaterial({ color: '#1d2427', roughness: 0.6 });
  private readonly plate = new MeshStandardMaterial({ color: '#7d898d', roughness: 0.55, metalness: 0.3 });

  /**
   * The lift on `body` (its floor 0.125 m above `body`'s origin), its panel on its +X edge facing in across it, and a call post on each
   * landing at `landings`' points (world: the floor below the post's face) facing `yaw` (rad, about +Y from +Z), in `body`'s parent; its
   * posts in `material`.
   */
  constructor(readonly body: RigidBody, private readonly material: MeshStandardMaterial, landings: Record<Level, { at: Vector3; yaw: number }>) {
    this.foot = body.position.clone();
    const parent = body.parent;
    if (!parent) throw new Error('The lift\'s body must stand in the scene before its call posts can stand beside it');
    const car = new Object3D();
    car.position.set(1.48, 0.125, 0.35);
    car.rotation.y = -Math.PI / 2;
    body.add(car);
    const [up, down] = this.panel(car, [{ to: 'up', call: false }, { to: 'down', call: false }]);
    body.add(this.collider(car));
    this.buttons = { up, down };
    const call = (to: Level) => {
      const post = new RigidBody({ bodyType: 'static' });
      post.name = `Lift call post (${to})`;
      post.position.copy(landings[to].at);
      post.rotation.y = landings[to].yaw;
      parent.add(post);
      post.add(this.collider(post));
      return this.panel(post, [{ to, call: true }])[0];
    };
    this.calls = { up: call('up'), down: call('down') };
  }

  /** Whether it rides or is about to, a button pressed. */
  get moving() { return this.ride !== null; }

  /**
   * The button a soldier standing with its feet at `feet` (world) facing `yaw` (rad, about +Y from +Z) would press: on the panel it stands
   * at (`at`), the one that sends the lift away or calls it; none while it rides or is about to, or the soldier is at no panel.
   */
  within(feet: Readonly<Vector3>, yaw: number): Button | null {
    if (this.ride) return null;
    return this.panelAt(feet, yaw)?.buttons.find((each) => each.to !== this.level) ?? null;
  }

  /** Whether a soldier with its feet at `feet` facing `yaw` stands before one of its panels and faces it, the lift riding or not. */
  at(feet: Readonly<Vector3>, yaw: number): boolean {
    return this.panelAt(feet, yaw) !== null;
  }

  /** `button`, under a fingertip, pressed in: it lights and the lift sets off for its level shortly (`within` offers the one that does). */
  press(button: Button) {
    const cap = this.caps.get(button);
    if (!cap) throw new Error(`"${button.part.name}" is none of the lift's buttons`);
    if (button.to === this.level || this.ride) throw new Error(`The lift is ${this.ride ? 'riding' : `${button.to} already`}: "${button.part.name}" sends it nowhere`);
    this.pressed = { button, at: this.time };
    cap.material = this.lit;
    this.ride = { to: button.to, from: this.time + DEPARTS };
  }

  /** Moves it each physics step of `world`, and starts it afresh at its foot. */
  bind(world: PhysicsWorld) {
    this.level = 'down';
    this.ride = this.pressed = null;
    for (const button of this.caps.keys()) this.release(button);
    const pose = new Matrix4();
    return world.onBeforeStep((delta) => {
      this.time = world.time + delta;
      this.pushButton();
      this.arrive();
      this.body.setKinematicTarget(pose.makeTranslation(this.foot.x, this.foot.y + RISE * this.height(), this.foot.z));
    });
  }

  dispose() {
    for (const material of [this.lit, this.unlit, this.bezel, this.plate]) material.dispose();
  }

  /**
   * A panel in `frame` (see `PANEL`) with `asked`'s buttons top to bottom: a post up to a housing, its face plate, and each button in its
   * bezel, an arrow on its cap the way it takes the soldier (a call post's, from its landing) — each a thing with its grip `press`
   */
  private panel(frame: Object3D, asked: { to: Level; call: boolean }[]): Button[] {
    const { height, post, wide, deep, z } = PANEL, high = asked.length * BUTTON.apart + 0.05, below = height - high / 2;
    const box = (size: [number, number, number], at: [number, number, number], material: MeshStandardMaterial) => {
      const mesh = new Mesh(new BoxGeometry(...size), material);
      mesh.position.set(...at);
      mesh.castShadow = true;
      frame.add(mesh);
    };
    box([post, below, post], [0, below / 2, -deep / 2], this.material);
    box([wide, high, deep], [0, height, -deep / 2], this.material);
    box([wide - 0.02, high - 0.02, z], [0, height, z / 2], this.plate);
    const buttons = asked.map(({ to, call }, index) => {
      const part = new Object3D();
      part.name = call ? `lift call button (${to})` : `lift ${to} button`;
      part.position.set(0, height + ((asked.length - 1) / 2 - index) * BUTTON.apart, z);
      const bezel = new Mesh(new CylinderGeometry(BUTTON.bezel, BUTTON.bezel, 0.002, 24).rotateX(Math.PI / 2), this.bezel);
      bezel.position.copy(part.position).setZ(z + 0.001);
      // (the cap beside the button's thing, pushed in with it: a hand goes round a thing's meshes to its grip, and round the cap's top)
      const cap = new Mesh(new CylinderGeometry(BUTTON.radius, BUTTON.radius, BUTTON.out, 24).rotateX(Math.PI / 2).translate(0, 0, BUTTON.out / 2), this.unlit);
      cap.position.copy(part.position);
      const rising = call ? to === 'down' : to === 'up';
      const arrow = new Mesh(new CylinderGeometry(0, 0.009, 0.012, 3).rotateZ(rising ? 0 : Math.PI), this.bezel);
      arrow.position.z = BUTTON.out + 0.0005;
      arrow.scale.z = 0.05;
      cap.add(arrow);
      // (its face, where the index's pad goes, pressed straight in)
      const press = new Object3D();
      press.name = 'press';
      press.position.z = BUTTON.out;
      Object.assign(press.userData, { point: 'index', facing: [0, 0, -1] });
      part.add(press);
      frame.add(bezel, cap, part);
      const button = { part, to, call };
      this.caps.set(button, cap);
      return button;
    });
    this.panels.push({ frame, buttons });
    return buttons;
  }

  /** the panel a soldier with its feet at `feet` facing `yaw` stands before and faces (see `REACH`) */
  private panelAt(feet: Readonly<Vector3>, yaw: number): { frame: Object3D; buttons: Button[] } | null {
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), local = new Vector3(), out = new Vector3();
    return this.panels.find(({ frame }) => {
      frame.updateWorldMatrix(true, false);
      frame.worldToLocal(local.copy(feet));
      if (local.z < REACH.near || local.z > REACH.far || local.x < REACH.aside.least || local.x > REACH.aside.most || Math.abs(local.y) > 0.2) return false;
      return -forward.dot(out.set(0, 0, 1).transformDirection(frame.matrixWorld)) >= REACH.facing;
    }) ?? null;
  }

  /** the housing and post of the panel in `frame` as one box, for `frame`'s body: `frame` itself, else the lift's that it stands on */
  private collider(frame: Object3D): BoxCollider {
    const collider = new BoxCollider({ size: [PANEL.wide, PANEL.height, PANEL.deep] }), at = new Vector3(0, PANEL.height / 2, -PANEL.deep / 2);
    if (frame instanceof RigidBody) collider.position.copy(at);
    else {
      collider.position.copy(at.applyAxisAngle(UP, frame.rotation.y).add(frame.position));
      collider.rotation.y = frame.rotation.y;
    }
    return collider;
  }

  /** how far through `ride` it is (0 … 1, eased in and out) */
  private through(ride: { from: number }): number {
    return (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, (this.time - ride.from) / RIDE)))) / 2;
  }

  /** how far up it is (0 at its foot … 1 at the deck) */
  private height(): number {
    const at = this.level === 'up' ? 1 : 0, ride = this.ride;
    return ride ? at + ((ride.to === 'up' ? 1 : 0) - at) * this.through(ride) : at;
  }

  /** at the end of its ride, at its level: its button let go */
  private arrive() {
    if (!this.ride || this.through(this.ride) < 1) return;
    this.level = this.ride.to;
    this.ride = null;
    if (this.pressed) this.release(this.pressed.button);
    this.pressed = null;
  }

  /** the pressed button pushed in over `BUTTON.pushing`, and back out as the lift sets off */
  private pushButton() {
    if (!this.pressed) return;
    const { button, at } = this.pressed, out = this.ride && this.time > this.ride.from;
    this.push(button, out ? 0 : BUTTON.travel * Math.min(1, (this.time - at) / BUTTON.pushing));
  }

  /** `button` pushed `depth` in (m), its cap and its grips together */
  private push(button: Button, depth: number) {
    button.part.position.z = PANEL.z - depth;
    this.caps.get(button)?.position.setZ(PANEL.z - depth);
  }

  private release(button: Button) {
    this.push(button, 0);
    const cap = this.caps.get(button);
    if (cap) cap.material = this.unlit;
  }
}
