# animate-2d

Human motion for three.js, written down as what the body does.

A `Body` is a person as joints that turn. A motion is a story that says what must hold: where a foot, a hand or the hips are to be, and how they are moving there. The rest comes from the body:

- **Every part has a strength.** It takes its time when there is time, draws back first if it has to arrive fast, and swings on afterwards.
- **Only the ground pushes.** The hips are given a place to go and a speed to go at, and speed up and slow down only while a foot is on the ground: with none down they go on as they are going, keeping their height between strides. The feet step under them, a stride on from the last footfall, further ahead of the hips the harder they are braked, and he sinks and leans into it. At a walk a foot is always down, at a run both are in the air between strides, and off the ground he flies as he was going.
- **Joints turn only as far as joints do.**
- **What is not written reacts.** The strides come out even onto a foot that is to be planted, and he leaps onto it off a foot that is to kick; the trunk leans into a push, against a leg swung out, and swings into a fast hand; it bends, with the hips coming down, for a hand that would not reach otherwise; the arms swing against the legs; the pelvis turns with the feet, a little in a stride and side-on between feet the story has put apart.
- **Asking too much is an error** that says which part cannot do what, and what would help.

```ts
import { Body, type Story } from 'animate-2d'

function* shot(body: Body, ball: Ball): Story {
  const spot = ball.position.z
  // the left foot comes down beside the ball and a little behind it, he brakes onto it, and the right foot meets the ball
  body.run({ speed: 3.6, plant: 'left', at: spot - 0.35, arrive: 2.5 })
  const through = meeting(ball, 20, degrees(8.6))
  yield* body.foot.right.to(through.at, through)
  strike(ball, body.foot.right.value, body.foot.right.velocity)

  yield* body.stand()
}

const body = new Body()
scene.add(body)
body.play(shot(body, ball))
renderer.setAnimationLoop(() => {
  body.update(timer.getDelta())
  renderer.render(scene, camera)
})
```

`meeting`, `strike` and `degrees` are the example's own: where a foot meets the ball, what the ball does then, and degrees as radians. The strides and how they come out onto the planted foot, the moment of the strike, the leap onto the planted foot, the backswing, the lean back, the follow-through and the steps that bring him to a stand are not in the story.

## Writing a story

A story is a generator. A statement takes effect at once; `yield*` waits for the story it returns. `body.play` can be given several stories, which then go on side by side. With no story left to play he comes to a stand by himself. Moments are seconds on the body's clock, `body.time`; `yield* body.until(moment)` waits for one, `body.when(z)` tells the moment the hips come by a place, going as they are, or to rest where a walk ends, and `body.highest()` the moment he is highest in the jump he is making, or in the air, is to make next.

|                                                      |                                                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `part.to(target, { velocity, seconds })`             | be there, as soon as it can unless `seconds` are given, moving as asked                                                                                                                   |
| `foot.by(moment, place, { velocity })`, `hand.by(…)` | be there at a moment: it keeps doing what it does until it has to set off                                                                                                                 |
| `part.free()`                                        | give a part back to the body                                                                                                                                                              |
| `foot.to(place on the ground)`                       | a step: the foot comes down there and he stands between his feet, until it is freed or he is told to `stand`                                                                              |
| `hips.to(place, { speed, plant })`                   | go there at a walk and come to rest, the feet stepping under them: lower than `STAND`, he squats where he stands                                                                          |
| `body.walk(z, { speed, plant })`                     | walk to a place along z and come to rest there: on the `plant` foot, down there, the other where it was                                                                                   |
| `body.run({ speed, at, plant, arrive, push })`       | run to where a foot is planted, braking onto it if he is to arrive slower; over when he is over it; stated in the air, he lands running                                                   |
| `body.jump(place)`                                   | jump for the hips to be at that place at the top: off the footfall a run or a walk he is on ends at, the drop made on the way in, or standing, at once; in the air, once he has come down |
| `body.stand()`                                       | let everything go and come to a stand, out of whatever he is doing                                                                                                                        |

Places are `{ x, y, z }` in metres (a three.js `Vector3` will do) in the body's own frame: y up, his left at +x, and he faces +z and travels along z only; put the `Body` anywhere in a scene. Standing, the hips are `STAND` high and an ankle `SIZE.ankle` above the ground it stands on; a leg is 0.88 m long from hip to ankle and an arm 0.61 m from shoulder to wrist (`SIZE`). `foot.anchor` is where the ground holds a foot, if it does, and `body.playing` whether a story still is. A foot or a hand is planned when it is sent: out of reach of where it is sent, it is there at the first moment the body, going as it is, brings it near enough, and if that never comes it is an error at the statement. In the air both feet are spare, for as long as he is: a foot that is to arrive there leaves the ground no sooner than his last stride is made. A walk or a run stated in the air he lands in, on the foot that has been off the ground longer, the other stepping on. For a hand sent lower than it reaches he bends, and comes down as far as is still needed, in time for the moment and no sooner (going along, no lower than a lunge: lower he gets only standing with his feet together, and he comes up again before he steps off), and for a foot sent further along the ground than he stands the hips come down. Sent to rest somewhere, a hand or a foot stays at that place, whatever the rest of him does, until it is sent elsewhere or let `free`; one he takes out of reach of it is an error. A foot or a hand can instead be sent to a place carried with the body, counted from its hip or shoulder, where it then stays; the velocity it arrives with is always how it is moving in the scene: `hand.to(place, { carried: true })`. The trunk, the head, the arms and forearms (`body.trunk`, `body.head`, `body.arm.left`, `body.forearm.left`) are sent to rotations, `{ x, y, z }` in rad about those axes, against what each hangs on: x leans the trunk forward and swings an arm back. With `seconds`, a foot or a hand sets off at once, or as soon as what it was sent before is done, and takes that long; without, it takes its time. He never turns round: what is behind him he walks to backwards. A walk that ends on a `plant` foot has its strides come out even onto it, and he stays on it, the other foot where it was, until he is sent on, a foot is let `free` or he is told to `stand`; a foot or a hand that arrives moving swings out, comes round, and is the body's again. What the story has otherwise sent stays the story's until it is let `free`; what it is sent to next it goes on to when that has to set off, holding the first until then. What cannot be done is an error at the statement where that can be told then, and otherwise when it shows: a part pushed more than twice as hard as it is strong, a place out of reach, a joint that does not turn that far, a hand or a foot that was to stay somewhere and is taken out of reach.

He walks at up to 2.5 m/s and runs at up to 10; the hips go from 0.30 m up to `STAND`, and no lower than 0.7 m sent along at a walk. Low, they ride back behind his feet, so a squat ends with them short of the place they were sent along z. After a run he is still going: `walk` somewhere far enough for him to come to rest, or `stand()` first.

Time goes on in steps of 1/200 s, however `update` is called.

## Examples

`examples/football` is a run-up and a shot at a ball, `examples/javelin` a run-up and a javelin throw, `examples/bowling` a bowling delivery, `examples/basketball` a jump shot, `examples/shelf` a box picked up and put on a shelf, `examples/boxing` a jab and a cross at a bag, `examples/fencing` an advance, a lunge and a recovery, `examples/tennis` a forehand, `examples/volleyball` a spike, and `examples/hurdles` a sprint over two hurdles. Each is its own small Vite app that brings its prop and its story.

```sh
pnpm install
pnpm -F football dev   # or: pnpm -F javelin dev
pnpm test              # both examples, walking, running, jumping and the limits, headless
pnpm check             # types
```
