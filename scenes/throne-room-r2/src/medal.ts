import { BufferGeometry, CatmullRomCurve3, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Object3D, TorusGeometry, Vector3 } from 'three';
import type { Body } from '@drawcall/animate';

// The Medal of Yavin: a gold medallion on a ribbon loop, worn around the neck so the medallion rests on the chest.
// A rigid prop: the loop is shaped as it lies when worn (around the base of the neck, over the shoulders, down to the sternum), and it is
// wide enough (0.26 m across, 0.3 m front to back) to be lowered over a head (about 0.16 m wide and 0.2 m deep).
//
// The medal's frame: its origin is the medallion's centre, +Z the way its face looks (the wearer's forward once worn), +Y up, +X the
// wearer's left. In the film the medallions are gold, about 7 cm across, on a ribbon [recalled].

/** what a medal weighs (kg): a heavy gold-coloured medallion and its ribbon */
const MASS = 0.15;
const MEDALLION_RADIUS = 0.036;

/**
 * Where on the ribbon each hand holds it (medal frame). A presenter faces the wearer, so her left hand is on the wearer's right (−X):
 * she holds the loop's front a little above the collarbones, where it turns down toward the medallion, so the back of the loop can go
 * over the head first. The bearer holds it in one hand by the back of the loop, the medallion hanging toward whoever takes it.
 */
const GRIPS = {
  left: [-0.1, 0.15, -0.07],
  right: [0.1, 0.15, -0.07],
  bearer: [0, 0.17, -0.29],
} as const;

/** the ribbon's centre line as worn (medal frame): from the medallion's top, up the chest, round the back of the neck and down again */
const LOOP = [
  [0, MEDALLION_RADIUS, 0.004],
  [0.045, 0.08, -0.012],
  [0.1, 0.15, -0.07],
  [0.12, 0.175, -0.17],
  [0.08, 0.18, -0.26],
  [0, 0.18, -0.29],
  [-0.08, 0.18, -0.26],
  [-0.12, 0.175, -0.17],
  [-0.1, 0.15, -0.07],
  [-0.045, 0.08, -0.012],
] as const;

/** where the medallion rests on a wearer, from the base of the neck (the `neck` bone's origin) in the wearer's frame: down the sternum and
 * out onto the front of the chest (m) */
const ON_CHEST = new Vector3(0, -0.17, 0.16);

const gold = new MeshStandardMaterial({ color: 0xe0b13a, metalness: 1, roughness: 0.28 });
const ribbon = new MeshStandardMaterial({ color: 0x8c1d24, roughness: 0.75, side: DoubleSide });

/** a medal named `name`, with its mass and its grips (`left`, `right` for a presenter's hands, `bearer` for one hand at the back) */
export function createMedal(name: string): Group {
  const medal = new Group();
  medal.name = name;
  medal.userData.mass = MASS;
  // the medallion: a gold disc facing +Z with a raised rim and a small boss at its centre
  const disc = new Mesh(new CylinderGeometry(MEDALLION_RADIUS, MEDALLION_RADIUS, 0.005, 40), gold);
  disc.rotation.x = Math.PI / 2;
  const rim = new Mesh(new TorusGeometry(MEDALLION_RADIUS - 0.002, 0.0028, 8, 40), gold);
  const boss = new Mesh(new CylinderGeometry(0.014, 0.016, 0.008, 24), gold);
  boss.rotation.x = Math.PI / 2;
  // the ring the ribbon threads through, at the medallion's top
  const eye = new Mesh(new TorusGeometry(0.008, 0.0022, 6, 16), gold);
  eye.position.y = MEDALLION_RADIUS + 0.004;
  medal.add(disc, rim, boss, eye, new Mesh(ribbonGeometry(), ribbon));
  for (const mesh of medal.children) mesh.castShadow = true;
  for (const [grip, [x, y, z]] of Object.entries(GRIPS)) {
    const empty = new Object3D();
    empty.name = grip;
    empty.position.set(x, y, z);
    medal.add(empty);
  }
  return medal;
}

/**
 * The place a medal is worn on `wearer`: an empty on its chest bone where the medallion rests, facing the way the wearer faces, so the
 * medal moves with the chest once it is let go onto it. Made from where the wearer's neck is now: make it while the wearer stands upright.
 */
export function wornPlace(wearer: Body): Object3D {
  const bones = wearer.bones as Record<string, Object3D>;
  const chest = bones.chest;
  wearer.object.updateMatrixWorld(true);
  const place = new Object3D();
  place.name = 'medal worn';
  const neck = bones.neck.getWorldPosition(new Vector3());
  const offset = ON_CHEST.clone().applyAxisAngle(UP, wearer.facing);
  place.position.copy(neck.add(offset));
  place.rotation.y = wearer.facing;
  chest.attach(place);
  return place;
}

/**
 * The place a medal is held over `wearer`'s head before it is lowered onto the neck: the worn place raised until the back of the loop
 * (level with the base of the neck when worn) clears the crown by `margin` (m), and a little forward; an empty on the wearer's `object`,
 * so it turns with the wearer but not with its bowing head.
 */
export function overHeadPlace(wearer: Body, worn: Object3D, margin = 0.06): Object3D {
  const person = wearer.species.person;
  if (!person) throw new Error('a medal is hung on a person');
  const neck = (wearer.bones as Record<string, Object3D>).neck.getWorldPosition(new Vector3());
  const crown = wearer.position.y + person.height;
  const place = new Object3D();
  place.name = 'medal over head';
  wearer.object.updateMatrixWorld(true);
  place.position.copy(wearer.object.worldToLocal(worn.getWorldPosition(new Vector3())));
  place.position.y += crown - neck.y + margin;
  place.position.z += 0.04;
  wearer.object.add(place);
  return place;
}

const UP = new Vector3(0, 1, 0);

/** a flat ribbon 2.2 cm wide along LOOP, lying on the shoulders: its width across the loop's line and its outward direction */
function ribbonGeometry(): BufferGeometry {
  const curve = new CatmullRomCurve3(LOOP.map(([x, y, z]) => new Vector3(x, y, z)), true, 'centripetal');
  const samples = 96;
  const halfWidth = 0.011;
  const positions: number[] = [];
  const indices: number[] = [];
  const centre = new Vector3(0, 0.17, -0.15);
  for (let index = 0; index <= samples; index++) {
    const u = index / samples;
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    const outward = point.clone().sub(centre).setY(0).normalize();
    const across = new Vector3().crossVectors(tangent, outward).normalize();
    positions.push(...point.clone().addScaledVector(across, halfWidth).toArray(), ...point.clone().addScaledVector(across, -halfWidth).toArray());
    if (index < samples) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
