import { Group } from 'three';
import { Figures, Wardrobe } from './stage/bodies';
import { Framing, placeCamera, VIEWS } from './stage/camera';
import { byId } from './dom';
import { Playback } from './playback';
import { FIXED_DT, type Scenario } from './scenario';
import { DOG, HORSE, LION, OUTLIER, PERSON, SOLDIER, type PersonSkeleton } from './skeletons';
import { SCENARIOS } from './scenarios';
import { Simulation } from './simulation';
import { Stage } from './stage';
import { drawTrail } from './stage/trail';
import { Panel, type Settings } from './ui';

const params = new URLSearchParams(location.search);
// video: frame-exact recording of live playback (capture layout, live camera smoothing),
// driven one frame at a time through window.__frame(dt) — see scripts/video.mjs
const video = params.has('video');
// capture: a still at t (scripts/capture.mjs), or a video
const capture = params.has('capture') || video;
if (capture) document.body.classList.add('capture');

const stage = new Stage(byId('c', HTMLCanvasElement), byId('overlay', HTMLCanvasElement), capture);
/** the skeleton people stand on where a scenario names none: the soldier (wearing its model) unless body=person|outlier asks for a bare one */
const skeleton = ({ person: PERSON, outlier: OUTLIER, soldier: SOLDIER } as Record<string, PersonSkeleton | undefined>)[params.get('body') ?? 'soldier'];
if (!skeleton) throw new Error(`body=${params.get('body')}: a body is person, outlier or soldier`);
/** the models bodies wear, by the skeleton measured on each: the bodies of other skeletons go bare */
byId('time', HTMLElement).textContent = 'rigging the models…';
const wardrobe = await Wardrobe.load([[SOLDIER, 'models/soldier.glb'], [HORSE, 'models/horse.glb'], [DOG, 'models/dog.glb'], [LION, 'models/lion.glb']]);
const figures = new Figures();
/** the run's scene, then the figures (they follow its world matrices) */
const shown = new Group();
stage.scene.add(shown, figures.group);
const caption = byId('caption', HTMLElement);
const zoom = Number(params.get('zoom') ?? 1);
/** the shots turned about the focus by this much (rad, + = toward the body's left): the far side of what it faces */
const turn = Number(params.get('turn') ?? 0);
const framing = new Framing();
const settings: Settings = {
  view: VIEWS.find((v) => v === params.get('view')) ?? 'orbit',
  flat: params.get('mode') === '2d',
  playing: !params.has('t'),
};
const panel = new Panel(settings, {
  select: load,
  viewChanged: () => {
    if (settings.view === 'orbit') startOrbit();
  },
  seek: (fraction) => seek(fraction * playback.sim.scenario.duration),
});
window.addEventListener('resize', () => stage.resize());
stage.resize();

let scenario = SCENARIOS.find((s) => s.id === params.get('scenario')) ?? SCENARIOS[0];
let playback = start(scenario);
show();

function load(s: Scenario) {
  scenario = s;
  playback = start(s);
  show();
}

/** a run of the scenario, its bodies dressed from the wardrobe */
function start(s: Scenario) {
  return new Playback(new Simulation(s, { skeleton, dress: wardrobe.dress }));
}

/** sets the stage for the playback just started */
function show() {
  const { scenario: s, stage: run } = playback.sim;
  shown.clear();
  shown.add(run.scene);
  figures.cast(run.bodies);
  framing.set(playback.blend(1), facing());
  panel.select(s);
  if (settings.view === 'orbit') startOrbit();
  if (!capture) {
    const url = new URL(location.href);
    url.searchParams.set('scenario', s.id);
    history.replaceState(null, '', url);
  }
  sync();
}

function seek(t: number) {
  if (t < playback.sim.t - 1e-9) load(scenario);
  playback.advanceTo(t);
  sync();
}

/** the free camera starts from the three-quarter shot, orbiting the focus */
function startOrbit() {
  placeCamera(stage.camera, 'three', framing, distance(), playback.bounds);
  stage.controls.target.copy(framing.focus);
}

function distance() {
  return (playback.sim.scenario.cameraDistance ?? 4.6) / zoom;
}

/** shows the state `alpha` of the way from the previous step to the current one; `dt` = display frame time */
function sync(alpha = 1, dt = 1 / 60) {
  const { sim } = playback;
  const s = sim.scenario;
  const focus = playback.blend(alpha);
  const still = capture && !video;
  if (still) framing.set(focus, facing());
  else framing.follow(focus, playback.velocity, facing(), dt);
  panel.showTime(sim.t, s.duration);
  caption.textContent = still ? `${s.id}  t=${sim.t.toFixed(2)}s  ${settings.view}` : '';
}

/** the way the shots are taken against: the way the body faces, as balance has it (not the hips' twist as they step or swing) */
function facing() {
  return playback.facing + turn;
}

/** aims the camera at the framing (which is smoothed already) */
function aim() {
  if (settings.view === 'orbit') {
    stage.controls.target.copy(framing.focus);
    stage.controls.update();
  } else {
    const angles = playback.sim.scenario.cameraAngles;
    const bearing = settings.view === 'front' || settings.view === 'side' ? angles?.[settings.view] : undefined;
    placeCamera(stage.camera, settings.view, framing, distance(), playback.bounds, bearing);
  }
}

function draw() {
  figures.hidden = settings.flat;
  stage.draw(settings.flat ? figures.joints : null);
}

if (video) recordVideo();
else if (capture) captureStill();
else playLive();

function recordVideo() {
  let acc = 0;
  window.__frame = (dt: number) => {
    acc += dt;
    while (acc >= FIXED_DT - 1e-9) {
      acc -= FIXED_DT;
      playback.step();
    }
    sync(Math.max(0, acc) / FIXED_DT, dt);
    aim();
    draw();
    return playback.sim.t < playback.sim.scenario.duration;
  };
  aim();
  draw();
  window.__ready = true;
}

function captureStill() {
  const t = Number(params.get('t') ?? 0);
  // trail=<seconds>: each key joint's path over that window
  const trail = Number(params.get('trail') ?? 0);
  if (trail > 0) drawTrail(stage.scene, playback, t - trail, t);
  playback.advanceTo(t);
  sync();
  aim();
  draw();
  window.__ready = true;
}

function playLive() {
  if (params.has('t')) seek(Number(params.get('t')));
  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (settings.playing) {
      acc += dt;
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        playback.step();
        if (playback.sim.t > playback.sim.scenario.duration) load(scenario);
      }
      sync(acc / FIXED_DT, dt);
    }
    aim();
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
