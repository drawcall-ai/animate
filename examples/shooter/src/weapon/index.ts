import { Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { stockBack, WeaponModel } from './model';

// Physical grip, sight, and magazine frames on the procedural carbine.
export const RIFLE = {
  mass: 3, foregrip: new Vector3(-0.024, 0.06, 0.185), sight: new Vector3(0, 0.12, 0),
  well: new Vector3(0, -0.055, 0.09), belowWell: new Vector3(0, -0.145, 0.077), partWay: new Vector3(0, -0.082, 0.086), muzzle: new Vector3(0, 0.06, 0.68),
  /** a magazine's grips: `base` round its body, `thumb` where its thumb's pad goes on the body's left face, `floor` the middle of its floor
   * plate, the palm up under it */
  magazine: { base: new Vector3(0, -0.045, -0.01), floor: new Vector3(0, -0.076, -0.015),
    thumb: new Vector3(0.016, -0.012, -0.014), mass: 0.5 },
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
  // right side, the thumb up its left, the grasp slanting forward-right across it as the forearm comes from the left shoulder; the empty
  // 2.4 cm right of the middle and below it, so the fingertips come up the right side rather than stopping on its lower edge)
  // (the pistol grip held high and forward on it, the knuckles at its front edge so the fingers wrap its front to the left side and the
  // index reaches the trigger, the web round the back strap so the thumb closes round it onto the left; its axis leant 10° past the
  // grip's own, so the fingers wrap a little downward; the radius a millimetre over its half width, the palm on its flat right side)
  const pistol = empty(rifle, 'pistol', new Vector3(0, -0.068, -0.008));
  Object.assign(pistol.userData, { handle: [0, 0.9, 0.42], facing: [1, 0, 0.3], radius: 0.0165 });
  const foregrip = empty(rifle, 'foregrip', RIFLE.foregrip);
  Object.assign(foregrip.userData, { handle: [0.3, 0, 0.95], facing: [-0.5, 1, 0], radius: 0.035 });
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
  // (a magazine comes in to the well from below it, its lips just under the well's mouth and turned as the well is, up the well's line
  // part way in, where the well holds it as the hand shifts under its floor plate to push it home)
  const below = empty(rifle, 'below the well', RIFLE.belowWell);
  const partWay = empty(rifle, 'part way in', RIFLE.partWay);
  below.rotation.x = partWay.rotation.x = well.rotation.x;
  const magazineIn = (place: Object3D, name: string) => {
    const magazine = empty(place, name, new Vector3());
    model.magazine(magazine);
    magazine.userData.mass = RIFLE.magazine.mass;
    // (taken round its body below the well, the handle along its length and the thumb toward its lips, the hand turned about it as the
    // arm brings it: in the well its palm on the left face, the fingers round the front, as it took it from its chest pouch. The palm on
    // a face, half the body's 2.8 cm off its middle: measured, 2.1 cm, the palm stood off the face and the fingers lay straight along it.
    // The handle at the body's middle, the knuckles 2.5 cm behind its front edge, so the fingers fold round that edge rather than reaching
    // past it. A palm asked on its face, even only preferred, stalled the reach into the pouch nearest the chest's middle, the wrist
    // wavering at the end of its turn)
    // (the thumb's pad on the left face toward the lips, so the thumb lies along that face as the fingers close round the front onto the
    // right one: left to itself it stood out off the body along the handle)
    const base = empty(magazine, 'base', RIFLE.magazine.base);
    Object.assign(base.userData, { handle: [0, 1, 0.15], radius: 0.014, fingers: { thumb: 'thumb pad' } });
    empty(magazine, 'thumb pad', RIFLE.magazine.thumb);
    // (the palm up under the floor plate to push the magazine home, the plate as an edge along the palm's grasp line, the thumb toward
    // its front and the fingers coming up round its right side)
    Object.assign(empty(magazine, 'floor', RIFLE.magazine.floor).userData, { handle: [0, 0, 1], facing: [-0.5, 1, 0], radius: 0.0045 });
    return magazine;
  };
  return { rifle, pistol, blade, well, below, partWay, flash, muzzle, stock, magazineIn, dispose: () => { model.dispose(); flash.material.dispose(); } };
}

export function empty(parent: Object3D, name: string, position: Vector3): Object3D {
  const object = new Object3D();
  object.name = name;
  object.position.copy(position);
  parent.add(object);
  return object;
}

