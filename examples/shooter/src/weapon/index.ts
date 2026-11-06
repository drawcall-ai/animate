import { Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { stockBack, WeaponModel } from './model';

// Physical grip, sight, and magazine frames on the procedural carbine.
export const RIFLE = {
  mass: 3, foregrip: new Vector3(-0.02, 0.06, 0.185), sight: new Vector3(0, 0.12, 0),
  well: new Vector3(0, -0.055, 0.09), belowWell: new Vector3(0, -0.145, 0.077), muzzle: new Vector3(0, 0.06, 0.68),
  /** a magazine's grip, `base`: on the line through its front edge's rounding, half its thickness in from the edge, 7 cm under its
   * well's mouth (of the 8 cm it shows below it), so the thumb and index pinch its body below the well; 4.5 cm under, the thumb's tip was
   * at the well's edge and the index's on the receiver's face over it */
  magazine: { base: new Vector3(0, -0.07, 0.009), mass: 0.5 },
  /** where the trigger finger's pad rests: on the blade's face, a little right of its middle (the finger coming in from the right), and
   * off it laid straight along the receiver's side above the guard */
  trigger: new Vector3(-0.004, -0.018, 0.043), frame: new Vector3(-0.028, 0.008, 0.058),
};

export function rifleOn(mount: Object3D, arms: number) {
  const model = new WeaponModel();
  const rifle = empty(mount, 'rifle', new Vector3());
  model.rifle(rifle, arms);
  rifle.userData.mass = RIFLE.mass;
  // (the grips as handles: the pistol grip slanting back down from the receiver, held in the right hand from its right, the thumb on top;
  // the receiver's front in the left, ahead of the magazine well with room for four fingers before it (2 cm nearer, the little finger lay
  // in the well), round the receiver's 6 × 7 cm body: palm up and turned in under it, as far as the wrist turns so, the fingers round its
  // right side, the thumb opposing them up its left, the grasp slanting forward-right across it as the forearm comes from the left
  // shoulder; the empty 2 cm right of the middle and below it, so the fingertips come up the right side rather than stopping on its lower
  // edge — tuned between two failures: turned in less (its palm half as far off up), a fresh body stepping off the course's ladder turned
  // its hand onto it for over 3 s and never took its rifle; further, the hand back from a lift's button turned onto it for over 6 s)
  // (the pistol grip held high and forward on it, the knuckles at its front edge so the fingers wrap its front to the left side and the
  // index reaches the trigger, the web round the back strap so the thumb closes round it onto the left; its axis leant 10° past the
  // grip's own, so the fingers wrap a little downward; the radius a millimetre over its half width, the palm on its flat right side)
  const pistol = empty(rifle, 'pistol', new Vector3(0, -0.068, -0.008));
  Object.assign(pistol.userData, { handle: [0, 0.9, 0.42], facing: [1, 0, 0.3], radius: 0.0165 });
  const foregrip = empty(rifle, 'foregrip', RIFLE.foregrip);
  Object.assign(foregrip.userData, { handle: [0.3, 0, 0.95], facing: [-0.4, 1, 0], radius: 0.035 });
  // (the trigger drawn back as a part, the trigger finger's pad on its face going with it)
  const blade = empty(rifle, 'blade', new Vector3());
  model.trigger(blade);
  empty(blade, 'trigger', RIFLE.trigger);
  empty(rifle, 'frame', RIFLE.frame);
  empty(rifle, 'sight', RIFLE.sight);
  const stock = empty(rifle, 'stock', new Vector3(0, 0.013, stockBack(arms) - 0.0555));
  const flash = new Mesh(new SphereGeometry(0.045, 16, 12), new MeshBasicMaterial({ color: 0xffe6a3, transparent: true, opacity: 0.9, depthWrite: false }));
  flash.name = 'flash';
  flash.position.copy(RIFLE.muzzle);
  flash.visible = false;
  rifle.add(flash);
  const muzzle = empty(rifle, 'muzzle', RIFLE.muzzle);
  const well = empty(rifle, 'well', RIFLE.well);
  well.rotation.x = -0.15;
  // (a magazine comes in to the well from below it, its lips just under the well's mouth and turned as the well is, then up the well's line)
  const below = empty(rifle, 'below the well', RIFLE.belowWell);
  below.rotation.x = well.rotation.x;
  const magazineIn = (place: Object3D, name: string) => {
    const magazine = empty(place, name, new Vector3());
    model.magazine(magazine);
    magazine.userData.mass = RIFLE.magazine.mass;
    // (taken by its front edge, thumb up toward its lips, the palm on the edge facing back: the fingers round onto its right face, the
    // thumb opposing them on its left)
    Object.assign(empty(magazine, 'base', RIFLE.magazine.base).userData, { handle: [0, 1, 0.18], facing: [0, 0, -1], radius: 0.014 });
    return magazine;
  };
  return { rifle, pistol, blade, well, below, flash, muzzle, stock, magazineIn, dispose: () => { model.dispose(); flash.material.dispose(); } };
}

export function empty(parent: Object3D, name: string, position: Vector3): Object3D {
  const object = new Object3D();
  object.name = name;
  object.position.copy(position);
  parent.add(object);
  return object;
}

