import { attempt, carry, grab, release, throwAt, type Body } from '@drawcall/animate';
import { parallel } from '@pmndrs/timeline';
import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { Grenades } from '.';
import { GrenadeModel } from './model';

const QUICK = { speed: 2, step: false };
const SLOTS = [[-0.10, -0.10, 0.22], [-0.21, -0.10, 0.19], [-0.25, -0.23, 0.14]] as const;
/** where the grenade is held up for the pin, out from the right shoulder: ahead, a little across the chest */
const READY = new Vector3(0.3, 0, 1);
/** the throw's speed along the view (m/s), and the loft over it */
const SPEED = 18, LOFT = new Vector3(0, 2.5, 0);

type Item = { model: GrenadeModel; slot: Object3D };
/** what the hands are doing with the grenade, as the player is told it; null while they are not on it */
export type Phase = 'Taking grenade' | 'Pulling pin' | 'Throwing';

/** Prop contact and the throw are animate verbs; there are no hand or bone keyframes here. */
export class GrenadeMotion {
  phase: Phase | null = null;
  private readonly rack: Item[] = [];
  private readonly straps: Mesh[] = [];
  private readonly webbing = new MeshStandardMaterial({ color: '#474a31', roughness: 0.95 });
  /** the grenade held up for the pin, turned with the body: its ring toward the left hand */
  private readonly ready = new Object3D();
  private current: GrenadeModel | undefined;
  private armed = false;

  constructor(private readonly person: Body, carrier: Object3D, private readonly grenades: Grenades) {
    const scale = person.species.person?.scale ?? 1;
    for (let i = 0; i < grenades.count; i++) {
      const slot = new Object3D(), model = new GrenadeModel(i + 1);
      slot.name = `Grenade clip ${i + 1}`;
      slot.position.fromArray(SLOTS[i]).multiplyScalar(scale);
      carrier.add(slot);
      slot.add(model.object);
      const strap = new Mesh(new BoxGeometry(0.062, 0.075, 0.016), this.webbing);
      strap.position.z = -0.035;
      slot.add(strap);
      this.straps.push(strap);
      this.rack.push({ model, slot });
    }
    this.ready.name = 'Grenade held before the chest';
    person.object.add(this.ready);
  }

  /**
   * Bring it up while the other hand finds the ring, pull clear, cock, throw along `aim` (read as it leaves the hand, the thrower's
   * `velocity` added) and follow through; whether it was thrown. A hand that cannot take the grenade or its ring (the dev log says why)
   * puts the grenade back on its clip, or drops it, pin in, if it cannot.
   */
  *throw(aim: () => Vector3, eye: () => Vector3, velocity: () => Vector3) {
    const item = this.rack[0];
    if (!item) throw new Error('No grenade on the vest');
    const person = this.person, { object, pin } = item.model;
    this.current = item.model;
    this.phase = 'Taking grenade';
    if (yield* attempt(grab(person, object, { right: 'body' }, QUICK))) return yield* this.putBack(item, eye);
    this.grenades.count--;
    this.phase = 'Pulling pin';
    const ready = () => {
      this.ready.position.copy(person.object.worldToLocal(person.armPoint('right', READY, 0.65)));
      return this.ready;
    };
    if (yield* attempt(parallel('all', carry(person, object, ready, QUICK), grab(person, pin, { left: 'ring' }, QUICK)))) return yield* this.putBack(item, eye);
    const clear = () => pin.getWorldPosition(new Vector3()).distanceTo(object.getWorldPosition(new Vector3())) > 0.10;
    yield* attempt(carry(person, pin, () => person.armPoint('left', new Vector3(1, -0.25, 0.8), 0.8), { ...QUICK, until: clear }));
    if (!clear()) return yield* this.putBack(item, eye);
    this.armed = true;
    this.grenades.drop(pin, release(person, pin));
    this.phase = 'Throwing';
    // (the camera stays free until the grenade leaves the hand: its view then, not at the key press; animate times the release)
    yield* throwAt(person, object, undefined, {
      released: (motion) => {
        motion.velocity.copy(aim()).multiplyScalar(SPEED).add(LOFT).add(velocity());
        this.grenades.launch(item.model, motion, eye());
        this.rack.splice(this.rack.indexOf(item), 1);
        this.current = undefined;
        this.armed = false;
      },
    });
    this.phase = null;
  }

  /** If killed after pulling the pin, let the live grenade fall at the hand; its fuse still runs. */
  interrupt(eye: Vector3) {
    const model = this.current;
    if (!model) return;
    if (this.person.holds(model.pin)) this.grenades.drop(model.pin, release(this.person, model.pin));
    if (this.person.holds(model.object)) {
      const motion = release(this.person, model.object);
      this.grenades.launch(model, motion, eye, this.armed);
      this.rack.splice(this.rack.findIndex((item) => item.model === model), 1);
    }
    this.current = undefined;
    this.armed = false;
  }

  dispose() {
    for (const { model, slot } of this.rack) { model.dispose(); slot.removeFromParent(); }
    for (const strap of this.straps) strap.geometry.dispose();
    this.webbing.dispose();
    this.ready.removeFromParent();
  }

  /** the grenade back on its clip, its pin still in; dropped where it is if the hand cannot bring it there */
  private *putBack({ model: { object, pin }, slot }: Item, eye: () => Vector3) {
    const person = this.person;
    if (person.holds(pin)) {
      release(person, pin);
      object.attach(pin);
    }
    if (person.holds(object)) {
      if (yield* attempt(carry(person, object, slot, QUICK))) this.interrupt(eye());
      else {
        release(person, object, slot);
        this.grenades.count++;
      }
    }
    this.current = undefined;
    this.phase = null;
  }
}
