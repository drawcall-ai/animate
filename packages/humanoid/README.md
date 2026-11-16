# @drawcall/humanoid

A humanoid for [`@drawcall/ik`](../ik): the skeleton with its joint limits, the rest pose, a balance goal and named points. The solver knows nothing of it.

```ts
import { balance, createHumanoid, upright } from "@drawcall/humanoid"
import { hard, posture, solve } from "@drawcall/ik"

const body = createHumanoid() // 1.75 m, 70 kg, 48 degrees of freedom; body.root goes into the scene
solve(body, [hard(body.get("soleL"), leftFoot), hard(body.get("soleR"), rightFoot), posture(body, upright(body)), balance(body)], dt)
```

- **Bones**: `pelvis` (the root), `spine`, `chest`, `neck`, `head`, and per side (`L` / `R`) `shoulder`, `upperArm`, `forearm`, `hand`, `thigh`, `shin`, `foot`. In the zero pose every bone's axes are the world's (+X left, +Y up, +Z forward), standing with the arms hanging, so a joint angle means the same on every bone: +X on the spine bends forward, -X on a thigh or upper arm swings it forward.
- **Points**: `eyes`, and per side `sole` (with `heel` and `ball` behind and ahead of it), `fist`, `palm`. A bone is a point too (`body.get("chest")`).
- `upright(body)`: trunk, head and legs in the neutral pose, the arms left out so that they are free to work.
- `balance(body, weight?)`: this frame's soft goal "centre of mass over the middle of the soles". Static: no support polygon, no dynamics.
- `createHumanoid({ girth })` narrows two limits as a stand-in for a bigger trunk; there is no self-collision.

## A rigged character

`createHumanoid({ skeleton })` takes a rigged skeleton with the VRM humanoid bone names in a T-pose (what [`@drawcall/rig`](https://github.com/drawcall-ai/rig) makes of a model): the body gets its proportions, and the rig's bones are hung on the body's, so the skinned mesh follows through the scene graph. Joints, limits, neutral pose and points are the same, so everything written for the procedural humanoid runs on the character. Put `body.root` and the rigged object into the same parent. The match example plays with two such characters.

## Limits

An approximation, not anatomy: two spine joints, no scapula, fingers or toes, ranges from typical values. The upper arm goes out sideways but not in while it hangs or is swung back (the trunk is there); it can cross in front of the chest only as it is raised forward, fully from 70 degrees. The knee stops 0.06 rad short of straight, because the solver can stay on a limit that is a straight limb.
