// A filmstrip of a body as an SVG: stick figures seen from the side, one per shot, each centred on the capsule
// (the faint box) so that what the body does around it is what one sees. Left limbs blue, right limbs orange.

import type { Body } from "@drawcall/animate"
import { Bone, type Object3D, Vector3 } from "three"

const SCALE = 150, // px per metre
  GAP = 1.5 // m between shots

export function film(body: Body) {
  const shots: string[] = []
  const bones: Bone[] = []
  body.root.traverse((o) => void (o instanceof Bone && bones.push(o)))
  return {
    /** Record the body now, seen along the horizontal axis `across` (the view's x is `along`). */
    shot(label: string, capsule: Vector3, along: Vector3, planted: boolean[]) {
      const x0 = shots.length * GAP + GAP / 2
      const at = (p: Vector3) => `${((x0 + p.clone().sub(capsule).dot(along)) * SCALE).toFixed(1)},${((2.6 - p.y) * SCALE).toFixed(1)}`
      const world = (o: Object3D, local = new Vector3()) => o.localToWorld(local.clone())
      const line = (a: Vector3, b: Vector3, color: string, width = 5) =>
        `<line x1="${at(a).replace(",", '" y1="')}" x2="${at(b).replace(",", '" y2="')}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`
      const color = (name: string) => (/L$/.test(name) ? "#4c8dff" : /R$/.test(name) ? "#ff9a3c" : "#c9d2de")
      const far = (name: string) => (/L$/.test(name) ? 1 : /R$/.test(name) ? -1 : 0) * along.clone().cross(new Vector3(0, 1, 0)).x // which side faces the viewer does not matter much
      const parts = bones
        .flatMap((b) => [
          ...b.children.filter((c) => c instanceof Bone).map((c) => ({ z: far(c.name), s: line(world(b), world(c), color(c.name)) })),
          ...(b.name.startsWith("foot")
            ? [{ z: far(b.name), s: line(world(b, new Vector3(0, -0.06, -0.05)), world(b, new Vector3(0, -0.06, 0.17)), color(b.name)) }]
            : []),
          ...(b.name === "head"
            ? [{ z: 0, s: `<circle cx="${at(world(b, new Vector3(0, 0.1, 0))).replace(",", '" cy="')}" r="${0.1 * SCALE}" fill="#c9d2de"/>` }]
            : []),
        ])
        .sort((a, b) => a.z - b.z)
      const feet = ["L", "R"].map((S, i) =>
        planted[i] ? `<circle cx="${at(world(body.get("sole" + S))).replace(",", '" cy="')}" r="5" fill="#fff" stroke="${color(S)}" stroke-width="2"/>` : "",
      )
      const box = `<rect x="${(x0 - 0.3) * SCALE}" y="${(2.6 - capsule.y - 1.75) * SCALE}" width="${0.6 * SCALE}" height="${1.75 * SCALE}" rx="${0.3 * SCALE}" fill="none" stroke="#3a424e" stroke-dasharray="6 6"/>`
      const ground = `<line x1="${(x0 - GAP / 2) * SCALE}" y1="${2.6 * SCALE}" x2="${(x0 + GAP / 2) * SCALE}" y2="${2.6 * SCALE}" stroke="#56606d" stroke-width="2"/>`
      const text = `<text x="${x0 * SCALE}" y="${2.8 * SCALE}" fill="#aab3bf" font-family="monospace" font-size="15" text-anchor="middle">${label}</text>`
      shots.push(ground + box + parts.map((p) => p.s).join("") + feet.join("") + text)
    },
    svg: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${shots.length * GAP * SCALE}" height="${2.95 * SCALE}"><rect width="100%" height="100%" fill="#14171c"/>${shots.join("")}</svg>`,
  }
}
