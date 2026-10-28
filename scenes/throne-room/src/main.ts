import { ACESFilmicToneMapping, AudioListener, Clock, Color, DirectionalLight, FogExp2, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BEATS } from './beats';
import { createHall, DAIS, HALL, SUN } from './hall';
import { loadWardrobe } from './models';
import { play, type Playing, type View } from './play';
import { Sound } from './film/sound';

// The viewer: pick a beat (?beat=<id>), watch it in the hall. The story and bodies step at a fixed 60 Hz. A filmed beat is watched
// through its story camera, with sound once a click has allowed it (browsers start audio only after one); "Orbit" looks around instead.

const STEP = 1 / 60;
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.append(renderer.domElement);

const world = new Scene();
// warm daylight haze: the sun through the hall's high windows, sky and sand-floor bounce as the fill
const haze = new Color(0xb9a585);
world.background = haze;
world.fog = new FogExp2(haze, 0.016);
world.add(new HemisphereLight(0xffe9c4, 0x8a7458, 1.5));
const sun = new DirectionalLight(0xffe3b5, 3);
sun.target.position.set(0, 0, HALL.length / 2);
sun.position.copy(sun.target.position).addScaledVector(SUN, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
const hall = createHall();
world.add(sun, sun.target, hall);

// the film's wide shot: from high in the doorway, down the aisle between the troops to the dais
const camera = new PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, 9, 0.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, DAIS.top);
const params = new URLSearchParams(location.search);
// ?cam=x,y,z,targetX,targetY,targetZ places the camera; ?at=<s> plays that far at once and pauses (for screenshots)
const placed = params.get('cam')?.split(',').map(Number);
if (placed?.length === 6) {
  camera.position.set(placed[0], placed[1], placed[2]);
  controls.target.set(placed[3], placed[4], placed[5]);
}
const seek = Number(params.get('at') ?? NaN);

// the story camera a filmed beat moves, the sound it hears through it, and whether the viewer orbits instead of watching through it
const storyCamera = new PerspectiveCamera(40, 1, 0.1, 200);
world.add(storyCamera);
const sound = new Sound();
const view: View = { camera: storyCamera, sound, hall };
let orbiting = placed?.length === 6;

const picker = document.querySelector<HTMLSelectElement>('#beat')!;
const playButton = document.querySelector<HTMLButtonElement>('#play')!;
const timeLabel = document.querySelector<HTMLSpanElement>('#time')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const orbitButton = document.createElement('button');
const soundButton = document.createElement('button');
soundButton.textContent = 'Play with sound';
hud.insertBefore(orbitButton, timeLabel);
hud.insertBefore(soundButton, timeLabel);
for (const beat of BEATS) picker.add(new Option(beat.title, beat.id));
picker.value = params.get('beat') ?? BEATS[0]?.id ?? '';

const dress = await loadWardrobe();
let playing: Playing | undefined;
let paused = false;
let pending = 0;

function start() {
  if (playing) {
    playing.staged.dispose?.();
    world.remove(playing.scene);
  }
  const beat = BEATS.find((each) => each.id === picker.value);
  playing = beat && play(beat, dress, view);
  if (playing) world.add(playing.scene);
  pending = 0;
  if (playing && seek >= 0) {
    sound.setMuted(true);
    while (playing.time < seek - STEP / 2) playing.step(STEP);
    sound.setMuted(false);
    setPaused(true);
  }
  showButtons();
}
function setPaused(value: boolean) {
  paused = value;
  playButton.textContent = paused ? 'Play' : 'Pause';
  sound.setPaused(paused);
}
function showButtons() {
  const filmed = playing?.staged.filmed ?? false;
  orbitButton.hidden = !filmed;
  orbitButton.textContent = orbiting ? 'Story camera' : 'Orbit';
  soundButton.hidden = !filmed || sound.connected;
}
/** turns sound on (from a click: the browser allows audio from then on) and plays the film from the start with it */
async function startSound() {
  soundButton.disabled = true;
  soundButton.textContent = 'Loading sound…';
  const listener = new AudioListener();
  storyCamera.add(listener);
  await sound.connect(listener);
  soundButton.disabled = false;
  if (!(seek >= 0)) start();
  setPaused(false);
  showButtons();
}
soundButton.onclick = () => void startSound();
orbitButton.onclick = () => {
  orbiting = !orbiting;
  // the orbit takes over from where the story camera is, looking where it looks
  if (orbiting) {
    camera.position.copy(storyCamera.position);
    controls.target.copy(storyCamera.getWorldDirection(controls.target).multiplyScalar(8).add(storyCamera.position));
    camera.fov = storyCamera.fov;
    camera.updateProjectionMatrix();
  }
  showButtons();
};
picker.onchange = () => {
  params.set('beat', picker.value);
  history.replaceState(null, '', `?${params}`);
  start();
};
playButton.onclick = () => setPaused(!paused);
document.querySelector<HTMLButtonElement>('#restart')!.onclick = start;
start();
// a filmed beat waits for its first click, so its sound can start with it (screenshots at ?at= play silent); one step places its camera
if (playing?.staged.filmed && !(seek >= 0)) {
  playing.step(STEP);
  setPaused(true);
}

const clock = new Clock();
renderer.setAnimationLoop(() => {
  const width = innerWidth, height = innerHeight;
  if (renderer.domElement.width !== Math.floor(width * renderer.getPixelRatio())) {
    renderer.setSize(width, height);
    camera.aspect = storyCamera.aspect = width / height;
    camera.updateProjectionMatrix();
    storyCamera.updateProjectionMatrix();
  }
  pending += paused ? 0 : Math.min(clock.getDelta(), 0.1);
  if (paused) clock.getDelta();
  while (playing && pending >= STEP) {
    playing.step(STEP);
    pending -= STEP;
  }
  if (playing) timeLabel.textContent = `${playing.time.toFixed(1)} s${playing.finished() ? (playing.done() ? ' · done' : ' · finished, not done') : ''}`;
  controls.enabled = orbiting || !playing?.staged.filmed;
  controls.update();
  renderer.render(world, controls.enabled ? camera : storyCamera);
  document.body.dataset.ready = 'true';
});
