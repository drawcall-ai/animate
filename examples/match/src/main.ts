import { PROP, block, handle, stage } from "@drawcall/example-stage"
import { Mesh, MeshStandardMaterial, TorusGeometry } from "three"
import { LENGTH, NET, WIDTH } from "./court"
import { type Frame, createMatch } from "./match"
import { rig } from "./rig"

// (No top-level await: a chunk the rig loads lazily imports this one, and would wait for it forever.)
async function main() {
  const DT = 1 / 60 // the match runs in fixed frames: a contact happens exactly on one
  const el = (id: string) => document.getElementById(id)!
  const rigged = await Promise.all([rig(), rig()]) // the two players: the same character, rigged twice
  const match = await createMatch(
    Math.floor(Math.random() * 1e6) + 1,
    rigged.map((r) => r.object),
  )
  let speed = 1,
    owed = 0,
    last: Frame | undefined,
    note = "first ball"
  const solveMs = [0, 0]

  const { scene, camera, orbit } = stage((dt) => {
    owed = Math.min(owed + dt * speed, 0.1)
    for (; owed >= DT; owed -= DT) {
      last = match.step(DT)
      if (last.contact)
        note = last.contact.hit
          ? `player ${"AB"[last.contact.player]} hit it, ${(1000 * last.contact.distance).toFixed(1)} mm from the sweet spot`
          : `player ${"AB"[last.contact.player]} missed by ${(100 * last.contact.distance).toFixed(0)} cm (${last.contact.why})`
      if (last.ended) note = `rally over after ${match.rallies.at(-1)} hits: ${last.ended}`
      last.solveMs.forEach((ms, i) => (solveMs[i] += (ms - solveMs[i]) * 0.05))
    }
    ball.position.copy(match.court.ball.position)
    match.players.forEach((player, i) => {
      marks[i].visible = !!player.shot && !player.shot.done
      if (player.shot) marks[i].position.copy(player.frame.localToWorld(player.shot.contact.clone()))
    })
    if (close) {
      // ?follow=A or B: the camera stays close to that player
      const at = close.body.positionOf(close.body.root).setY(1)
      camera.position.add(at.clone().sub(orbit.target))
      orbit.target.copy(at)
    }
    if (!last) return
    const missed = last.results.map((r, i) =>
      Math.max(
        ...r.goals
          .filter((_, j) => {
            const g = last!.goals[i][j]
            return "a" in g && g.hard
          })
          .map((g) => g.missedBy),
      ),
    )
    el("hud").textContent = [
      `rally: ${match.hits} hits   rallies played: ${match.rallies.length}${match.rallies.length ? ` (${match.rallies.slice(-8).join(" ")} hits)` : ""}`,
      note,
      ...match.players.map(
        (p, i) =>
          `player ${"AB"[i]}: ${p.shot && !p.shot.done ? p.shot.stroke.name.padEnd(8) : "waiting "}  solve ${solveMs[i].toFixed(1)} ms, ${String(last!.results[i].iterations).padStart(2)} iterations, hard goals missed by ${missed[i].toExponential(0)}`,
      ),
    ].join("\n")
  })
  camera.position.set(-17, 7, -6)
  orbit.target.set(0, 1, 0)
  const close = match.players["AB".indexOf(new URLSearchParams(location.search).get("follow") ?? "-")]
  if (close) camera.position.set(-2.6, 1.6, close === match.players[0] ? 3.4 : -3.4)

  // What is drawn: the court, the net, the ball, the players and their rackets, and where each means to meet the ball.
  const paint = (color: number) => new MeshStandardMaterial({ color, roughness: 0.9 })
  const WHITE = paint(0xe8ecf0)
  scene.add(
    block([2 * WIDTH + 6, 0.02, 2 * LENGTH + 14], [0, -0.012, 0], paint(0x2b5d49)),
    block([2 * WIDTH, 0.02, 2 * LENGTH], [0, -0.008, 0], paint(0x2f6f8f)),
  )
  for (const z of [-LENGTH, LENGTH]) scene.add(block([2 * WIDTH, 0.02, 0.05], [0, -0.004, z], WHITE))
  for (const x of [-WIDTH, WIDTH]) scene.add(block([0.05, 0.02, 2 * LENGTH], [x, -0.004, 0], WHITE))
  scene.add(block([2 * WIDTH + 1, NET, 0.02], [0, NET / 2, 0], new MeshStandardMaterial({ color: 0xdfe4ea, transparent: true, opacity: 0.35 })))
  const ball = handle(0xd8e021, 0.05) // drawn a little larger than it is, to be seen from the stands
  const marks = match.players.map(() => handle(0xe5484d, 0.03))
  scene.add(match.court.scene, ball, ...marks)
  for (const player of match.players) {
    const head = new Mesh(new TorusGeometry(0.13, 0.012, 8, 32), PROP)
    head.position.set(0, 0.5, 0)
    player.racket.add(block([0.025, 0.36, 0.025], [0, 0.18, 0]), head)
    scene.add(player.frame)
  }

  el("hint").textContent =
    "Two players, each planned every frame from where the ball really is. The ball belongs to the physics engine: a racket only sets its velocity at contact. Red dots: where each player means to meet it."
  for (const [name, value] of [
    ["real time", 1],
    ["1/4 speed", 0.25],
    ["pause", 0],
  ] as const) {
    const button = document.createElement("button")
    button.textContent = name
    button.onclick = () => {
      speed = value
      document.querySelectorAll("#buttons button").forEach((b) => b.classList.toggle("on", b === button))
    }
    el("buttons").append(button)
  }
  el("buttons").firstElementChild!.classList.add("on")
}
void main()
