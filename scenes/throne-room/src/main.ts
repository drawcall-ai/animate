import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, FogExp2, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BEATS } from './beats';
import { createPlaceholderHall, DAIS, HALL } from './hall';
import { loadWardrobe } from './models';
import { play, type Playing } from './play';

// The viewer: pick a beat (?beat=<id>), watch it in the hall. The story and bodies step at a fixed 60 Hz.

const STEP = 1 / 60;
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.append(renderer.domElement);

const world = new Scene();
world.background = new Color(0x15120f);
world.fog = new FogExp2(0x15120f, 0.012);
world.add(new HemisphereLight(0xd9c9a8, 0x2a2118, 1.2));
const sun = new DirectionalLight(0xfff0d0, 2.4);
sun.position.set(8, 30, 10);
sun.target.position.set(0, 0, HALL.length / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 30, bottom: -30, far: 80 });
world.add(sun, sun.target, createPlaceholderHall());

const camera = new PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, 2.2, -3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, DAIS.top);
const params = new URLSearchParams(location.search);
// ?cam=x,y,z,targetX,targetY,targetZ places the camera; ?at=<s> plays that far at once and pauses (for screenshots)
const view = params.get('cam')?.split(',').map(Number);
if (view?.length === 6) {
  camera.position.set(view[0], view[1], view[2]);
  controls.target.set(view[3], view[4], view[5]);
}
const seek = Number(params.get('at') ?? NaN);

const picker = document.querySelector<HTMLSelectElement>('#beat')!;
const playButton = document.querySelector<HTMLButtonElement>('#play')!;
const timeLabel = document.querySelector<HTMLSpanElement>('#time')!;
for (const beat of BEATS) picker.add(new Option(beat.title, beat.id));
picker.value = params.get('beat') ?? BEATS[0]?.id ?? '';

const dress = await loadWardrobe();
let playing: Playing | undefined;
let paused = false;
let pending = 0;

function start() {
  if (playing) world.remove(playing.scene);
  const beat = BEATS.find((each) => each.id === picker.value);
  playing = beat && play(beat, dress);
  if (playing) world.add(playing.scene);
  pending = 0;
  if (playing && seek >= 0) {
    while (playing.time < seek - STEP / 2) playing.step(STEP);
    paused = true;
    playButton.textContent = 'Play';
  }
}
picker.onchange = () => {
  params.set('beat', picker.value);
  history.replaceState(null, '', `?${params}`);
  start();
};
playButton.onclick = () => {
  paused = !paused;
  playButton.textContent = paused ? 'Play' : 'Pause';
};
document.querySelector<HTMLButtonElement>('#restart')!.onclick = start;
start();

const clock = new Clock();
renderer.setAnimationLoop(() => {
  const width = innerWidth, height = innerHeight;
  if (renderer.domElement.width !== Math.floor(width * renderer.getPixelRatio())) {
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  pending += paused ? 0 : Math.min(clock.getDelta(), 0.1);
  if (paused) clock.getDelta();
  while (playing && pending >= STEP) {
    playing.step(STEP);
    pending -= STEP;
  }
  if (playing) timeLabel.textContent = `${playing.time.toFixed(1)} s${playing.finished() ? (playing.done() ? ' · done' : ' · finished, not done') : ''}`;
  controls.update();
  renderer.render(world, camera);
  document.body.dataset.ready = 'true';
});
