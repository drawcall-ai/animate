import {
  CachedSpeechAlignmentLoader,
  createSpeech,
  type Emotion,
  EMOTIONS,
  Face,
  FacePlanner,
  Humanoid,
  isPhrases,
  LocomotionPlanner,
  solve,
} from "@drawcall/animate"
import { wrinkles } from "@drawcall/rig"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SkinnedMesh, Timer, Vector3, WebGPURenderer } from "three/webgpu"
import { jeanPhil } from "./jean-phil"

// Jean Phil, his face rigged by @drawcall/rig, stands as a humanoid of @drawcall/animate and looks at the camera in the emotion
// picked, and says the line picked when Play is pressed (public/speech/<line>.mp3, directed by <line>.phrases.json), its words and
// phones timed by forced alignment, which the cache plugin runs in Node.

// one literal load per line, so that the cache plugin aligns each
const alignments = new CachedSpeechAlignmentLoader()
const ALIGNED = {
  happy: () =>
    alignments.loadAsync({ audio: "/speech/happy.mp3", text: "Oh, this is wonderful news! You actually did it! I knew you could. I always, always knew it!" }),
  sad: () =>
    alignments.loadAsync({
      audio: "/speech/sad.mp3",
      text: "I waited for her at the station all evening. She never came. I suppose I always knew she wouldn't.",
    }),
  angry: () =>
    alignments.loadAsync({ audio: "/speech/angry.mp3", text: "No. Absolutely not! Who told you that you could touch my moustache? Get out. Get out, now!" }),
  scared: () =>
    alignments.loadAsync({
      audio: "/speech/scared.mp3",
      text: "Wait. Did you hear that? Something is moving upstairs. Please, please tell me you locked the door.",
    }),
  disgust: () =>
    alignments.loadAsync({ audio: "/speech/disgust.mp3", text: "Ugh. What is that smell? Oh no, no, no. Is that... cheese? Take it away. That is revolting." }),
  surprised: () =>
    alignments.loadAsync({
      audio: "/speech/surprised.mp3",
      text: "What?! You are kidding me! He actually said yes? After all these years? I cannot believe it!",
    }),
}
type LineName = keyof typeof ALIGNED
const isLine = (name: string): name is LineName => Object.hasOwn(ALIGNED, name)
const isEmotion = (name: string): name is Emotion => EMOTIONS.some((emotion) => emotion === name)

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`the page has no ${type.name} #${id}`)
  return found
}
const play = element("play", HTMLButtonElement),
  linePicker = element("line", HTMLSelectElement),
  emotionPicker = element("emotion", HTMLSelectElement)
for (const name of Object.keys(ALIGNED)) linePicker.add(new Option(`line: ${name}`, name))
for (const name of EMOTIONS) emotionPicker.add(new Option(`feeling: ${name}`, name))
// what fails to load says so on the page, not only in the console
const failed = (error: unknown) => (play.textContent = error instanceof Error ? error.message : String(error))
addEventListener("error", (event) => failed(event.error))
addEventListener("unhandledrejection", (event) => failed(event.reason))
element("hint", HTMLDivElement).textContent =
  "Jean Phil looks at you in the feeling picked, blinking and glancing about; Play has him say the line picked, his mouth from its phones, the line's phrases directing his emotion, brows, head and glances. Drag to look around him."

const renderer = new WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.body.append(renderer.domElement)
const scene = new Scene()
scene.background = new Color(0x14171c)
const key = new DirectionalLight(0xffffff, 1.8)
key.position.set(1, 2.5, 2)
scene.add(new HemisphereLight(0xffffff, 0x334455, 1.8), key)
const camera = new PerspectiveCamera(24, 1, 0.05, 50)
camera.position.set(0.25, 1.65, 1.3)
const orbit = new OrbitControls(camera, renderer.domElement)
orbit.target.set(0, 1.6, 0)
orbit.enableDamping = true
const resize = () => {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener("resize", resize)
resize()

const fetched = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response
}
const context = new AudioContext()
/** a line ready to say: its sound, its speech and its direction */
const lineOf = async (name: LineName) => {
  const [buffer, transcript, phrases] = await Promise.all([
    fetched(`/speech/${name}.mp3`).then(async (response) => context.decodeAudioData(await response.arrayBuffer())),
    ALIGNED[name](),
    fetched(`/speech/${name}.phrases.json`).then((response): Promise<unknown> => response.json()),
  ])
  if (!isPhrases(phrases)) throw new Error(`/speech/${name}.phrases.json holds no phrases`)
  return { buffer, phrases, speech: await createSpeech(buffer, transcript) }
}

const [rig] = await Promise.all([jeanPhil(), renderer.init()])
await wrinkles(rig.object)
// a body takes the bones anywhere, while a skinned mesh's bounds stay where it was bound: never cull it on those
rig.object.traverse((o) => {
  if (o instanceof SkinnedMesh) o.frustumCulled = false
})
const body = new Humanoid({ rig: rig.object })
const face = new Face(rig.object)
scene.add(body.root, rig.object)
const locomotion = new LocomotionPlanner(body)
const acting = new FacePlanner(face, body)
const lines = new Map(
  await Promise.all(
    Object.keys(ALIGNED)
      .filter(isLine)
      .map(async (name) => [name, await lineOf(name)] as const),
  ),
)

let dt = 0
/** the line's sound playing, if any, stopped as the next starts */
let playing: AudioBufferSourceNode | undefined
play.addEventListener("click", async () => {
  await context.resume()
  const line = isLine(linePicker.value) && lines.get(linePicker.value)
  if (!line) throw new Error(`no line "${linePicker.value}" was loaded`)
  playing?.stop()
  const source = (playing = context.createBufferSource())
  source.buffer = line.buffer
  source.connect(context.destination)
  const startedAt = context.currentTime
  source.start(startedAt)
  // what is heard as the frame being drawn reaches the screen: the time since the sound started, less the output latency, two
  // refreshes on
  acting.speak(line.speech, {
    phrases: line.phrases,
    heard: () => context.currentTime - startedAt - (context.outputLatency || 0) - context.baseLatency + 2 * dt,
  })
})
play.textContent = "Play"
play.disabled = false

const here = new Vector3(),
  still = new Vector3()
const timer = new Timer()
renderer.setAnimationLoop((ms) => {
  timer.update(ms)
  dt = Math.min(0.05, timer.getDelta())
  const emotion = isEmotion(emotionPicker.value) ? emotionPicker.value : "neutral"
  // he stands where he is: the locomotion planner keeps him on his feet, the face planner has his head
  const goals = [...locomotion.update(dt, { position: here, velocity: still, taken: ["head"] }), ...acting.update(dt, { emotion, lookAt: camera.position })]
  solve(body, goals, dt)
  orbit.update()
  renderer.render(scene, camera)
})
