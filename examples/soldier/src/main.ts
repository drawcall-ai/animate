import { el, handle, stage } from "@drawcall/example-stage"
import { CachedSoldierLoader } from "@drawcall/example-stage/soldier"
import { describeGrip, solve } from "@drawcall/animate"
import { Group } from "three"
import { createSoldierPlanner, type SoldierPlanner } from "./soldier"

const target = handle()
target.position.set(1.5, 1.3, 14)

let soldier: SoldierPlanner | undefined,
  t = 0,
  aimed = true,
  since = -10 // aiming or lowered, handed over in 0.4 s
const aiming = (time: number) => {
  const x = Math.min(1, Math.max(0, (time - since) / 0.4))
  return aimed ? x : 1 - x
}
const player = new Group() // the body's bones and the rigged soldier, which hangs on them

const { scene, follow, drag } = stage((dt) => {
  if (!soldier) return
  const { body, grips } = soldier
  t += dt
  const goals = soldier.update(dt),
    r = solve(body, goals, dt)
  follow(body.root.position)
  el("hud").textContent = [
    `hard goals missed by ${r.hardMissedBy.toExponential(1)}  ${r.hardMissedBy > 1e-6 ? "(out of reach: closest pose)" : "(exact)"}`,
    `grips error       ${r.loopsMissedBy.toExponential(1)}`,
    `Newton iterations ${r.iterations}${r.converged ? "" : " (not converged)"}`,
    `joints on a limit ${r.jointsAtLimit.length}${r.jointsAtLimit.length ? ": " + r.jointsAtLimit.join(" ") : ""}`,
    `\nright hand round the pistol grip\n${describeGrip(grips.pistol)}`,
    `\nand its index on the trigger\n${describeGrip(grips.right)}`,
    `\nleft hand on the handguard\n${describeGrip(grips.left)}`,
  ].join("\n")
})
scene.add(player, target)
drag(target)

new CachedSoldierLoader().loadAsync().then(({ object }) => {
  soldier = createSoldierPlanner(object, () => target.position.clone(), aiming)
  player.add(soldier.body.root, object)
})

el("hint").textContent =
  "A soldier walks up and back down a snaking path holding the PAC-9 rifle in both hands, his steps planned by the locomotion planner, always facing the aim. Each hand holds it in the grip found for it, the right index on the trigger, found once and kept; one hard goal owns the rifle's pose. Drag the red aim target. The arms are busy with the rifle, so the walk swings neither."
const button = document.createElement("button")
button.textContent = "Aim / lower"
button.onclick = () => {
  since = t
  aimed = !aimed
}
el("buttons").append(button)
