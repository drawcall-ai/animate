import { carry, grab, release, throwAt, type Body } from '@drawcall/animate';
import { parallel } from '@pmndrs/timeline';
import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { Grenades } from '.';
import { GrenadeModel } from './model';

const QUICK = { speed: 2, step: false };
const SLOTS = [[-0.10, -0.10, 0.22], [-0.21, -0.10, 0.19], [-0.25, -0.23, 0.14]] as const;

/** Prop contact and the throw are animate verbs; there are no hand or bone keyframes here. */
export class GrenadeMotion {
  phase = '';
  private readonly rack: { model: GrenadeModel; slot: Object3D }[] = [];
  private readonly straps: Mesh[] = [];
  private readonly webbing = new MeshStandardMaterial({ color: '#474a31', roughness: 0.95 });
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

  /** Bring it up while the other hand finds the ring, pull clear, cock, throw and follow through. */
  *throw(aim: () => Vector3, eye: () => Vector3, velocity: () => Vector3) {
    const item = this.rack[0];
    if (!item) throw new Error('No grenade on the vest');
    const { model } = item, { object, pin } = model;
    this.current = model;
    this.phase = 'Taking grenade';
    if (!(yield* grab(this.person, object, { right: 'body' }, QUICK))) throw new Error('Could not take grenade from vest');
    this.grenades.count--;
    this.ready.position.copy(this.person.object.worldToLocal(this.person.armPoint('right', new Vector3(0.3, 0.35, 1), 0.8)));
    this.phase = 'Pulling pin';
    if (!(yield* parallel('all', carry(this.person, object, this.ready, QUICK), grab(this.person, pin, { left: 'ring' }, QUICK))))
      throw new Error('Could not bring grenade and pin into both hands');
    const clear = () => pin.getWorldPosition(new Vector3()).distanceTo(object.getWorldPosition(new Vector3())) > 0.10;
    yield* carry(this.person, pin, () => this.person.armPoint('left', new Vector3(1, -0.25, 0.8), 0.8), { ...QUICK, until: clear });
    if (!clear()) throw new Error('Grenade pin did not clear the fuze');
    this.armed = true;
    this.grenades.drop(pin, release(this.person, pin));
    this.phase = 'Throwing';
    yield* throwAt(this.person, object, undefined, {
      released: (motion) => {
        // The camera remains free throughout preparation. Sample its latest direction at release, with a modest loft,
        // and inherit the player's motion. animate owns the release instant, position, spin and follow-through.
        motion.velocity.copy(aim()).multiplyScalar(18).add(new Vector3(0, 2.5, 0)).add(velocity());
        this.grenades.launch(model, motion, eye());
        this.rack.splice(this.rack.indexOf(item), 1);
        this.current = undefined;
        this.armed = false;
      },
    });
    this.phase = 'Returning to rifle';
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
}
