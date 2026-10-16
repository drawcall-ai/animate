import { Group, Vector3 } from 'three';
import { flattenCharacterModelOptions, loadCharacterModel, type CharacterModel } from '@pmndrs/viverse';
import { Bodies, instance } from './stage/bodies';
import { Framing, placeCamera, VIEWS } from './stage/camera';
import { CinematicCamera } from './stage/cinematic';
import { byId } from './dom';
import { Playback } from './playback';
import { FIXED_DT, type Scenario } from './scenario';
import { SCENARIOS } from './scenarios';
import { Simulation } from './simulation';
import { drawProps } from './stage/props';
import { FOV, Stage } from './stage';
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
const props = new Group();
stage.scene.add(props);
const bodies = new Bodies(stage.scene);
/** the scenario's body, or the one body=openpose|mannequin asks for */
function bodyOf(s: Scenario): NonNullable<Scenario['body']> {
  const asked = params.get('body');
  if (asked === 'openpose') return 'openpose';
  if (asked === 'mannequin') return {};
  return s.body ?? 'openpose';
}
// the viverse characters the scenarios wear, loaded up front (by url; no url = viverse's mannequin;
// Draco decoding for compressed files such as Drawcall Market characters)
const characters = new Map<string | undefined, CharacterModel>();
for (const s of SCENARIOS) {
  const body = bodyOf(s);
  if (body !== 'openpose' && !characters.has(body.url)) characters.set(body.url, await loadCharacterModel(...flattenCharacterModelOptions({ url: body.url, useDraco: true })));
}
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

let scenario = SCENARIOS.find((s) => s.id === params.get('example')) ?? SCENARIOS[0];
let playback = start(scenario);
show();

function load(s: Scenario) {
  scenario = s;
  playback = start(s);
  show();
}

/** the scenario's actors are OpenPose skeletons, or copies of its viverse character */
function start(s: Scenario) {
  const body = bodyOf(s);
  if (body === 'openpose') return new Playback(new Simulation(s));
  const character = characters.get(body.url);
  if (!character) throw new Error(`character ${body.url ?? 'mannequin'} was not loaded`);
  return new Playback(new Simulation(s, () => instance(character)));
}

/** sets the stage for the playback just started */
function show() {
  const { scenario: s, actors } = playback.sim;
  bodies.cast(actors);
  stage.setEnvironment(s);
  bodies.castShadows(!!stage.env);
  framing.set(playback.blend(1).root, facing());
  panel.select(s);
  if (settings.view === 'orbit') startOrbit();
  if (!capture) {
    const url = new URL(location.href);
    url.searchParams.set('example', s.id);
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
  const between = playback.blend(alpha);
  drawProps(props, between.props);
  stage.env?.update(sim.t);
  const still = capture && !video;
  if (still) framing.set(between.root, facing());
  else framing.follow(between.root, playback.velocity, facing(), dt);
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
  bodies.hidden = settings.flat;
  stage.draw(settings.flat ? bodies.all : null);
}

if (video) recordVideo();
else if (capture) captureStill();
else playLive();

function recordVideo() {
  // cam=cinematic: a scripted third → first person camera
  const cinematic = params.get('cam') === 'cinematic' ? new CinematicCamera() : null;
  // (the cinematic camera starts from the normal shot: keep that shot's own camera state
  // separate, so taking the camera over doesn't disturb the orbit it blends from)
  let orbit: Vector3 | null = null;
  let t = 0;
  let acc = 0;
  const render = (dt: number) => {
    const camera = stage.camera;
    if (cinematic && orbit) {
      camera.position.copy(orbit);
      camera.fov = FOV;
    }
    aim();
    if (cinematic) {
      orbit = camera.position.clone();
      const look = settings.view === 'orbit' ? stage.controls.target.clone() : framing.focus.clone();
      cinematic.apply(camera, t, dt, playback.sim.actors, { pos: camera.position.clone(), look, fov: FOV });
      bodies.hideHead(cinematic.hideOwnHead);
    }
    draw();
  };
  window.__frame = (dt: number) => {
    t += dt;
    acc += dt;
    while (acc >= FIXED_DT - 1e-9) {
      acc -= FIXED_DT;
      playback.step();
    }
    sync(Math.max(0, acc) / FIXED_DT, dt);
    render(dt);
    return playback.sim.t < playback.sim.scenario.duration;
  };
  render(1 / 60);
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
