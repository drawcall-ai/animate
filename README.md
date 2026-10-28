# animate

Procedural motion for three.js characters and creatures, without animation clips or runtime ML. Rig a skeleton with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig), create a body, and run stories with verbs such as walk, look, reach, grab and carry.

Install: `pnpm add @drawcall/animate @drawcall/rig @pmndrs/timeline three`. Start with the [package README](packages/animate/README.md) and [animate skill](packages/animate/skills/animate/SKILL.md).

Run `pnpm install --frozen-lockfile`, then `pnpm dev` for the viewer. pnpm pins Node 22.18.0. Use `pnpm check` for CI checks, `pnpm test:seeds` for seeded motion checks, `pnpm viewer:check` for soldier playback in Chromium, and `pnpm bench` for efficiency.
