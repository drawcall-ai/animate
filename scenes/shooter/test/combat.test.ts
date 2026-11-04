import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Scene, Skeleton, SkinnedMesh, SphereGeometry, Uint16BufferAttribute, Vector3, type BufferGeometry } from 'three';
import { RigidBody } from '@drawcall/physics';
import { buildWorld } from '@drawcall/physics-rapier';
import { Combat, MAGAZINE } from '../src/combat';
import { cleanup } from './course';

function body(scene: Scene, at: [number, number, number], size: [number, number, number], name: string, target = false, dynamic = false) {
  const result = new RigidBody({ bodyType: dynamic ? 'dynamic' : 'static', mass: 2 });
  result.position.set(...at);
  result.name = name;
  result.userData.target = target;
  result.add(new Mesh(new BoxGeometry(...size)));
  scene.add(result);
  return result;
}

/** A world without gravity over the bodies `build` adds; `built` is what it returns. */
async function setup<T>(build?: (scene: Scene) => T) {
  const scene = new Scene();
  const built = build?.(scene);
  const world = await buildWorld({ scene, gravity: [0, 0, 0] });
  const combat = new Combat(world, scene);
  cleanup(() => world.dispose());
  cleanup(() => combat.dispose());
  return { scene, world, combat, built };
}

const eye = new Vector3(0, 1.6, 0);
const muzzle = new Vector3(0.2, 1.4, 0.8);
const direction = new Vector3(0, 1.5, 10).sub(muzzle).normalize();

describe('shooter combat', () => {
  it('hits the target along the supplied barrel direction', async () => {
    const { combat } = await setup((scene) => body(scene, [0, 1.5, 10], [1, 2, 0.2], 'Target', true));
    combat.fire(eye, muzzle, direction);
    expect(combat.ammo).toBe(MAGAZINE - 1);
    expect(combat.hits).toBe(1);
    expect(combat.hit).toBe(true);
    combat.update(0.3);
    expect(combat.hit).toBe(false);
  });

  it('hits where the barrel points even when that is away from the camera aim line', async () => {
    const { combat } = await setup((scene) => {
      body(scene, [0.2, 1.4, 10], [0.3, 0.3, 0.2], 'Straight', true);
      body(scene, [2.2, 1.4, 10], [0.3, 0.3, 0.2], 'Recoil', true);
    });
    const turned = new Vector3(2.2, 1.4, 10).sub(muzzle).normalize();
    combat.fire(eye, muzzle, turned);
    expect(combat.feedback).toBe('Recoil · 1 hits');
  });

  it('hits nearby cover before a target visible to an offset shoulder camera', async () => {
    const { combat } = await setup((scene) => {
      body(scene, [0.25, 1.5, 2], [0.6, 3, 0.4], 'Corner');
      body(scene, [0, 1.5, 10], [1, 2, 0.2], 'Target', true);
    });
    combat.fire(eye, muzzle, direction);
    expect(combat.hits).toBe(0);
    expect(combat.feedback).toBe('Corner');
  });

  it('does not show an impact effect for a missed shot', async () => {
    const { combat, scene } = await setup();
    combat.fire(eye, muzzle, direction);
    combat.update(1 / 120);
    expect(combat.feedback).toBe('Miss');
    expect(scene.children.some((object) => object instanceof Mesh && object.visible)).toBe(false);
  });

  it('empties and refills the magazine, and resets completely', async () => {
    const { combat } = await setup((scene) => body(scene, [0, 1.5, 10], [1, 2, 0.2], 'Target', true));
    for (let shot = 0; shot < MAGAZINE; shot++) combat.fire(eye, muzzle, direction);
    expect(combat.ammo).toBe(0);
    expect(() => combat.fire(eye, muzzle, direction)).toThrow();
    combat.refill();
    expect(combat.ammo).toBe(MAGAZINE);
    combat.fire(eye, muzzle, direction);
    combat.reset();
    expect(combat.ammo).toBe(MAGAZINE);
    expect(combat.hits).toBe(0);
    expect(combat.hit).toBe(false);
  });

  it('applies shot impulse to dynamic props', async () => {
    const { world, combat, built: prop } = await setup((scene) => body(scene, [0, 1.5, 5], [1, 2, 1], 'Crate', false, true));
    combat.fire(eye, muzzle, direction);
    world.update(1 / 60);
    expect(prop?.getVelocity().linear.z).toBeGreaterThan(0);
  });
});

function combatant(scene: Scene, name: string, at: Vector3, geometry: BufferGeometry = new BoxGeometry(1, 2, 0.4)) {
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.position.copy(at);
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  cleanup(() => geometry.dispose());
  cleanup(() => mesh.material.dispose());
  const impacts: { damage: number; point: Vector3; direction: Vector3 }[] = [];
  return {
    name, meshes: [mesh], health: 100, impacts,
    get alive() { return this.health > 0; },
    hurt(damage: number, point: Vector3, direction: Vector3) {
      this.health = Math.max(0, this.health - damage);
      impacts.push({ damage, point: point.clone(), direction: direction.clone() });
    },
  };
}

