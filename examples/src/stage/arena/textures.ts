import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { context2d } from '../../dom';
import { seeded } from '@drawcall/animate/rig';
import { APRON, FLOOR, HALF } from './layout';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(context2d(c));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, rand: () => number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** ring canvas incl. apron: light grey fabric, navy apron band with lettering, centre logo */
export function matTexture() {
  const rand = seeded(3);
  const S = 2048;
  const ppm = S / (2 * (HALF + APRON));
  return canvasTexture(S, S, (g) => {
    g.fillStyle = '#12203d';
    g.fillRect(0, 0, S, S);
    const inner = 2 * HALF * ppm;
    const o = (S - inner) / 2;
    g.fillStyle = '#b4b8c2';
    g.fillRect(o, o, inner, inner);
    // worn centre: scuffs where the fighters move most
    for (let i = 0; i < 60; i++) {
      const x = S / 2 + (rand() - 0.5) * inner * 0.7;
      const y = S / 2 + (rand() - 0.5) * inner * 0.7;
      const r = 40 + rand() * 160;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(90,90,100,${0.05 + rand() * 0.05})`);
      gr.addColorStop(1, 'rgba(90,90,100,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    noise(g, S, S, 90000, 0.05, rand);
    // centre logo
    g.save();
    g.translate(S / 2, S / 2);
    g.strokeStyle = 'rgba(18,32,61,0.85)';
    g.lineWidth = 22;
    g.beginPath();
    g.arc(0, 0, 1.05 * ppm, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(200,30,40,0.8)';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(0, 0, 0.92 * ppm, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(18,32,61,0.88)';
    g.font = `900 ${0.36 * ppm}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROHUMAN', 0, -0.06 * ppm);
    g.font = `700 ${0.13 * ppm}px Helvetica, Arial, sans-serif`;
    g.fillStyle = 'rgba(200,30,40,0.85)';
    g.fillText('FIGHT  NIGHT', 0, 0.3 * ppm);
    g.restore();
    // apron lettering, one run per side, reading from outside the ring
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = `800 ${0.3 * ppm}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(S / 2, S / 2);
      g.rotate((k * Math.PI) / 2);
      g.fillText('PROHUMAN   ·   SPARSE-INPUT IK   ·   PROHUMAN', 0, S / 2 - o / 2);
      g.restore();
    }
    // canvas seam where the apron folds over the edge
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 4;
    g.strokeRect(o, o, inner, inner);
  });
}

/** the platform's sides, from the canvas edge down to the floor */
export function skirtTexture() {
  const W = 2048;
  const H = Math.round((W * -FLOOR) / (2 * (HALF + APRON)));
  return canvasTexture(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#141a2c');
    gr.addColorStop(1, '#07080d');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#c8202a';
    g.fillRect(0, 0, W, H * 0.07);
    g.fillStyle = '#ffffff';
    g.fillRect(0, H * 0.07, W, H * 0.015);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${H * 0.36}px Helvetica, Arial, sans-serif`;
    g.fillStyle = '#f2f2f2';
    g.fillText('PROHUMAN', W / 2, H * 0.52);
    g.font = `700 ${H * 0.13}px Helvetica, Arial, sans-serif`;
    g.fillStyle = '#c8202a';
    g.fillText('FIGHT NIGHT', W * 0.13, H * 0.52);
    g.fillText('FIGHT NIGHT', W * 0.87, H * 0.52);
  });
}

export function screenTexture() {
  return canvasTexture(1024, 576, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 576);
    gr.addColorStop(0, '#0a1230');
    gr.addColorStop(1, '#020309');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1024, 576);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8243a';
    g.font = '900 64px Helvetica, Arial, sans-serif';
    g.fillText('ROUND 3', 512, 90);
    g.fillStyle = '#ffffff';
    g.font = '900 190px Helvetica, Arial, sans-serif';
    g.fillText('1:47', 512, 280);
    g.font = '700 54px Helvetica, Arial, sans-serif';
    g.fillStyle = '#c9d4ff';
    g.fillText('RED   ·   PROHUMAN   ·   BLUE', 512, 470);
  });
}

export function tableClothTexture() {
  return canvasTexture(1024, 256, (g) => {
    g.fillStyle = '#08090d';
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = '#c8202a';
    g.fillRect(0, 0, 1024, 14);
    g.fillStyle = '#e9e9ee';
    g.font = '800 92px Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROHUMAN', 512, 140);
  });
}
