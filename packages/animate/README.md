# @drawcall/animate

Procedural motion for three.js characters and creatures, bare skeletons or meshes skinned with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig), without animation clips or runtime ML. Bodies stand, walk and look around; your timeline tells them where to walk, look, reach, grab and carry, and a person's fingers close round what its hands hold. They can also follow player input or tracked head and hand targets.

Install with `pnpm add @drawcall/animate @pmndrs/timeline three`, and `@drawcall/rig` to skin a mesh.

The shipped [animate skill](skills/animate/SKILL.md) includes a runnable example, skeletons and authoring patterns. Import bodies and verbs from `@drawcall/animate`, what a custom creature takes from `@drawcall/animate/species`, and what a body your app poses itself takes from `@drawcall/animate/puppet`.
