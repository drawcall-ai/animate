---
name: animate
description: Animate three.js humanoids procedurally with `@drawcall/animate` — a body posed every frame by one solve from that frame's goals, rigged or procedural humanoids, a locomotion planner that walks, runs and jumps them after a moving point such as a physics capsule, hands that grip meshes, and faces following the ARKit blendshape standard that show emotions, look at things and speak recorded lines in lip sync. Use when a character in three.js should stand, walk, reach, aim, swing, carry or hold something, or show emotion, make eye contact or say a line; not for playing baked animation clips or driving a face from live capture.
---

# Procedural humanoids with @drawcall/animate

Six concepts carry everything. A **body** is what is posed: a `Humanoid`, or a `Body` of your own. **Goals** are what a frame asks of it: `hard`, `soft`, `clear`, `posture` and `stay`. **Planners** turn intent and time into this frame's goals: the `LocomotionPlanner`, the `FacePlanner`, and the planners you write for a stroke, a carry or an aim. **Solve** makes one pose per frame from all the goals. **Hands** read a rig's fingers, and **grips** find how a hand holds a mesh. A **face** reads a model's ARKit blendshapes and eye bones, which the face planner acts.

## The frame loop

The solver keeps nothing but the pose, which is where the next solve starts; whatever has time in it (a swing, a fade, a reach that takes half a second) belongs to a planner. So every frame, build the whole goal list again from the planners and your own code, and solve once with the frame's real `dt`; advance every planner with that same `dt`, once per frame.

```ts
import { Humanoid, LocomotionPlanner, soft, solve, Target } from "@drawcall/animate"

const body = new Humanoid({ rig: character }) // a rigged character, or no options for the procedural one
group.add(body.root, character) // the body's root and the rig in one parent, which stays still
const locomotion = new LocomotionPlanner(body)
const look = new Target()

function frame(dt: number) {
  look.set({ quaternion: towardSomething })
  const goals = [
    // feetOfCapsule, capsuleVelocity, wantedVelocity: yours, from whatever moves the character
    ...locomotion.update(dt, { position: feetOfCapsule, velocity: capsuleVelocity, desiredVelocity: wantedVelocity }),
    soft(body.get("head"), look, 0.1),
  ]
  solve(body, goals, dt)
}
```

## A person

