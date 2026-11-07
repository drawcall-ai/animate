import { Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { stockBack, WeaponModel } from './model';

// Physical grip, sight, and magazine frames on the procedural carbine.
export const RIFLE = {
  mass: 3, foregrip: new Vector3(-0.0217, 0.0574, 0.2019), sight: new Vector3(0, 0.12, 0),
  well: new Vector3(0, -0.055, 0.09), muzzle: new Vector3(0, 0.06, 0.68),
  /** how far below its seat a magazine comes in to the well along the well's line (m): its lips 2 cm under the receiver */
  wellLine: 0.095,
  /** a magazine's grip, `base`: on the line through its front edge's rounding, half its thickness in from the edge, 8.6 cm under its
   * well's mouth (the hand's lower edge under its floor plate), so the thumb and index pinch its body below the well, the index's tip
   * 1 cm under the well's flared mouth; 4.5 cm under, the thumb's tip was at the well's edge and the index's on the receiver's face over
   * it, and 7 cm under, the index's tip touched the flare */
  magazine: { base: new Vector3(0, -0.086, 0.005), mass: 0.5 },
  /** where the trigger finger's pad rests: on the blade's face, a little right of its middle (the finger coming in from the right), and
   * off it laid straight along the receiver's side above the guard */
  trigger: new Vector3(-0.004, -0.018, 0.043), frame: new Vector3(-0.028, 0.008, 0.058),
};

/** a rifle built onto its mount, and its parts the hands and the story use */
export type Rifle = ReturnType<typeof rifleOn>;

export function rifleOn(mount: Object3D, arms: number) {
  const model = new WeaponModel();
  const rifle = empty(mount, 'rifle', new Vector3());
  model.rifle(rifle, arms);
  rifle.userData.mass = RIFLE.mass;
  // (the grips as handles, each fixed — its axis, its palm's facing and how far the palm is off the axis — so the hand goes on it the
  // same however it comes: the pistol grip slanting back down from the receiver, held in the right hand from its right, the thumb on top;
  // the receiver's front in the left, ahead of the magazine well with room for four fingers before it (2 cm nearer, the little finger lay
  // in the well), round the receiver's 6 × 7 cm body: palm up and turned in under it, the fingers round its right side, the thumb
  // opposing them up its left, the grasp slanting forward-right across it as the forearm comes from the left shoulder; the empty right of
  // the middle and below it, so the fingertips come up the right side rather than stopping on its lower edge: where the last library seated
  // the hand from its fingers' contacts, its wrist steadiest through fast turns (a centimetre nearer, the hand rolled further off it on an
  // 8 rad/s reversal); the reload brings the rifle in for it as it returns (`RETURNING`, avatar.ts))
  // (the pistol grip held high and forward on it, the knuckles at its front edge so the fingers wrap its front to the left side and the
  // index reaches the trigger, the web round the back strap so the thumb closes round it onto the left; its axis leant 10° past the
  // grip's own, so the fingers wrap a little downward; the palm on its flat right side, turned a little down and back onto it)
  const pistol = empty(rifle, 'pistol', new Vector3(-0.0002, -0.0663, -0.0063));
  Object.assign(pistol.userData, { handle: [0.005, 0.907, 0.422], facing: [0.964, -0.117, 0.241], radius: 0.0174 });
  const foregrip = empty(rifle, 'foregrip', RIFLE.foregrip);
  Object.assign(foregrip.userData, { handle: [0.314, 0.002, 0.949], facing: [-0.338, 0.935, 0.11], radius: 0.0331 });
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
  // (a magazine comes in to the well along its line, from below it turned as the well is, its lips just under the receiver, and a carry
  // out of the well leaves from there: off the line, 3 cm behind it, a magazine came in slanting against the well and its top corner
  // stood out through the well's wall)
  const below = empty(rifle, 'below the well', RIFLE.well.clone().add(new Vector3(0, -RIFLE.wellLine, 0).applyEuler(well.rotation)));
  below.rotation.copy(well.rotation);
  well.userData.approach = [below.name];
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
