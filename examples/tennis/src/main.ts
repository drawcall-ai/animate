import { PROP, block, flesh, handle, stage } from '@drawcall/example-stage'
import { solve } from '@drawcall/ik'
import { Mesh, TorusGeometry } from 'three'
import { type Played, STROKES, play } from './strokes'

const el = (id: string) => document.getElementById(id)!
const contact = handle() // where the ball is met: drag it and the swing bends to meet it there
const ball = handle(0xd8e021, 0.033)
let played: Played | undefined, t = 0

const { scene, drag } = stage(dt => {
  if (!played) return
  t += dt
  const goals = played.plan(t), r = solve(played.body, goals, dt)
  ball.position.copy(played.ball(t)) // the ball is not the solver's business; it is only drawn
  ball.visible = Math.abs(ball.position.z) < 14
  const missed = Math.max(0, ...r.goals.filter((_, i) => { const g = goals[i]; return 'a' in g && g.hard }).map(g => g.missedBy))
  el('hud').textContent = [
    `hard goals missed by ${missed.toExponential(1)}  ${missed > 1e-6 ? '(out of reach: closest pose)' : '(exact)'}`,
    `Newton iterations ${r.iterations}${r.converged ? '' : ' (not converged)'}`,
    `joints on a limit ${r.limits.length}${r.limits.length ? ': ' + r.limits.join(' ') : ''}`,
  ].join('\n')
})
scene.add(contact, ball)
drag(contact)

function start(index: number) {
  if (played) scene.remove(played.body.root)
  const stroke = STROKES[index]
  played = play(stroke, () => contact.position.clone())
  contact.position.copy(played.nominal)
  flesh(played.body.root)
  const head = new Mesh(new TorusGeometry(0.13, 0.012, 8, 32), PROP)
  head.position.set(0, 0.5, 0)
  played.racket.add(block([0.025, 0.36, 0.025], [0, 0.18, 0]), head)
  scene.add(played.body.root)
  t = 0
  el('hint').textContent = `${stroke.name}, about a third of real speed. The racket's sweet spot meets the ball exactly at the red point; drag it and the swing bends to meet it there.`
  document.querySelectorAll('#buttons button').forEach((b, i) => b.classList.toggle('on', i === index))
}
STROKES.forEach((stroke, i) => {
  const button = document.createElement('button')
  button.textContent = stroke.name
  button.onclick = () => start(i)
  el('buttons').append(button)
})
start(0)