describe('combatant hits', () => {
  const forward = new Vector3(0, 0, 1);

  it('hits the current skinned pose after a bone moves outside its previous bounds', async () => {
    const { scene, combat } = await setup();
    const geometry = new BoxGeometry(0.5, 1.5, 0.2);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count * 4 }, (_, index) => index % 4 === 0 ? 1 : 0), 4));
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()), bone = new Bone();
    mesh.add(bone);
    mesh.position.set(0.2, 1.4, 5);
    mesh.bind(new Skeleton([bone]));
    scene.add(mesh);
    mesh.computeBoundingSphere();
    bone.position.x = 2;
    mesh.updateMatrixWorld(true);
    cleanup(() => geometry.dispose());
    cleanup(() => mesh.material.dispose());
    cleanup(() => mesh.skeleton.dispose());
    const target = {
      name: 'Moving opponent', alive: true, meshes: [mesh], health: 100,
      hurt(damage: number) { this.health -= damage; },
    };
    combat.targets = [target];
    combat.fire(eye, muzzle, new Vector3(2.2, 1.4, 5).sub(muzzle).normalize());
    expect(target.health).toBe(75);
    combat.update(0.3);
    combat.fire(eye, muzzle, forward);
    expect(target.health).toBe(75);
    expect(combat.feedback).toBe('Miss');
  });

  it('hits the actual mesh surface and misses empty space inside its bounds', async () => {
    const { scene, combat } = await setup();
    const center = new Vector3(0.2, 1.4, 5);
    const target = combatant(scene, 'Opponent', center, new SphereGeometry(0.5, 24, 16));
    combat.targets = [target];
    combat.fire(eye, muzzle, forward);
    expect(target.health).toBe(75);
    expect(target.impacts).toHaveLength(1);
    expect(target.impacts[0].damage).toBe(25);
    expect(target.impacts[0].point.distanceTo(center)).toBeCloseTo(0.5, 3);
    expect(target.impacts[0].direction.distanceTo(forward)).toBeLessThan(1e-6);
    combat.update(0.3);
    const corner = center.clone().add(new Vector3(0.45, 0.45, 0));
    combat.fire(eye, muzzle, corner.sub(muzzle).normalize());
    expect(target.health).toBe(75);
    expect(target.impacts).toHaveLength(1);
    expect(combat.feedback).toBe('Miss');
  });

  it('damages the nearest live mesh regardless of target list order', async () => {
    const { scene, combat } = await setup();
    const near = combatant(scene, 'Near', new Vector3(0.2, 1.4, 4));
    const far = combatant(scene, 'Far', new Vector3(0.2, 1.4, 8));
    combat.targets = [far, near];
    combat.fire(eye, muzzle, forward);
    expect(near.health).toBe(75);
    expect(far.health).toBe(100);
    expect(combat.feedback).toBe('Near hit');
    expect(combat.hits).toBe(1);
  });

  it('allows a mesh before scenery to be hit but protects meshes behind it', async () => {
    const { scene, combat } = await setup(scene => body(scene, [0, 1.5, 5], [2, 3, 0.2], 'Cover'));
    const near = combatant(scene, 'Near', new Vector3(0.2, 1.4, 3));
    const far = combatant(scene, 'Far', new Vector3(0.2, 1.4, 8));
    combat.targets = [near, far];
    near.health = 25;
    combat.fire(eye, muzzle, forward);
    expect(near.alive).toBe(false);
    expect(combat.feedback).toBe('Near defeated');
    combat.update(0.3);
    combat.fire(eye, muzzle, forward);
    expect(far.health).toBe(100);
    expect(combat.feedback).toBe('Cover');
  });

  it('cannot damage a mesh through cover between the eye and protruding muzzle', async () => {
    const { scene, combat } = await setup(scene => body(scene, [0, 1.5, 0.4], [2, 3, 0.2], 'Cover'));
    const target = combatant(scene, 'Opponent', new Vector3(0.2, 1.4, 5));
    combat.targets = [target];
    combat.fire(eye, muzzle, forward);
    expect(target.health).toBe(100);
    expect(target.impacts).toHaveLength(0);
    expect(combat.hits).toBe(0);
    expect(combat.feedback).toBe('Cover');
  });

  it('ignores dead meshes when finding the first living opponent', async () => {
    const { scene, combat } = await setup();
    const dead = combatant(scene, 'Dead', new Vector3(0.2, 1.4, 3));
    const alive = combatant(scene, 'Alive', new Vector3(0.2, 1.4, 6));
    dead.health = 0;
    combat.targets = [dead, alive];
    combat.fire(eye, muzzle, forward);
    expect(dead.impacts).toHaveLength(0);
    expect(alive.health).toBe(75);
    expect(combat.feedback).toBe('Alive hit');
  });
});
