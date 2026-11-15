# animate

Natural human motion for rigged humanoids, written as little as possible: a story states only what must hold and the body does the rest.

- `packages/animate` (`@drawcall/animate`) is the library an author imports: a `Body` on three.js that a story or a game
  drives, with its skill for writing motion. It brings together `packages/limbs` (`@drawcall/limbs`: the rig's bones and
  joints, and planning a limb's end to a place at a moment) and `packages/locomotion` (`@drawcall/locomotion`: the hips
  and the feet under them, stepping as a story or the player has him go). [ARCHITECTURE.md](ARCHITECTURE.md) has the
  boundaries.
- `packages/hand` (`@drawcall/hand`) is hand poses: named ones, and how a hand grips a mesh. Neither package depends on
  the other.
- `examples` are small Vite apps, each a story or a game on the shared mannequin, `shooter` on a soldier model rigged
  as it loads: where the two meet, a grip from `hand` handed to a `Body` as a placement and a pose.
