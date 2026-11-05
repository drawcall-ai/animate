import { Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { WeaponModel } from './model';

// Physical grip, sight, and magazine frames on the procedural carbine.
export const RIFLE = {
  mass: 3, foregrip: new Vector3(0, 0.058, 0.16), sight: new Vector3(0, 0.12, 0),
  well: new Vector3(0, -0.055, 0.09), belowWell: new Vector3(0, -0.2, 0.08), muzzle: new Vector3(0, 0.06, 0.68),
  magazine: { base: new Vector3(0, -0.05, -0.005), mass: 0.5 },
  /** where the trigger finger's pad rests: on the trigger's face low in the guard, so its end joints bend into the guard, and off it laid
   * straight along the receiver's side above the guard */
  trigger: new Vector3(0, -0.024, 0.042), frame: new Vector3(-0.028, 0.008, 0.058),
  /** where the gripping hand's middle, ring and little finger pads go, empties of their names: round the grip's front onto its left side,
   * the middle finger just under the guard */
  pads: { middle: new Vector3(0.0175, -0.053, 0.002), ring: new Vector3(0.0175, -0.073, -0.006), little: new Vector3(0.017, -0.092, -0.012) },
  /** the gripping hand's thumb, curled over against the receiver's right side above the grip, out of the palm (its base sits on the grip's
   * back-right corner: the thumb's swing across the palm takes it forward into the grip, not round the back strap to the grip's left) */
  thumb: { curl: 0.8, oppose: -0.5 },
};

export function rifleOn(mount: Object3D, arms: number) {
  const model = new WeaponModel();
  const rifle = empty(mount, 'rifle', new Vector3());
  model.rifle(rifle, arms);
  rifle.userData.mass = RIFLE.mass;
  // (the grips as handles: the pistol grip slanting back down from the receiver, held in the right hand from its right, the thumb on top;
  // the receiver's front in the left, its thumb toward the muzzle, turned as the arm brings it: a palm-up turn the wrist cannot always
  // make, as after a reload looking far up or down)
  // (the pistol grip's axis leant 10° further forward than its own 11°, so the fingers wrap it a little downward as a hand's do — further,
  // the arm cannot keep the turn on a reload looking far down; the empty a little behind and below its middle, so the palm covers its right
  // side back to the back strap, the knuckles at its front half and the trigger finger level with the trigger, the fingers wrapping its
  // front to its left side; the radius a millimetre over its half width, so the palm lies on its flat right side)
  const pistol = empty(rifle, 'pistol', new Vector3(0, -0.066, -0.018));
  Object.assign(pistol.userData, { handle: [0, 0.9, 0.42], palm: [1, 0, 0], radius: 0.0165 });
  const foregrip = empty(rifle, 'foregrip', RIFLE.foregrip.clone().setZ(RIFLE.foregrip.z * arms));
  foregrip.userData.handle = [0, 0, 1];
  // (the trigger drawn back as a part, the trigger finger's pad on its face going with it)
  const blade = empty(rifle, 'blade', new Vector3());
  model.trigger(blade);
  empty(blade, 'trigger', RIFLE.trigger);
  empty(rifle, 'frame', RIFLE.frame);
  for (const [digit, at] of Object.entries(RIFLE.pads)) empty(rifle, digit, at);
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

