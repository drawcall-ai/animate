import { POINT } from '@drawcall/animate';
import { BoxCollider, type PhysicsWorld, type RigidBody } from '@drawcall/physics';
import { BoxGeometry, CylinderGeometry, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';

export type Level = 'down' | 'up';

/** How far the lift rises from its foot to the upper deck (m), how long a ride takes (s), and how long after a press it sets off (s). */
const RISE = 2.2;
const RIDE = 4.5;
const DEPARTS = 0.8;
/**
 * Its button panel (m, the platform's frame): a post on its +X edge with the panel facing in across the platform at a standing soldier's
 * chest; each button `radius` round, standing `out` off the panel's face, `apart` above and below its middle, and pushed `travel` in by a
 * press, over `pushing` (s).
 */
const PANEL = { at: new Vector3(1.48, 0.125, 0.35), height: 1.12, face: { wide: 0.12, high: 0.2, deep: 0.03 } };
const BUTTON = { radius: 0.02, out: 0.008, apart: 0.045, travel: 0.005, pushing: 0.08 };
/** How near the panel a soldier's feet must stand to press a button on it (m, across the platform), and how far to either side of it. */
const REACH = { near: 0.35, far: 0.85, side: 0.45 };

/**
 * The course's lift: a kinematic platform that stays at the foot or at the upper deck until a button on the panel on it is pressed, then
 * rides to the other level. Each button is a thing of its own (massless: a fixture) with a grip, `press`, its face — the index's pad goes
 * on it, the other fingers folded under the thumb (`userData.pad`, `fingers`), the hand placed from that fingertip — so a press pushes the
 * button in and the pad on it with it; a pressed button lights until the lift has arrived.
 */
export class Lift {
  readonly buttons: Record<Level, Object3D>;
  private level: Level = 'down';
  /** where it is riding to and when it set off (s, the world's time), while it rides or is about to */
  private ride: { to: Level; from: number } | null = null;
  private pressed: { button: Object3D; at: number } | null = null;
  private time = 0;
  private readonly foot: Vector3;
  private readonly lit: MeshStandardMaterial;
  private readonly unlit: MeshStandardMaterial;
  private readonly materials: MeshStandardMaterial[];

  constructor(readonly body: RigidBody, panel: MeshStandardMaterial) {
    this.foot = body.position.clone();
    this.lit = new MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb020', emissiveIntensity: 1.4, roughness: 0.4 });
    this.unlit = new MeshStandardMaterial({ color: '#d9dfdb', roughness: 0.5 });
    this.materials = [this.lit, this.unlit];
    const { at, height, face } = PANEL;
    const post = new Mesh(new BoxGeometry(0.08, height, 0.08), panel);
    post.position.set(at.x + 0.04, at.y + height / 2, at.z);
    const plate = new Mesh(new BoxGeometry(face.deep, face.high, face.wide), panel);
    plate.position.set(at.x - face.deep / 2, at.y + height, at.z);
    const collider = new BoxCollider({ size: [0.08, height, 0.08] });
    collider.position.copy(post.position);
    body.add(post, plate, collider);
    const button = (level: Level, up: number) => {
      const part = new Object3D();
      part.name = `lift ${level} button`;
      part.position.set(at.x - face.deep, at.y + height + up, at.z);
      const cap = new Mesh(new CylinderGeometry(BUTTON.radius, BUTTON.radius, BUTTON.out, 20).rotateZ(Math.PI / 2), this.unlit);
      cap.position.x = -BUTTON.out / 2;
      // (an arrow on the cap, the way it sends the lift)
      const arrow = new Mesh(new CylinderGeometry(0, 0.009, 0.012, 3).rotateZ(level === 'up' ? 0 : Math.PI), panel);
      arrow.position.x = -BUTTON.out - 0.0005;
      arrow.scale.x = 0.05;
      const press = new Object3D();
      press.name = 'press';
      press.position.x = -BUTTON.out;
      Object.assign(press.userData, { pad: 'index', facing: [1, 0, 0], fingers: { ...POINT, index: { curl: 0, hook: 0.1, spread: 0 } } });
      part.add(cap, arrow, press);
      body.add(part);
      return part;
    };
    this.buttons = { up: button('up', BUTTON.apart), down: button('down', -BUTTON.apart) };
  }

  /** Whether it rides or is about to, a button pressed. */
  get moving() { return this.ride !== null; }

  /**
   * The button a soldier standing with its feet at `feet` (world) would press: by the panel on the platform, the one that sends the lift to
   * the other level; none while it rides or is about to, or the soldier stands away from the panel.
   */
  within(feet: Readonly<Vector3>): Object3D | null {
    if (this.ride) return null;
    const local = this.body.worldToLocal(feet.clone()), across = PANEL.at.x - local.x;
    const by = across > REACH.near && across < REACH.far && Math.abs(local.z - PANEL.at.z) < REACH.side && Math.abs(local.y - PANEL.at.y) < 0.2;
    return by ? this.buttons[this.level === 'down' ? 'up' : 'down'] : null;
  }

  /** `button`, under a fingertip, pressed in: it lights and the lift sets off for its level shortly (`within` offers the one that does). */
  press(button: Object3D) {
    const level = (Object.keys(this.buttons) as Level[]).find((each) => this.buttons[each] === button);
    if (!level) throw new Error(`"${button.name}" is none of the lift's buttons`);
    if (level === this.level || this.ride) throw new Error(`The lift is ${this.ride ? 'riding' : `${level} already`}: its ${level} button sends it nowhere`);
    this.pressed = { button, at: this.time };
    for (const child of button.children) if (child instanceof Mesh && child.material === this.unlit) child.material = this.lit;
    this.ride = { to: level, from: this.time + DEPARTS };
  }

  /** Moves it each physics step of `world`, and starts it afresh at its foot. */
  bind(world: PhysicsWorld) {
    this.level = 'down';
    this.ride = this.pressed = null;
    for (const button of Object.values(this.buttons)) this.release(button);
    const pose = new Matrix4();
    return world.onBeforeStep((delta) => {
      this.time = world.time + delta;
      this.pushButton();
      this.body.setKinematicTarget(pose.makeTranslation(this.foot.x, this.foot.y + RISE * this.height(), this.foot.z));
    });
  }

  dispose() {
    for (const material of this.materials) material.dispose();
  }

  /** how far up it is (0 at its foot … 1 at the deck): a ride eased in and out */
  private height(): number {
    const at = this.level === 'up' ? 1 : 0, ride = this.ride;
    if (!ride) return at;
    const s = Math.min(1, Math.max(0, (this.time - ride.from) / RIDE));
    if (s === 1) {
      this.level = ride.to;
      this.ride = null;
      if (this.pressed) this.release(this.pressed.button);
      this.pressed = null;
    }
    return at + ((ride.to === 'up' ? 1 : 0) - at) * (1 - Math.cos(Math.PI * s)) / 2;
  }

  /** the pressed button pushed in over `BUTTON.pushing`, and back out as the lift sets off */
  private pushButton() {
    if (!this.pressed) return;
    const { button, at } = this.pressed, out = this.ride && this.time > this.ride.from;
    const s = out ? 0 : Math.min(1, (this.time - at) / BUTTON.pushing);
    button.position.x = PANEL.at.x - PANEL.face.deep + BUTTON.travel * s;
  }

  private release(button: Object3D) {
    button.position.x = PANEL.at.x - PANEL.face.deep;
    for (const child of button.children) if (child instanceof Mesh && child.material === this.lit) child.material = this.unlit;
  }
}
