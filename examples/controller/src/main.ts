import { PROP, block, el, stage } from "@drawcall/example-stage"
import { CachedSoldierLoader } from "@drawcall/example-stage/soldier"
import { describeGrip } from "@drawcall/animate"
import { CapsuleGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three"
import { BOXES, type Input, PACE, createCharacter } from "./character"

// (No top-level await: a chunk the rig loads lazily imports this one, and would wait for it forever.)
async function main() {
  const character = await createCharacter((await new CachedSoldierLoader().loadAsync()).object)
  const { capsule, controller, body, locomotion, carry } = character
  const shell = new Mesh(new CapsuleGeometry(0.3, 1, 4, 16), new MeshBasicMaterial({ color: 0x4c8dff, wireframe: true, transparent: true, opacity: 0.25 }))
  capsule.add(shell)

  // Keyboard and gamepad become one input: where to go (relative to the camera), how fast, crouch, jump, rifle.
  const keys = new Set<string>()
  const input: Input = { move: new Vector3(), pace: "walk", crouch: false, jump: false, rifle: false }
  let pace: Input["pace"] = "walk",
    wasPressed = false
  addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat) input.jump = true
    if (e.code === "KeyR" && !e.repeat) input.rifle = !input.rifle
    if (e.code === "Digit1") pace = "walk"
    if (e.code === "Digit2") pace = "run"
    if (e.code === "Digit3") pace = "sprint"
    keys.add(e.code)
  })
  addEventListener("keyup", (e) => keys.delete(e.code))
  const down = (...codes: string[]) => +codes.some((c) => keys.has(c))

  let solveMs = 0
  const { scene, camera, follow } = stage((dt) => {
    if (dt <= 0) return // the physics steps only forward
    const pad = navigator.getGamepads?.().find((p) => p)
    const stick = pad && Math.hypot(pad.axes[0], pad.axes[1]) > 0.15 ? new Vector3(pad.axes[0], 0, pad.axes[1]) : new Vector3()
    const ahead = camera.getWorldDirection(new Vector3()).setY(0).normalize(),
      right = new Vector3(-ahead.z, 0, ahead.x)
    const x = down("KeyD", "ArrowRight") - down("KeyA", "ArrowLeft") + stick.x,
      z = down("KeyW", "ArrowUp") - down("KeyS", "ArrowDown") - stick.z
    input.move.copy(right.multiplyScalar(x).addScaledVector(ahead, z)).clampLength(0, 1)
    input.pace = down("ShiftLeft", "ShiftRight") || pad?.buttons[7]?.pressed ? "sprint" : pad && stick.lengthSq() ? "run" : pace
    input.crouch = !!down("KeyC") || !!pad?.buttons[1]?.pressed
    if (pad?.buttons[0]?.pressed && !wasPressed) input.jump = true
    wasPressed = !!pad?.buttons[0]?.pressed

    const { result, solveMs: ms } = character.frame(dt, input)
    input.jump = false
    solveMs += (ms - solveMs) * 0.05
    shell.scale.setY(controller.height / 1.6)
    shell.position.setY(controller.height / 2)
    follow(capsule.position)
    const pelvis = body.positionOf(body.root)
    el("hud").textContent = [
      `capsule ${controller.speed.toFixed(1)} m/s${controller.grounded ? "" : "  in the air"}${controller.crouched ? "  crouched" : ""}   pace: ${input.pace} (${PACE[input.pace]} m/s)`,
      `pelvis off the capsule ${(100 * Math.hypot(pelvis.x - capsule.position.x, pelvis.z - capsule.position.z)).toFixed(1)} cm`,
      `feet ${Object.values(locomotion.feet)
        .map((f) => `${f.side} ${f.planted ? "planted" : locomotion.airborne ? "air" : "swing"}`)
        .join("  ")}`,
      `solve ${solveMs.toFixed(1)} ms, ${result.iterations} iterations${result.converged ? "" : " (not converged)"}`,
      ...(input.rifle
        ? [
            `\nright hand round the pistol grip\n${describeGrip(carry.grips.pistol)}`,
            `\nand its index on the trigger\n${describeGrip(carry.grips.right)}`,
            `\nleft hand on the handguard\n${describeGrip(carry.grips.left)}`,
          ]
        : []),
    ].join("\n")
  })
  scene.add(character.scene, ...BOXES.map((box) => block(box.size, box.at, PROP)))

  el("hint").textContent =
    "A physics capsule (blue) moved by the input; the body follows it with planned steps. WASD / arrows or left stick: move. 1 2 3: walk, run, sprint (Shift / right trigger: sprint). C / B: crouch. Space / A: jump. R: the hands take the rifle off its sling, closing on it in the grips found for them, and bring it up (it then takes both arms), or put it back on the sling. Flip the direction at a sprint to see it turn around."
}
void main()