`new Humanoid()` builds a procedural person: bones only, with no mesh (show it with three's `SkeletonHelper` or meshes of your own on its bones) and no hands. Given a rig (bones with the VRM humanoid names in a T-pose, as `@drawcall/rig` makes them) it takes the character's proportions and carries the rig's bones, so the skinned mesh follows through the scene graph. Put `body.root` and the rigged object into the same parent, place the body with the `position` and `yaw` options rather than by moving that parent, and never animate the rig's arm, leg or trunk bones yourself: the body owns them. Joints, limits, the neutral pose and the named points are the same either way, so goals and poses carry over between the two; distances (reach, pelvis height) are each body's own, so a target placed in metres may need moving for a differently built character.

Each bone's hinges, their order, axes and signs, and the marked points are in the `Humanoid` doc comment; planners use the soles (with the heel and ball of each foot), the fists and palms, and the eyes most. A bone is a point too: `body.get("chest")`. Write a `Pose` as angles per bone name, listing only the bones the activity decides.

A rigged humanoid's fingers are not part of the body: `body.hands` reads them from the rig the first time it is asked for, and each hand holds `HandPose.relaxed` until you pose it. Never pose a rig's fingers yourself before that. For a bare hand without a body, read `new Hand(rig, side)` once, while its fingers rest.

## Goals

A goal asks that a point match a target. Both are `Object3D`s: under a bone, or under an object attached to the body, a point moves with the pose; anywhere else it is fixed in the world for the solve. Both ends may be on the body ("the left palm on the racket the right hand holds"), and both are differentiated. `body.centerOfMass` is the center of mass as a point.

What is matched is what the target carries. A plain `Object3D` (a bone, a `mark`) carries its whole frame, position and quaternion. A `Target` carries exactly what its last `set` gave it: set a position alone and the rotation is free. A velocity is in world space and is met as a difference against the pose before the solve, so it needs the frame's `dt`; given together with a position, the two must agree or they fight. A point that should be hard in position but soft in rotation needs two targets and two goals.

A hard goal is met exactly, or, out of reach, as closely as possible and reported not met; it is never traded against a soft goal. Soft goals share what is left by weight. Two hard goals on the same point in one solve throw.

Hard goals that conflict share the conflict: a hand asked beyond reach pulls hard-planted feet off their marks, so keep a hard hand within reach or make it soft. Near the edge of reach the exact pose moves fast (the trunk commits and lets go abruptly): keep hard targets off that edge, or soften them before they get there. Several hard goals on one limb can lock it against its joint limits, where the solver stays: make hard only the point that matters (a racket's sweet spot), the rest soft, and add `stay(body)`, a soft goal to stay near the current pose.

There is no built-in comfort: whatever no goal decides goes anywhere, so every frame needs a posture. A posture pulls the bones its pose lists, and the bones it leaves out are nearly free and do the work first: with `posture(body, body.uprightPose)` (trunk, head and legs listed, arms not) the arms reach before the trunk bends. A pose that never changes can be built into its goal once.

A limb passes through the trunk wherever the goals take it; `clear` goals keep it out. A `clear` goal guards only its point, not the limb between points, so give one to each point that must stay out, usually the elbow and the wrist. Weight it well above the posture (100 keeps a point within a few millimetres), and make the capsule a little bigger than the mesh it stands for.

```ts
const low = mark(body.get("pelvis"), "trunkLow", new Vector3(0, 0.05, 0)) // once
const high = mark(body.get("chest"), "trunkHigh", new Vector3(0, 0.2, 0))
const keepOut = [body.get("forearmR"), body.get("handR")].map((point) => clear(point, low, high, 0.16, 100)) // elbow and wrist: in every frame's goals
```

`body.balance()` is a soft goal putting the center of mass over the middle of the soles, horizontally. It reads where the soles are when it is made, so make it every frame, after the feet have moved; weight it up where the body must not lean out over its feet. Mass the body carries counts.

A goal has no time and no owner. To fade one, change its weight from frame to frame; to stop one, leave it out of the next list. Blend between poses with `mix`.

## On its feet

The `LocomotionPlanner` is told every frame where the body should be and how it moves, usually a physics capsule driven by input, and returns the goals for the feet, the pelvis and a posture of every bone. There are no gaits or modes: walking, running, the flight phase of a sprint, braking, turning around and stepping onto stairs all come from one rule about when a foot must leave and where it lands.

It predicts where the body will be when a swinging foot lands, and the prediction is only as good as what it is told. Pass the input's `desiredVelocity`, not only the velocity, so braking and turning are seen coming; give `acceleration` as the capsule's own and `stepHeight` as the capsule's step height, so no foot stands on what the capsule cannot climb. Pass `groundHeight` (a ray cast down) for stairs and kerbs, and `grounded: false` while the capsule is in the air. When the capsule is held back (a wall, a crowd) the planner stops believing the input and stands by itself.

Leave the feet and the pelvis to it. A planted foot is the only hard goal, pinned at the point of the foot on the ground, so nothing slides; your own goal on a foot or the pelvis throws or fights it. The pelvis follows the capsule as a soft goal of weight 100 and carries the gait (sway, bob, lean, bank), so it sits a few centimetres off the capsule on purpose: read where the body is from the body. Its posture already lists every bone it has not been told is taken, so adding `posture(body, body.uprightPose)` on top pulls the trunk and legs against its gait.

`taken` lists the parts your own planner has this frame: the locomotion planner puts no weight on them, your goals and posture decide them, and whatever is left untaken still swings and leans with the gait. `facing` turns the body to a yaw other than where it goes, for aiming while walking, strafing or backpedalling; a large change of `facing` takes steps. A jump is not a velocity: call `jump(launch)` and send the capsule up inside `launch`. `plant` asks for one foot on a place by a time (a tennis stance), and answers at once whether that fits; ask early enough for the foot to finish its step and take one more.

The gait options characterize the walker: a broad-shouldered soldier in kit swings the shoulders more and the hips less and hangs his arms out from the kit.

### Your planner beside it

A planner of your own that carries, aims or swings something takes the parts it needs and gives their goals, and the two lists are solved together. For a held thing, put one hard goal on a mark of the thing, and place its target from the motion's path (the position you give the locomotion planner, raised to the height you want), not from the pelvis, which bobs and sways with every step: the thing then glides while the body moves under it. Weigh your soft goals against the planner's scale: the pelvis at 100, a swinging foot at 30, its posture at 0.1.

```ts
const ARMS: Pose = { upperArmR: [-0.6, 0, 0], forearmR: [-1.4, 0], upperArmL: [-0.6, 0, 0], forearmL: [-1.4, 0] }
body.hold("right", tray, trayGrips.right)
body.hold("left", tray, trayGrips.left) // the second hand closes a loop
const center = mark(tray, "center")
const carried = new Target()

function frame(dt: number) {
  path.addScaledVector(velocity, dt) // where the body is to be, on the ground: yours
  const goals = locomotion.update(dt, { position: path, velocity, taken: ["armL", "armR"] })
  carried.set({ position: path.clone().add(chestHigh).addScaledVector(ahead, 0.35), quaternion: level })
  solve(body, [...goals, hard(center, carried), posture(body, ARMS)], dt)
}
```

## Holding things

A grip closes a hand's fingers onto the actual mesh, every pose checked against a person's range: your work is to state the grip, never to tune finger angles to fit an object. It is found once, when the hand takes hold, and kept as found for as long as the hand holds: hand and object are one rigid piece. Never find it again every frame, and never move the hand on the object yourself.

Without an object, a hand rests in `HandPose.relaxed` (never `flat`, which is for pushing or waving), or shows `fist` or `pointing`; for a sign no named pose comes near, start from one and change one finger.

A grip is stated by the object, whose meshes should be closed (watertight, or inside and outside are unreliable), and the `GripOptions`, whose doc comments say what each field means. How the hand is turned is yours, by `approachFrom` and `thumbToward`, and nothing else turns it; never state where a handle seats, how the fingers wrap, in what order they close, or that the thumb comes level: the grip finds those.

- With the palm, put `at` mid-way along the stretch of handle the hand covers (the fingers reach about a palm's width either side). A thing deeper than a finger is long (a board or a plate held over its edge) is hooked over instead, `at` under the palm's middle.
- `thumbToward` with the palm: a long thing lies along the palm with the thumb's side along it (a racket's head, a bottle's neck); turned a little across, it lies diagonally over the palm, which keeps the wrist straighter, and turned far the index lies along it and no longer closes round it. Without the palm, state a thin thing's broad face.
- `using`: all is a power grip (handles, bottles, a bar, a board's edge); without the thumb, a hook (a suitcase handle); `["thumb", "index"]` a pinch, with `"middle"` a three-finger hold; one finger a press (a trigger, a button), with `idlePose: HandPose.fist` so that relaxed fingers beside it do not meet the thing first. Without the palm, what is held goes on away from the hand, never back over it.

Patterns: a racket from the face of the handle the palm lies on, thumb toward the head. A pen from its side, thumb across the barrel, thumb, index and middle; the barrel goes out between thumb and index. A card off a table from its near edge, approaching from out past that edge, thumb up out of the card, thumb and index. A ball held up in the fingertips from below, thumb any way across, thumb, index and middle. A key by its bow (blade along -y, 3 mm thick in z): `at` the bow's middle, from +y, thumb toward +z, thumb and index. A button from the side it faces, the index alone.

A grip `on` an earlier one of the same object keeps the hand where that one has it, and only what is `using` moves. A finger taking part alone goes to `at` as far as it reaches from where the first grip put its knuckle, so whether it gets there is the first grip's doing: `describeGrip` prints how far its tip ends from the point, and more than about a centimetre means moving the first grip's `at`.

```ts
const held = grip(hand, pistol, {
  at: backStrap,
  approachFrom: right,
  thumbToward: up,
  using: ["palm", "thumb", "middle", "ring", "little"],
  idlePose: HandPose.pointing,
})
const firing = grip(hand, pistol, { at: trigger, using: ["index"], on: held })
```

Judge a grip by what its fingers do, not by its having been found: print `describeGrip(held)`, a line per part. In a grip that holds, every finger taking part is on the object, and round a thing the hand closes on (a handle, a bottle) closes round it; a press's or a pinch's fingers need only be on it; the thumb is on it, or on the fingers round a handle they cover. A finger taking part that is free short of the object, or straight along a thing the hand should close round, is the statement asking for what the hand cannot do there: move `at`, or turn `approachFrom` or `thumbToward`, before building on it, since every pose after it inherits the grip. Where it matters, look at the hand itself, in view from the palm, the back and along the object: an arm or the body in front of it hides what the fingers do. A grip never fails for an object's size or shape: where the hand cannot close as asked it gives the nearest grip, clear of the object, and `describeGrip` says how far each part is off and what stopped it.

`body.hold(side, object, gripOptions)` takes hold and keeps it: it finds the grip, poses the fingers, and attaches the object at the hand bone's place on it. From then on marks on the object are points of the body, and the object's `userData.mass` (kg) counts for balance. Holding with the second hand what the first holds closes a loop that every solve keeps exactly, a rifle or a two-handed backhand; an object hanging on the body by a mark of its own (a sling) goes into the hand. `body.release(side, object)` lets go with one hand; an object nothing holds any more stays where it is in the world.

```ts
body.hold("right", racket, { at: new Vector3(), approachFrom: new Vector3(0, 0, -1), thumbToward: new Vector3(0, 1, 0) })
const sweet = mark(racket, "sweet", new Vector3(0, 0, 0.5)) // a point on the body from now on: hard(sweet, ballTarget) swings it
```

To reach for an object first, find its grip without holding, make the hand bone's place on it a soft goal while the fingers close, and hold with that grip when the hand is there:

```ts
const found = grip(body.hands.left, rifle, handguardGrip)
const seat = mark(rifle, "seatL", found.position, found.quaternion)
// every frame while reaching, u going from 0 to 1:
body.hands.left.setPose(mix(HandPose.relaxed, found.pose, u))
goals.push(soft(body.hands.left.bone, seat, 40 * u))
if (u === 1 && body.positionOf(body.hands.left.bone).distanceTo(body.positionOf(seat)) < 0.01) body.hold("left", rifle, found)
```

## A face

A `Face` is a model's face as the ARKit standard has it: the 52 blendshapes as morph targets on whatever meshes carry them (face, teeth, tongue each with their own), and the eyes as `LeftEye` and `RightEye` bones resting in the face's frame. Any face following that standard works, a face rigged by `@drawcall/rig` among them; morph targets of other names are left alone, and a face without eye bones looks ahead. Make one `Face` per model and keep it: a `Face` made after its eyes have turned takes that turn as their rest.

The `FacePlanner` acts it. Every frame tell it the emotion to show, how strongly, and what to look at, and it sets the blendshapes and eyes itself: blinks, saccades, a little sway, and a change of emotion blended on springs, never jumping. So pass the emotion every frame as data and change it whenever the story does; do not fade it yourself. Given the humanoid, it also returns a goal for the neck and head, which turn part of the way to what the eyes look at and act on top (nods, tilts, the emotion's carriage): take the `"head"` from the locomotion planner and leave both lists to one solve. The face planner owns the face from its first update: drive the blendshapes yourself with `face.set` only where no planner runs.

```ts
const body = new Humanoid({ rig: character })
const face = new Face(character)
const locomotion = new LocomotionPlanner(body)
const acting = new FacePlanner(face, body)

function frame(dt: number) {
  const goals = [
    ...locomotion.update(dt, { position, velocity, taken: ["head"] }),
    ...acting.update(dt, { emotion: "happy", intensity: 0.7, lookAt: camera.position }),
  ]
  solve(body, goals, dt)
}
```

### Saying a line

A line is a recording and what is said in it, timed word by word and phone by phone. `createSpeech` measures it from the decoded sound (a Web Audio `AudioBuffer`) and a transcript; words that come without phones are looked up in the CMU pronouncing dictionary, numbers spelled out. Exact phone timing makes the lip sync: in a Vite app, time each line with `CachedSpeechAlignmentLoader`, whose forced alignment runs in Node through the `@drawcall/cache` Vite plugin (`cache()` from `@drawcall/cache/vite`, with the optional peers `@huggingface/transformers`, `@audio/decode` and `@audio/resample-sinc` installed for it) while browsers only read the cached result. Write each load literally, with the recording's public path and its text word for word, so the plugin finds it.

```ts
const transcript = await new CachedSpeechAlignmentLoader().loadAsync({ audio: "/speech/hello.mp3", text: "Hello there, it's good to see you." })
const speech = await createSpeech(buffer, transcript)
```

`acting.speak(speech, { phrases, heard })` says it from then on, in the emotion each update gives, and `acting.speaking` stays true until it is over. Start the sound in the same moment, and pass `heard`, the time into the recording the listener hears as the frame shows, read from the audio clock, less its latency, plus the two refreshes before the frame being drawn reaches the screen: `() => context.currentTime - startedAt - (context.outputLatency || 0) - context.baseLatency + 2 * dt`, with `dt` the last frame's (`outputLatency` is undefined in some browsers). Without it the line runs on the frames' `dt`, which falls behind the sound whenever frames stall.

`phrases` direct the line; a phrase's emotion overrides the one `update` gives. Their word indices count into `speech.words`, which drops what is not spoken (a lone dash), so count them after `createSpeech`. Check phrases loaded as JSON with `isPhrases`.

## Over time

Plan from the current state: `body.positionOf`, `quaternionOf` and `velocityOf` read the pose the last solve left, for any point including `body.centerOfMass`, and `velocityOf` is that solve's motion over its `dt`. To arrive somewhere at a given time with a given velocity and stay smooth whatever happens on the way, build a `curveTo` from the current state every frame and give the target its value one frame ahead:

```ts
const curve = curveTo(body.positionOf(sweet), body.velocityOf(sweet), contact, through, contactTime - t)
const next = curve(dt).position
sweetTarget.set({ position: next, velocity: next.clone().sub(body.positionOf(sweet)).divideScalar(dt) })
```

`loopingCurve` plays timed keys as a smooth repeating curve; `bump` and three's `MathUtils.smoothstep(x, 0, 1)` shape weights and blends. Judge a solve by its result: many joints on a limit usually means the goals ask for something awkward. To evaluate goals without moving the body, solve with no iterations.

## A body of your own

For something other than a person, make each jointed bone a `Joint` (a three.js `Bone` with its hinges, neutral angles and mass), hang them in one tree and build `new Body(root)`; the root slides freely and turns by its own hinges. Joints are sequences of hinges with box limits, independent unless a hinge's `range` makes its limits depend on the bone's own angles (read once per solve, so they lag a fast move by a frame). A ball joint made of hinges loses a degree of freedom where two of them line up, and there is no self-collision. Keep a limit off the straight pose of a limb: a joint resting on a limit where the limb is straight can stay there.

## Limits

- The solver returns the local optimum nearest the current pose, and soft goals are not convex, so the pose can switch to another optimum within one frame.
- Velocity is linear and one frame long, a backward difference, and there are no dynamics: the lean, sway and rise and fall of the gait are rules, not balance.
- The humanoid is an approximation: two spine joints, no scapula or toes, Euler hinges with box limits, and the knee stops just short of straight, so a stretched leg is a little bent.
- No self-collision: the upper arm goes out sideways but not in while it hangs or swings back, and crosses in front of the chest only as it is raised forward (`girth` narrows that and the elbow's fold); a hand goal through the trunk is still reached through it.
- A limb pressed against a `clear` goal's capsule while the hand drags it across can snap round the capsule within a frame: route the hand, or raise the elbow by the posture, so that the limb goes round in time.
- The feet stand on level treads only, at the height the ray finds; slopes are not looked at, and a landing from the air is predicted for the height it left from.
- Under the hardest input (turning around at a sprint, reversing every half second, running onto stairs) a knee can still turn sharply within a frame a few times a minute; steady gaits are smooth.
- A leg cannot be taken (no kicks), and strafing and backpedalling have no look of their own beyond `facing`.
- A face's eyes turn by their bones only, never by the `eyeLook` blendshapes, and are aimed from the head as the last solve left it, a frame behind a head that turns fast.
- Speech is English: phones are ARPAbet, from the CMU dictionary or an English aligner.
- A ball bigger than the hand spans is not held across: the palm and fingers lie on it and the thumb rests beside them. From above, a lever's stem can stand in the way of the fingers closing round its arm.
