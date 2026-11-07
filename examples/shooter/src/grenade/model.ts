import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, TorusGeometry } from 'three';

/** A palm-sized training grenade, with a separate pull ring and spring lever. Metres. */
export class GrenadeModel {
  readonly object = new Group();
  readonly pin = new Group();
  readonly spoon = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly paint = new MeshStandardMaterial({ color: '#59623b', roughness: 0.64, metalness: 0.55 });
  private readonly steel = new MeshStandardMaterial({ color: '#8b9185', roughness: 0.36, metalness: 0.85 });
  private readonly band = new MeshStandardMaterial({ color: '#d4af4d', roughness: 0.65 });

  constructor(index: number) {
    this.object.name = `Grenade ${index}`;
    this.object.userData.mass = 0.4;
    const shell = this.mesh(this.object, new SphereGeometry(0.035, 20, 14), this.paint);
    shell.scale.y = 1.22;
    this.mesh(this.object, new CylinderGeometry(0.029, 0.032, 0.007, 20), this.band).position.y = 0.025;
    this.mesh(this.object, new CylinderGeometry(0.014, 0.019, 0.018, 12), this.steel).position.y = 0.046;
    this.object.add(this.spoon, this.pin);
    this.spoon.name = 'Safety lever';
    this.mesh(this.spoon, new BoxGeometry(0.018, 0.006, 0.044), this.steel).position.set(0, 0.058, 0.014);
    const lever = this.mesh(this.spoon, new BoxGeometry(0.018, 0.066, 0.005), this.steel);
    lever.position.set(0, 0.025, 0.036);
    lever.rotation.x = -0.15;
    // (where the thumb's pad presses the lever down, on its outer face near the top)
    const pad = new Object3D();
    pad.name = 'lever pad';
    pad.position.set(0, 0.028, 0.0025);
    pad.userData.facing = [0, 0, -1];
    lever.add(pad);
    this.pin.name = 'Safety pin';
    this.pin.userData.mass = 0.008;
    this.pin.position.set(0.029, 0.048, 0);
    this.mesh(this.pin, new TorusGeometry(0.013, 0.0015, 6, 20), this.steel);
    const stem = this.mesh(this.pin, new CylinderGeometry(0.0015, 0.0015, 0.038, 6), this.steel);
    stem.rotation.z = Math.PI / 2;
    stem.position.x = -0.027;
    const body = new Object3D();
    body.name = 'body';
    Object.assign(body.userData, { handle: [0, 1, 0], facing: [0, 0, -1], radius: 0.035, digits: { thumb: 'lever pad' } });
    this.object.add(body);
    const ring = new Object3D();
    ring.name = 'ring';
    ring.position.x = 0.013;
    Object.assign(ring.userData, { handle: [0, 1, 0], facing: [-1, 0, 0], radius: 0.0015 });
    this.pin.add(ring);
  }

  dispose() {
    for (const part of [this.object, this.pin, this.spoon]) part.removeFromParent();
    for (const mesh of this.meshes) mesh.geometry.dispose();
    for (const material of [this.paint, this.steel, this.band]) material.dispose();
  }

  private mesh(parent: Object3D, geometry: SphereGeometry | CylinderGeometry | BoxGeometry | TorusGeometry, material: MeshStandardMaterial) {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    parent.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }
}
