# @drawcall/animate

Procedural motion for three.js characters and creatures rigged with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig), without animation clips or runtime ML. Bodies stand, walk and look around; your timeline tells them where to walk, look, reach, grab and carry, and a person's fingers close round what its hands hold. They can also follow player input or tracked head and hand targets.

Install with `pnpm add @drawcall/animate @drawcall/rig @pmndrs/timeline three`.

The shipped [animate skill](skills/animate/SKILL.md) includes a runnable example, skeletons and authoring patterns. Import bodies, verbs and custom-species helpers from `@drawcall/animate`.

Hair and tails can swing through their existing bones:

```ts
const fighter = {
  ...humanoid(skeleton),
  springs: { braid: { stiffness: 18, damping: 0.55 } },
};
const body = new Body(fighter, { model });
body.update(dt);
```

Settings apply to the whole hierarchy below the named root. Bone lengths stay fixed; gravity and inertia produce the motion. This is spring-bone animation without collision, with no physics-engine dependency.
