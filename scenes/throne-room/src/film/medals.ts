import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import type { Body } from '@drawcall/animate';

// The medals and the bearer's cushion as the film shows them. They are drawn things, not props the library moves: the library stands
// every body on y = 0 and the film raises the dais party and the heroes onto their floors after each update, and a held prop does not
// survive that (the ceremony beat's grab, under the raised floor, takes its medal a dais' height from the hand; see the film log). So
// each thing here follows a place on a body as it is drawn this frame (the bearer's hands, Leia's hands, a hero's chest), and when the
// film moves it to another place it glides there over a moment, so it never jumps.

/** how long a thing takes to glide to a new place (s) */
const GLIDE = 0.35;

/** where a thing sits now, as drawn (into `position` and `turn`) */
export type Place = (position: Vector3, turn: Quaternion) => void;

export interface Follower {
  object: Object3D;
  /** from now on it sits at `place`, gliding there from where it is */
  follow(place: Place): void;
}

export interface Followers {
  group: Group;
  /** a medal: a gold disc on a short red ribbon, its face toward its +Z */
  medal(name: string): Follower;
  /** the bearer's cushion the medals lie on */
  cushion(): Follower;
  /** moves everything to its place; call after every body has updated and stood on its floor (s) */
  update(seconds: number): void;
}

export function followers(): Followers {
  const group = new Group();
  group.name = 'medals';
  const all: { object: Object3D; place?: Place; from: Vector3; fromTurn: Quaternion; t: number; started: boolean }[] = [];
  const add = (object: Object3D): Follower => {
    const entry = { object, place: undefined as Place | undefined, from: new Vector3(), fromTurn: new Quaternion(), t: 1, started: false };
    all.push(entry);
    group.add(object);
    return {
      object,
      follow(place) {
        entry.place = place;
        entry.from.copy(object.position);
        entry.fromTurn.copy(object.quaternion);
        entry.t = entry.started ? 0 : 1;
      },
    };
  };
  // (half metallic: the hall has no environment map, so a fully metallic medal would show black)
  const gold = new MeshStandardMaterial({ color: 0xe8b445, metalness: 0.55, roughness: 0.3, emissive: 0x3a2808 });
  const red = new MeshStandardMaterial({ color: 0xb8322a, roughness: 0.8 });
  const position = new Vector3(), turn = new Quaternion();
  return {
    group,
    medal(name) {
      const medal = new Group();
      medal.name = name;
      const disc = new Mesh(new CylinderGeometry(0.04, 0.04, 0.008, 24), gold);
      disc.rotation.x = Math.PI / 2;
      const ribbon = new Mesh(new BoxGeometry(0.03, 0.11, 0.004), red);
      ribbon.position.y = 0.075;
      disc.castShadow = ribbon.castShadow = true;
      medal.add(disc, ribbon);
      return add(medal);
    },
    cushion() {
      const cushion = new Mesh(new BoxGeometry(0.36, 0.035, 0.2), new MeshStandardMaterial({ color: 0x3b2c55, roughness: 1 }));
      cushion.name = 'medal cushion';
      cushion.castShadow = true;
      return add(cushion);
    },
    update(seconds) {
      for (const entry of all) {
        if (!entry.place) continue;
        entry.place(position, turn);
        entry.t = Math.min(1, entry.t + seconds / GLIDE);
        const u = entry.t * entry.t * (3 - 2 * entry.t);
        entry.object.position.lerpVectors(entry.from, position, u);
        entry.object.quaternion.slerpQuaternions(entry.fromTurn, turn, u);
        entry.started = true;
      }
    },
  };
}

const UP = new Vector3(0, 1, 0);

/** between `body`'s drawn wrists, `forward` m before them and `down` below (turned as the body faces) */
export function inHands(body: Body, { forward = 0.06, down = 0.04, flat = false } = {}): Place {
  const left = body.bones.leftHand as Object3D, right = body.bones.rightHand as Object3D, other = new Vector3();
  return (position, turn) => {
    left.getWorldPosition(position).add(right.getWorldPosition(other)).multiplyScalar(0.5);
    position.add(other.set(Math.sin(body.facing) * forward, -down, Math.cos(body.facing) * forward));
    turn.setFromAxisAngle(UP, body.facing);
    if (!flat) turn.multiply(FACE_OUT); // a medal held up shows its face to the one it is for, who faces the holder
  };
}

/** a place on another follower (a medal on the cushion): `x` m to its left, `up` m above it, lying flat */
export function on(follower: Follower, x: number, up: number): Place {
  const offset = new Vector3();
  return (position, turn) => {
    turn.copy(follower.object.quaternion).multiply(LIE_FLAT);
    position.copy(offset.set(x, up, 0).applyQuaternion(follower.object.quaternion)).add(follower.object.position);
  };
}

/** worn on `body`'s chest: `forward` m before its chest bone, `down` below, facing the way it faces */
export function onChest(body: Body, { forward = 0.15, down = 0.02 } = {}): Place {
  const chest = body.bones.chest as Object3D;
  return (position, turn) => {
    chest.getWorldPosition(position).add(new Vector3(Math.sin(body.facing) * forward, -down, Math.cos(body.facing) * forward));
    turn.setFromAxisAngle(UP, body.facing);
  };
}

const FACE_OUT = new Quaternion().setFromAxisAngle(UP, Math.PI);
const LIE_FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
