import { el, handle, stage } from "@drawcall/example-stage"
import { CachedPlayerLoader } from "@drawcall/example-stage/player"
import { describeGrip, solve } from "@drawcall/animate"
import { Group } from "three"
import { BALL, createStrokePlanner, STROKES, type StrokePlanner } from "./strokes"

const contact = handle() // where the ball is met: drag it and the swing bends to meet it there
const ball = handle(0xd8e021, BALL)
let planner: StrokePlanner | undefined,
  t = 0
const player = new Group() // the body's bones and the rigged character, which hangs on them

const { scene, drag } = stage((dt) => {
  if (!planner) return
  t += dt
  const goals = planner.goalsAt(t),
    r = solve(planner.body, goals, dt)
  ball.position.copy(planner.ball(t)) // the ball is not the solver's business; it is only drawn
  ball.visible = Math.abs(ball.position.z) < 14
  el("hud").textContent = [
    `hard goals missed by ${r.hardMissedBy.toExponential(1)}  ${r.hardMissedBy > 1e-6 ? "(out of reach: closest pose)" : "(exact)"}`,
    `Newton iterations ${r.iterations}${r.converged ? "" : " (not converged)"}`,
    `joints on a limit ${r.jointsAtLimit.length}${r.jointsAtLimit.length ? ": " + r.jointsAtLimit.join(" ") : ""}`,
    ...Object.entries(planner.grips).map(([side, held]) => `\n${side} hand on the racket\n${describeGrip(held)}`),
    ...(planner.toss ? [`\nleft hand on the ball, until it lets go\n${describeGrip(planner.toss)}`] : []),
  ].join("\n")
})
scene.add(contact, ball, player)
drag(contact)

// a stroke is played by the character rigged afresh, so that each starts from the rig at rest
async function start(index: number) {
  const stroke = STROKES[index]
  const rigged = (await new CachedPlayerLoader().loadAsync()).object
  player.clear()
  planner = createStrokePlanner(stroke, rigged, () => contact.position.clone())
  player.add(planner.body.root, rigged)
  contact.position.copy(planner.nominal)
  t = 0
  el("hint").textContent =
    `${stroke.name}, about a third of real speed. The hands hold the racket in the grips found for them, found once and kept: the racket hangs from the right hand. Its sweet spot meets the ball exactly at the red point; drag it and the swing bends to meet it there.`
  document.querySelectorAll("#buttons button").forEach((b, i) => b.classList.toggle("on", i === index))
}
STROKES.forEach((stroke, i) => {
  const button = document.createElement("button")
  button.textContent = stroke.name
  button.onclick = () => start(i)
  el("buttons").append(button)
})
start(0)
