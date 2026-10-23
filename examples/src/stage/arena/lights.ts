import { forwardOf } from '@drawcall/animate';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  SpotLight,
  Vector3,
} from 'three';
import type { Keep } from '.';
import { CORNERS, FACINGS, FLOOR, HALF, SIDES, onSide } from './layout';
import { screenTexture } from './textures';

const TRUSS_Y = 5.2;
const TRUSS = HALF + 0.9; // the truss' offset from the centre along x and z

/** the lighting truss with its lamps and light shafts, and the lights of the scene */
export function addLights(group: Group, keep: Keep) {
  const trussMat = keep(new MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.8, roughness: 0.35 }));
  SIDES.forEach((side, k) => {
    const beam = new Mesh(keep(new BoxGeometry(2 * TRUSS + 0.3, 0.3, 0.3)), trussMat);
    beam.position.copy(onSide(side, TRUSS, 0, TRUSS_Y));
    beam.rotation.y = side.yaw;
    group.add(beam);
    const cable = new Mesh(keep(new CylinderGeometry(0.012, 0.012, 14, 6)), trussMat);
    cable.position.set(CORNERS[k][0] * 1.2, TRUSS_Y + 7, CORNERS[k][1] * 1.2);
    group.add(cable);
  });
  addLamps(group, keep, trussMat);

  // key light straight above, with soft shadows on the canvas
  const key = new SpotLight(0xfff4e6, 120, 0, 0.5, 0.55, 2);
  key.position.set(0, 9, 0);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  group.add(key, key.target);
  // truss fills from the four sides (modelling light on the fighters)
  for (const side of SIDES) {
    const s = new SpotLight(0xfff0dc, 26, 0, 0.75, 0.6, 2);
    s.position.copy(onSide(side, TRUSS, 0, TRUSS_Y - 0.3));
    s.target.position.set(-s.position.x * 0.3, 0.8, -s.position.z * 0.3);
    group.add(s, s.target);
  }
  // cool wash over the stands so the crowd reads as a crowd
  const forward = new Vector3();
  for (const yaw of FACINGS) {
    const s = new SpotLight(0x6d82c4, 30, 0, 0.9, 0.8, 2);
    s.position.set(0, 7.5, 0);
    forwardOf(yaw, forward);
    s.target.position.set(-forward.x * 14, FLOOR + 3, -forward.z * 14);
    group.add(s, s.target);
  }
  group.add(new HemisphereLight(0x3a4668, 0x08080a, 0.18));
}

/** lamp housings on the truss, glowing faces aimed at the canvas through a hazy shaft */
function addLamps(group: Group, keep: Keep, housingMat: MeshStandardMaterial) {
  const lampGeo = keep(new CylinderGeometry(0.16, 0.13, 0.3, 16));
  const lampFaceGeo = keep(new CylinderGeometry(0.125, 0.125, 0.01, 16));
  const lampFaceMat = keep(new MeshBasicMaterial({ color: new Color(6, 5.6, 5) }));
  const beamMat = keep(beamMaterial(0xfff2de, 0.012));
  for (const side of SIDES) {
    for (const f of [-0.6, 0, 0.6]) {
      const p = onSide(side, TRUSS, f * TRUSS, TRUSS_Y - 0.3);
      const aim = new Vector3(-p.x * 0.35, 0, -p.z * 0.35);
      const lamp = new Group();
      lamp.position.copy(p);
      lamp.lookAt(aim);
      lamp.rotateX(Math.PI / 2);
      lamp.add(new Mesh(lampGeo, housingMat));
      const face = new Mesh(lampFaceGeo, lampFaceMat);
      face.position.y = -0.155;
      lamp.add(face);
      group.add(lamp);
      const shaft = new Mesh(keep(new ConeGeometry(0.55, p.distanceTo(aim), 24, 1, true)), beamMat);
      shaft.position.copy(p).lerp(aim, 0.5);
      shaft.lookAt(aim);
      shaft.rotateX(-Math.PI / 2);
      group.add(shaft);
    }
  }
}

/** soft vertical light shaft (additive, fades toward the floor and the edges) */
function beamMaterial(color: number, strength: number) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { color: { value: new Color(color) }, strength: { value: strength } },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vN; varying vec3 vView;
      void main() {
        vY = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float strength;
      varying float vY; varying vec3 vN; varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(vN, vView)), 1.5);
        float along = smoothstep(0.0, 1.0, vY) * 0.85 + 0.15;
        gl_FragColor = vec4(color * strength * edge * along, 1.0);
      }`,
  });
}

/** the scoreboard cube hanging over the ring */
export function addJumbotron(group: Group, keep: Keep) {
  const screenTex = keep(screenTexture());
  const tron = new Group();
  tron.position.y = 8.6;
  const frameMat = keep(new MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.7, roughness: 0.4 }));
  const scr = keep(new MeshBasicMaterial({ map: screenTex, color: new Color(1.6, 1.6, 1.6) }));
  const box = new Mesh(keep(new BoxGeometry(3.4, 1.95, 3.4)), [scr, scr, frameMat, frameMat, scr, scr]);
  tron.add(box);
  const rim = new Mesh(keep(new BoxGeometry(3.6, 0.12, 3.6)), keep(new MeshBasicMaterial({ color: new Color(2.4, 0.25, 0.3) })));
  rim.position.y = -1.03;
  tron.add(rim);
  group.add(tron);
}
