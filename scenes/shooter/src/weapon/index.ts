import { Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { WeaponModel } from './model';

// Physical grip, sight, and magazine frames on the procedural carbine.
export const RIFLE = {
  mass: 3, foregrip: new Vector3(0, 0.035, 0.2), sight: new Vector3(0, 0.12, 0),
  well: new Vector3(0, -0.055, 0.09), belowWell: new Vector3(0, -0.2, 0.08), muzzle: new Vector3(0, 0.06, 0.68),
  magazine: { base: new Vector3(0, -0.065, 0), mass: 0.5 },
};

export function rifleOn(mount: Object3D, arms: number) {
  const model = new WeaponModel();
  const rifle = empty(mount, 'rifle', new Vector3());
  model.rifle(rifle, arms);
  rifle.userData.mass = RIFLE.mass;
  empty(rifle, 'pistol', new Vector3(0, -0.06, -0.012));
  empty(rifle, 'foregrip', RIFLE.foregrip.clone().setZ(RIFLE.foregrip.z * arms));
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
    empty(magazine, 'base', RIFLE.magazine.base);
    return magazine;
  };
  return { rifle, well, flash, muzzle, stock, magazineIn, dispose: () => { model.dispose(); flash.material.dispose(); } };
}

export function empty(parent: Object3D, name: string, position: Vector3): Object3D {
  const object = new Object3D();
  object.name = name;
  object.position.copy(position);
  parent.add(object);
  return object;
}

