import { VIEWS, type View } from './stage/camera';
import { byId } from './dom';
import type { Scenario } from './scenario';
import { SCENARIOS } from './scenarios';

/** what the side panel sets */
export interface Settings {
  view: View;
  /** 2D: the poses drawn as flat OpenPose over the scene, instead of the 3D skeletons */
  flat: boolean;
  playing: boolean;
  markers: boolean;
}

export interface Actions {
  select(s: Scenario): void;
  viewChanged(): void;
  markersChanged(): void;
  /** `fraction` of the scenario's duration */
  seek(fraction: number): void;
}

/** The side panel: the scenarios, views, play/pause, 2D/3D, markers and a time scrubber. */
export class Panel {
  private readonly play = byId('play', HTMLButtonElement);
  private readonly scrub = byId('scrub', HTMLInputElement);
  private readonly time = byId('time', HTMLElement);

  constructor(
    private readonly settings: Settings,
    on: Actions,
  ) {
    const list = byId('list', HTMLElement);
    for (const s of SCENARIOS) {
      const b = document.createElement('button');
      b.textContent = s.title;
      b.dataset.id = s.id;
      b.onclick = () => {
        on.select(s);
        this.setPlaying(true);
      };
      list.appendChild(b);
    }
    const views = byId('views', HTMLElement);
    for (const v of VIEWS) {
      const b = document.createElement('button');
      b.textContent = v;
      b.classList.toggle('on', v === settings.view);
      b.onclick = () => {
        settings.view = v;
        views.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        on.viewChanged();
      };
      views.appendChild(b);
    }
    this.setPlaying(settings.playing);
    this.play.onclick = () => this.setPlaying(!settings.playing);
    const mode = byId('mode', HTMLButtonElement);
    const showMode = () => (mode.textContent = settings.flat ? '3D skeleton' : '2D OpenPose');
    showMode();
    mode.onclick = () => {
      settings.flat = !settings.flat;
      showMode();
    };
    const markers = byId('markers', HTMLInputElement);
    markers.checked = settings.markers;
    markers.onchange = () => {
      settings.markers = markers.checked;
      on.markersChanged();
    };
    this.scrub.oninput = () => {
      this.setPlaying(false);
      on.seek(Number(this.scrub.value) / 1000);
    };
  }

  /** shows the scenario as the current one */
  select(s: Scenario) {
    byId('info', HTMLElement).innerHTML = `<div class="drives">input: ${s.drives}</div><p>${s.description}</p>`;
    document.querySelectorAll('#list button').forEach((b) => b.classList.toggle('active', b instanceof HTMLElement && b.dataset.id === s.id));
  }

  showTime(t: number, duration: number) {
    this.scrub.value = String(Math.round((t / duration) * 1000));
    this.time.textContent = `t = ${t.toFixed(2)} s / ${duration} s`;
  }

  private setPlaying(playing: boolean) {
    this.settings.playing = playing;
    this.play.textContent = playing ? 'Pause' : 'Play';
  }
}
