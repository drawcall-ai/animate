import { Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { WeaponModel } from './model';

// Physical grip, sight, and magazine frames on the procedural carbine.
export const RIFLE = {
  mass: 3, foregrip: new Vector3(0, 0.058, 0.16), sight: new Vector3(0, 0.12, 0),
  well: new Vector3(0, -0.055, 0.09), belowWell: new Vector3(0, -0.2, 0.08), muzzle: new Vector3(0, 0.06, 0.68),
  magazine: { base: new Vector3(0, -0.05, -0.005), mass: 0.5 },
  /** where the trigger finger's pad rests: on the trigger's face, and off it straight out beside the guard, past its front (as far up as
   * the finger lifts and fans: the guard is deeper than the hand's index sits above its middle finger) */
  trigger: new Vector3(0, -0.031, 0.049), frame: new Vector3(-0.028, -0.027, 0.092),
};

export function rifleOn(mount: Object3D, arms: number) {
  const model = new WeaponModel();
  const rifle = empty(mount, 'rifle', new Vector3());
  model.rifle(rifle, arms);
  rifle.userData.mass = RIFLE.mass;
  // (the grips as handles: the pistol grip slanting back down from the receiver, held in the right hand from its right, the thumb on top;
  // the receiver's front in the left, its thumb toward the muzzle, turned as the arm brings it: a palm-up turn the wrist cannot always
  // make, as after a reload looking far up or down)
  // (the pistol grip's axis leant 20° further forward than its own 10°: a hand's grasp line lies some 25° off square to its fingers, which
  // would climb the grip into the guard, and leant so they wrap it nearly level; more turns the wrist past what the arm brings aiming far
  // down. The empty forward of the grip's middle, so the knuckles stand at its front and the fingers wrap its front to its left side, the
  // middle finger just under the guard; the radius its half width, so the palm lies on its flat right side, not a measured round off it)
  const pistol = empty(rifle, 'pistol', new Vector3(0, -0.072, 0.0075));
  Object.assign(pistol.userData, { handle: [0, 0.87, 0.5], palm: [1, 0, 0.15], radius: 0.02 });
  const foregrip = empty(rifle, 'foregrip', RIFLE.foregrip.clone().setZ(RIFLE.foregrip.z * arms));
  foregrip.userData.handle = [0, 0, 1];
  // (the trigger drawn back as a part, the trigger finger's pad on its face going with it)
  const blade = empty(rifle, 'blade', new Vector3());
  model.trigger(blade);
  empty(blade, 'trigger', RIFLE.trigger);
  empty(rifle, 'frame', RIFLE.frame);
  empty(rifle, 'sight', RIFLE.sight);
  const stock = empty(rifle, 'stock', new Vector3(0, 0.013, -0.24 * arms - 0.0555));
  const flash = new Mesh(new SphereGeometry(0.045, 16, 12), new MeshBasicMaterial({ color: 0xffe6a3, transparent: true, opacity: 0.9, depthWrite: false }));
  flash.name = 'flash';
  flash.position.copy(RIFLE.muzzle);
  flash.visible = false;
  rifle.add(flash);
  const muzzle = empty(rifle, 'muzzle', RIFLE.muzzle);
  const well = empty(rifle, 'well', RIFLE.well);
  well.rotation.x = -0.15;
  empty(rifle, 'below the well', RIFLE.belowWell);
  well.userData.approach = ['below the well'];
  const magazineIn = (place: Object3D, name: string) => {
    const magazine = empty(place, name, new Vector3());
    model.magazine(magazine);
    magazine.userData.mass = RIFLE.magazine.mass;
    // (taken round its body by the base, the thumb forward, the hand turned as the arm brings it from a pouch or the well)
    empty(magazine, 'base', RIFLE.magazine.base).userData.handle = [0, 0, 1];
    return magazine;
  };
  return { rifle, pistol, blade, well, flash, muzzle, stock, magazineIn, dispose: () => { model.dispose(); flash.material.dispose(); } };
}

export function empty(parent: Object3D, name: string, position: Vector3): Object3D {
  const object = new Object3D();
  object.name = name;
  object.position.copy(position);
  parent.add(object);
  return object;
}

