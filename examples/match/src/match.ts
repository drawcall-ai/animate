// The match: the physics court, two players, and the rules that tie them together. Each frame the physics moves
// the ball, each player plans from where the ball really is, the solver poses each body, and where a sweet spot
// meets the ball at its contact time the racket sets the ball's velocity towards where the player aimed.

import { type Goal, type SolveResult, solve } from "@drawcall/ik"
import { Matrix4, Vector3 } from "three"
import { BALL, LENGTH, WIDTH, createCourt, launch } from "./court"
import { type Incoming, createPlayer } from "./player"

const STRINGS = 0.12 // m: how far from the sweet spot the ball may be and still be on the strings
export interface Contact {
  player: number
  distance: number
  hit: boolean
  why?: "unreachable" | "late" | "mistimed"
}
export interface Frame {
  goals: Goal[][]
  results: SolveResult[]
  solveMs: number[]
  contact?: Contact
  ended?: string
}

export async function createMatch(seed = 1) {
  let rnd = seed
  const random = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648
  const court = await createCourt()
  const players = [createPlayer(0, random), createPlayer(Math.PI, random)] // A on the -z side, B on the +z side
  let t = 0,
    id = 0,
    receiver = -1,
    bounced = 0,
    hits = 0,
    pause = 0.5
  const rallies: number[] = []

  /** A new rally: the ball is fed from one baseline into the other player's court, like any other shot. */
  const feed = (to: number) => {
    const from = players[1 - to].frame.localToWorld(new Vector3(0, 1, -LENGTH)),
      at = players[to].frame.localToWorld(new Vector3(2 * random() - 1, BALL, -6))
    court.ball.teleport(new Matrix4().setPosition(from))
    court.ball.setVelocity({ linear: launch(from, at), angular: new Vector3() })
    id++
    receiver = to
    bounced = 0
    hits = 0
  }
  const end = (why: string, frame: Frame) => {
    rallies.push(hits)
    pause = 1.2
    frame.ended = why
    receiver = -1
  }
  let server = 0

  return {
    court,
    players,
    rallies,
    get time() {
      return t
    },
    /** Hits so far in the rally being played. */
    get hits() {
      return hits
    },
    /** One frame of `dt` seconds. */
    step(dt: number): Frame {
      t += dt
      const frame: Frame = { goals: [], results: [], solveMs: [] }
      if (receiver < 0 && (pause -= dt) <= 0) {
        feed(server)
        server = 1 - server
      }
      const was = court.ball.getVelocity().linear.y
      court.world.update(dt)
      const ball = { position: court.ball.position.clone(), velocity: court.ball.getVelocity().linear.clone() }
      // the rules: a bounce counts for the side it is on; out, the net, or a second bounce end the rally
      const bounce = was < -0.2 && ball.velocity.y > 0 && ball.position.y < 0.3
      if (bounce && receiver >= 0) {
        const side = ball.position.z < 0 ? 0 : 1,
          out = Math.abs(ball.position.x) > WIDTH || Math.abs(ball.position.z) > LENGTH
        if (side !== receiver) end(hits ? "hit into the net or short" : "feed", frame)
        else if (out && bounced === 0) end("hit out", frame)
        else if (++bounced > 1) end("not played: it bounced twice", frame)
      }
      if (receiver >= 0 && ball.position.y < BALL + 0.01 && Math.abs(ball.velocity.y) < 0.2 && Math.hypot(ball.velocity.x, ball.velocity.z) < 0.5)
        end("the ball stopped", frame)
      players.forEach((player, i) => {
        const incoming: Incoming = { state: ball, mine: i === receiver, bounced: i === receiver ? bounced : 0, id }
        const goals = player.plan(t, dt, incoming),
          t0 = performance.now()
        frame.goals.push(goals)
        frame.results.push(solve(player.body, goals, dt))
        frame.solveMs.push(performance.now() - t0)
      })
      // contact: at the shot's time, is the ball on the strings?
      const player = receiver >= 0 ? players[receiver] : undefined,
        shot = player?.shot
      if (player && shot && !shot.done && shot.id === id && Math.abs(t - shot.time) < dt / 2) {
        shot.done = true
        const distance = player.body.positionOf(player.sweet).distanceTo(ball.position),
          r = frame.results[receiver]
        const reached = r.goals[player.names.indexOf("sweet spot")].reachable
        if (distance <= STRINGS) {
          court.ball.setVelocity({ linear: launch(ball.position, player.aim()).multiplyScalar(1 + 0.04 * (random() - 0.5)), angular: new Vector3() })
          frame.contact = { player: receiver, distance, hit: true }
          hits++
          id++
          receiver = 1 - receiver
          bounced = 0
        } else {
          frame.contact = {
            player: receiver,
            distance,
            hit: false,
            why: !reached ? "unreachable" : shot.late || player.offStance() > 0.3 ? "late" : "mistimed",
          }
          end(`missed (${frame.contact.why})`, frame)
        }
      }
      return frame
    },
  }
}
