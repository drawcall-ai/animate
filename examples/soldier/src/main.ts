import { block, flesh, handle, stage } from '@drawcall/example-stage'
import { solve } from '@drawcall/ik'
import { createSoldier } from './soldier'

const el = (id: string) => document.getElementById(id)!
const target = handle()
target.position.set(1.5, 1.3, 14)

let t = 0, aimed = true, since = -10 // aiming or lowered, handed over in 0.4 s
const aiming = (time: number) => { const x = Math.min(1, Math.max(0, (time - since) / 0.4)); return aimed ? x : 1 - x }
const { body, rifle, plan } = createSoldier(() => target.position.clone(), aiming)
flesh(body.root)
rifle.add(block([0.04, 0.07, 0.85], [0, 0.02, 0.175]), block([0.03, 0.12, 0.04], [0, -0.06, 0]))

const { scene, follow, drag } = stage(dt => {
  t += dt
  if (t > 16) { t = 0; since = -10; aimed = true; body.q.splice(0, body.q.length, ...body.neutral) } // walk the same stretch again
  const goals = plan(t), r = solve(body, goals, dt)
  follow(body.root.position)
  const missed = Math.max(0, ...r.goals.filter((_, i) => { const g = goals[i]; return 'a' in g && g.hard }).map(g => g.missedBy))
  el('hud').textContent = [
    `hard goals missed by ${missed.toExponential(1)}  ${missed > 1e-6 ? '(out of reach: closest pose)' : '(exact)'}`,
    `grips error       ${r.closureError.toExponential(1)}`,
    `Newton iterations ${r.iterations}${r.converged ? '' : ' (not converged)'}`,
    `joints on a limit ${r.limits.length}${r.limits.length ? ': ' + r.limits.join(' ') : ''}`,
  ].join('\n')
})
scene.add(body.root, target)
drag(target)

el('hint').textContent = 'A rifle gripped by both hands; one hard goal owns its pose. Drag the red aim target. The arm swing of the walk is not emitted: the planner knows the arms are busy.'
const button = document.createElement('button')
button.textContent = 'Aim / lower'
button.onclick = () => { since = t; aimed = !aimed }
el('buttons').append(button)
