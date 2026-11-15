# Procedural animation as practised in the game industry (landmark systems to November 2026)

Scope note for the report writer: research was done on 2026-11-12. Several primary sources are video-only (GDC talks) or were unreachable (chrishecker.com down, aigamedev.com and letsbuild.gg not resolving, Epic's narrative doc pages returned empty bodies, GDC schedule and Yahoo returned 403). Where I could not verify a detail in text this session, it is in **Gaps**, not in Cited Findings, even when it is widely repeated. Status labels used below: **HISTORICAL** (no longer sold/developed), **CURRENT** (in use or maintained as of 2026).

---

## 1. Active ragdolls and physically-driven characters: how they stay upright and what they cheat

### Takeaway
Every shipped physically-driven character I could source keeps itself upright with explicit non-physical help: external "standing" forces on torso/head, foot-positioning forces, pinning to an animated target, or (in the 2025-26 learned case) "magic forces" that catch the character when it starts to fall. Pure torque-only balance is a research result, not shipping practice; developers repeatedly describe the approach as engineering-heavy, unpredictable, and expensive to tune.

### Cited Findings

**Landfall: TABS, Stick Fight, Totally Accurate Battlegrounds (2016-2021, CURRENT as shipped games; best-documented indie system)**
- Landfall's physics animation exists because the studio had no animator and substituted physics-driven motion for keyframes; the workflow is repeated tuning in Unity. — [Game Developer, 15 Oct 2018](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Standing handler: measures distance from head to floor and pushes **up on the torso and head** when the character is able to stand; an authored **curve maps distance (X) to force (Y)**. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Walking: TABS "adds torque to ragdoll legs using animation curves to create a basic walk cycle"; a separate **step handler** decides when a step is finished and when the next may begin. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Balance, Wilhelm Nylund: "The balance script adds force to the legs and feet to try to keep them in position to help support the body." If **both feet are ahead of the centre of mass, the balance script moves one foot back**. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Architecture lesson: this was the third iteration. The earlier monolithic `PhysicsAnimation.cs` handled upright posture, ground checks and leg rotation together; the rewrite split these into independent handlers ("each of these are their own scripts that you can pick and choose from"). Stick Fight snakes reuse the movement, gravity and rotation handlers but omit the standing handler. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- All TABS humanoids share one code base; units differ mainly in their attack state. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Limit of the approach: TABS's code would be unplayable in first person (the view would bounce and spin), so Totally Accurate Battlegrounds needed a new system. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)

**NaturalMotion Euphoria / Dynamic Motion Synthesis (2006-2018 in shipped titles; licensing HISTORICAL, lives on inside Rockstar's RAGE)**
- Euphoria is middleware built on Dynamic Motion Synthesis, described by NaturalMotion as "based on a full simulation of the 3D character, including body, muscles and motor [nervous system]"; it synthesises reactions at runtime rather than playing clips, so outcomes differ between replays. — [Wikipedia, citing NaturalMotion FAQ](https://en.wikipedia.org/wiki/Euphoria_(software))
- Timeline: announced 2006 (LucasArts Indiana Jones, cancelled); Rockstar partnership Feb 2007; GTA IV confirmed as first Rockstar title June 2007; Backbreaker announced Aug 2007; Max Payne 3 confirmed 2009; also Star Wars: The Force Unleashed I/II, Red Dead Redemption, GTA V, Red Dead Redemption 2; Clumsy Ninja first on mobile. — [Wikipedia](https://en.wikipedia.org/wiki/Euphoria_(software))
- Euphoria is integrated into the source of Rockstar's RAGE engine; NaturalMotion announced the end of licensing in 2017 to focus on mobile games. — [Wikipedia, citing Eurogamer and PocketGamer.biz 2017](https://en.wikipedia.org/wiki/Euphoria_(software))
- 2007 press positioning: synthesises animation "on the fly" using simulation of motor control, muscles and biomechanics; based on Oxford University research on control of body movement. — [AWN press coverage](https://www.awn.com/news/naturalmotion-partners-rockstar-games)
- Reported in-game structure (secondary/modder source, not first-party): in GTA IV the character is pushed off balance, stumbles trying to regain balance, and once balance is regained **switches back to motion-capture animation**; the shipped behaviour is stiffer and shorter than the tech demos. — [ModDB, "Why we are not using Euphoria"](https://www.moddb.com/news/why-we-are-not-using-euphoria/)

**No Brakes Games: Human: Fall Flat (2016, CURRENT as a live game)**
- The player character "consists of many physics driven body parts" constantly colliding with the level; mobile port simplified colliders and reduced calculation frequency. — [Game Developer, mobile optimisation post](https://www.gamedeveloper.com/design/optimizing-human-fall-flat-for-mobile-devices)
- Tomas Sakalauskas on the genre (Feb 2021): "physics can be a bit unpredictable at times"; "I think it's too risky for big games to do it"; physics-reliant AAA "could go totally sideways"; some of his own physics prototypes were discarded because "it's too difficult to get the result that you want"; "it's totally doable, but it takes a lot of energy to do." — [TheGamer, 11 Feb 2021](https://www.thegamer.com/risky-human-fall-flat-big-games-simple-physics/)

**Boneloaf: Gang Beasts (early access 2014, 1.0 2017, CURRENT as a live game)**
- Boneloaf's prototypes since 2011 were built on "variations of a custom physics manipulating character pose and movement system"; Michael Brown said the physics had to function a certain way and that dictated the character design. — [MCV/Develop interview](https://mcvuk.com/?p=215072)

**Bare Mettle: Exanima (early access 2015, still in active development Nov 2026, CURRENT)**
- Madoc Evans (developer, forum post): procedurally generating animation on the fly capable of performing an action "under any condition is simply not possible"; the system instead relies on natural constant transition between authored and physical motion. — [Bare Mettle forums](https://www.baremettle.com/forums/index.php?threads/about-the-parry-mechanic.5293/)
- Bare Mettle's November 2026 Coffee Diary reports an ongoing robustness trade-off: "because we had to make collisions even more rigid, and keep making characters stronger, this is an even bigger problem" (search-snippet quote; page body not retrievable). — [Steam, Exanima Coffee Diary November 2026](https://steamcommunity.com/games/362490/announcements/detail/707787161892555241)

**Embark Studios: ARC Raiders (shipped Oct 2025, CURRENT; first clearly documented shipped learned physics locomotion in a major title)**
- Legged enemies are physical bodies in the simulation that must "move and balance"; reinforcement learning is used **only for legged locomotion** (foot placement and movement). Drones use traditional control; goals come from behaviour trees / utility AI. — [80.lv interview with Martin Singh-Blom, 31 Mar 2026](https://80.lv/articles/inside-the-magic-of-machine-learning-that-powers-enemy-ai-in-arc-raiders)
- Explicit cheat forces: real robots "can't have magic forces that lift them up when they start falling, but we can." — [80.lv](https://80.lv/articles/inside-the-magic-of-machine-learning-that-powers-enemy-ai-in-arc-raiders)
- Training is offline only, in controlled scenarios with randomised object placement; adversarial motion priors substantially improved motion quality; perception is a ground-height grid, not cameras (first version failed indoors). — [80.lv](https://80.lv/articles/inside-the-magic-of-machine-learning-that-powers-enemy-ai-in-arc-raiders)
- Cost: five to ten people for years, and the system "was nearly cut several times" for failing the quality bar. — [80.lv](https://80.lv/articles/inside-the-magic-of-machine-learning-that-powers-enemy-ai-in-arc-raiders)
- Talk exists: "Learning to Move: Physics-Based Enemy Locomotion in 'ARC Raiders'", Martin Singh-Blom, GDC 2026 (11 Mar 2026), Machine Learning and Animation Summits. — [GDC schedule](https://schedule.gdconf.com/session/learning-to-move-physics-based-enemy-locomotion-in-arc-raiders/917319)

**General pattern**
- Wikipedia's summary of the generic "active ragdoll" technique: play a pre-made animation but constrain its output to what a physical system would allow. — [Wikipedia, Ragdoll physics](https://en.wikipedia.org/wiki/Ragdoll_physics)

### Inferences
- The Landfall recipe maps almost one-to-one onto a 2D point-mass stick figure and is the most transferable concrete design found: (a) a height-indexed upward support force authored as a curve, gated by "can stand"; (b) curve-driven leg torques as the gait; (c) a step state machine with explicit "step finished / next step allowed" conditions; (d) a rule that repositions a foot when both feet are on the same side of the centre of mass. The author's "balance servo" and "scripted foot placement" are the same ideas; the notable difference is that Landfall separates them into independently removable handlers.
- Shipped systems treat falling as a *state transition* (physics takes over, then hand back to animation) rather than something the balance controller must always prevent. Even the 2025 learned controller keeps a cheat force for the start of a fall.
- "Make the character stronger" is the usual response to instability and has a cost: Exanima's 2026 note links stronger characters and more rigid collisions to new problems. Strength/stiffness is a tuning axis with failure modes at both ends.
- Human: Fall Flat, Gang Beasts and TABS all made wobbliness part of the aesthetic. For a library whose stories include a football shot or javelin throw, the visual target is closer to Euphoria/Exanima (physically plausible, authored intent), which is exactly where practitioners report the highest tuning cost.

### Gaps
- No first-party technical description found for Gang Beasts, Human: Fall Flat, Party Animals or QWOP/Toribash balance internals. Community recreations (Unity ConfigurableJoint with angular drive springs, hips free, upright torque) exist on forums but are not the developers' own accounts, so they are not cited as fact.
- Euphoria's internal behaviour set (balancer, stagger, brace, catch-fall, how NM messages are driven from RAGE) is not documented in any first-party source I could reach; only press releases and modder accounts.
- Whether Rockstar's GTA VI still uses Euphoria-derived code is unconfirmed by Rockstar.
- Exanima's motor model is not described in any retrievable primary text; the November 2026 Coffee Diary body could not be fetched (only a snippet).
- The ARC Raiders GDC 2026 talk content (reward design, how the "magic" force is penalised in the reward, network size, runtime cost) is reported only in secondary press; one outlet says the reward penalises over-reliance on the magic forces, but I could not open the article (403) to verify.
- No information found on Party Animals (2023) internals.

---

## 2. Procedural locomotion in indie classics and landmark titles (Overgrowth, Rain World, Spore, Team Ico, leg-stepping tutorials)

### Takeaway
The recurring indie pattern is: simulate a very simple physical proxy first (a capsule, sphere or two linked chunks) for responsiveness, then draw or pose the visible body procedurally on top from a handful of key poses, with phase driven by movement and all transitions smoothed by springs. Foot stepping is a small set of rules: choose the landing point at lift-off, predict ahead by velocity, trigger on a distance threshold, pin the planted foot, and never step all legs at once.

### Cited Findings

**Wolfire / David Rosen: Overgrowth, Receiver, Black Shades (talk GDC 2014; Overgrowth released 2017, open-sourced 2022; technique CURRENT and widely copied)**
- The talk "Animation Bootcamp: An Indie Approach to Procedural Animation" covers using "simple procedural techniques to achieve interactive and fluid animations using very few key frames", with examples from Overgrowth, Receiver and Black Shades. — [GDC Vault](https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach)
- Forum attendees' summaries: the character uses "only 13 keyframes in total for everything"; the responsiveness fix is "programming 'responsiveness' in his physics first and then putting animation on top instead of the other way round". (Secondhand.) — [Unity Discussions thread](https://discussions.unity.com/t/an-indie-approach-to-procedural-animation-gdc-video-talk/538228)
- A student reimplementation of the talk builds the walk from a **pass pose and a reach pose** for left and right sides, interpolating bone positions and rotations between them. — [TAMU CSC474 project](https://people.engr.tamu.edu/sueda/courses/CSC474/2016W/demos/ismithgr/index.html)
- Max Kaufmann (Solar Ash) calls it "the best presentation on this subject" and describes the method as "generating animations from a small set of key-poses". — [Little Polygon blog, 29 Apr 2023](https://blog.littlepolygon.com/posts/loco1/)

**Little Polygon / Solar Ash-derived locomotion recipe (2023, CURRENT; concrete numbers)**
- Walk mental model from Richard Williams: lean forward to start a fall, throw a foot ahead to catch yourself (contact), push up while lifting the back foot (passing), repeat. — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)
- Phase advances with normalised speed: `HipPhase += HipPhaseSpeed * NormalizedSpeed * dt`, `NormalizedSpeed = min(1, |v| / MovementSpeed)`. — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)
- Hip bob `HipOffset.Z = HipMulti * (HipBiasZ + HipOffsetZ * sin(2π·phase))` and side roll at **half frequency** `HipRoll * sin(π·phase)`; amplitude itself is spring-smoothed toward stick tilt (0.5 s). — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)
- Lean: axis = up × acceleration, angle proportional to acceleration, clamped to 45°, smoothed over 0.25 s with a critically damped spring. — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)
- Critically damped spring helper uses `omega = 2 / duration`, `exp(-omega·dt)`; acceleration/deceleration friction uses a `4 / T` rule of thumb for "reaches target in T seconds". — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)
- Pipeline order: reference pose (or key pose), modify hips, then two-bone IK places feet from four inputs (left foot, right foot, hip offset, hip rotation). — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)

**Videocult: Rain World (2017; The Watcher DLC 2025; CURRENT)**
- The slugcat is physically **two spherical chunks locked at a fixed distance**, which lets it tumble and rotate; limbs and tail are **cosmetic**, drawn over that base and animated by code from player input. — [Unity blog, 25 Sep 2025](https://unity.com/blog/exploring-procedural-design-rain-world)
- Joar Jakobsson: "I never really set out to do procedural animation"; "Early on I used a mixture of classical and procedural animation, but later I gravitated more towards procedural." — [Unity blog](https://unity.com/blog/exploring-procedural-design-rain-world)
- Each creature's body shape and movement code is unique and mostly written from scratch; only base scripts (collision, health, held items, save/load) are shared. — [Unity blog](https://unity.com/blog/exploring-procedural-design-rain-world)
- The GDC 2016 Animation Bootcamp talk by Joar Jakobsson and James Therrien is free on GDC's YouTube channel and covers "what's great (and tough) about implementing procedural animation in games". — [Game Developer, 17 Jul 2017](https://www.gamedeveloper.com/art/video-animating-i-rain-world-i-and-its-many-squishy-stretchy-creatures); [video](https://www.youtube.com/watch?v=sVntwsrjNe4)

**Maxis: Spore (2008, HISTORICAL but foundational)**
- Hecker et al., "Real-time Motion Retargeting to Highly Varied User-Created Morphologies", ACM TOG 27(3), SIGGRAPH 2008: animation is authored in a **morphology-independent form**; at runtime it is specialised to a creature to produce **pose goals** fed to "a robust and efficient inverse kinematics solver". Animators use familiar posing/keyframing but against generalised body-part descriptions. — [DOI 10.1145/1360612.1360626](https://doi.org/10.1145/1360612.1360626); [project page](https://chrishecker.com/Real-time_Motion_Retargeting_to_Highly_Varied_User-Created_Morphologies)

**Team Ico / genDESIGN: Ico, Shadow of the Colossus, The Last Guardian (2001/2005/2016, HISTORICAL; rules documented by the animation director)**
- Masanobu Tanaka, CEDEC 2017: Ico used procedural animation to match feet to steps of different heights and for hand-holding; Shadow of the Colossus used it for Agro and four-legged and snake-like colossi (no further detail given). — [Tanaka CEDEC 2017 slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- The Last Guardian foot placement rules: the **landing point is chosen at the moment the foot lifts** (considering height and angle); candidate placements are **rejected** near objects, on steep inclines, or too close to walls; the landing point is **rechecked during the swing**; the swing path **blends between the shortest path and a natural walking path** before landing. — [Tanaka slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- Planted feet are **anchored to the ground** to prevent sliding; when a leg lifts, it interpolates from the shifted position back to the authored pose; each foot's displacement from its authored position feeds back into overall body posture. — [Tanaka slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- Head/neck ("Lion Dance Method"): set the head position and rotation first, then solve the neck after, replacing an earlier base-to-tip FK approach. — [Tanaka slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- Ordering principles: procedural modules run main parts to details (body, legs, head, fingers); frame pipeline is AI, animation, procedural animation, physics, fur, rendering; processing must not break authored animation and should need few assets. — [Tanaka slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- Secondary analysis: Shadow of the Colossus attaches Wander to the colossus while gripping and swings him like a pendulum; Ico joins two FK-animated characters' arms with IK plus constraints on how each accelerates. — [CritPoints, 21 Apr 2026](https://critpoints.net/2026/04/21/how-do-games-make-characters-touch-the-game-world/)

**Multi-leg ("spider") stepping rules from published implementations (2019-2026, CURRENT)**
- Step trigger by threshold: step when the distance between the predicted landing point and the current foot target exceeds a threshold, moving the foot along an arc; the landing point is the raycast hit **plus body velocity** so the foot lands ahead of the body. — [80.lv, Godot 4.5 spider locomotion](https://80.lv/articles/ik-driven-procedural-spider-locomotion-in-godot-4-5)
- Alternative trigger: a leg "wants to step" when the IK solver can no longer reach its target within tolerance; a separate manager class decides when each step is permitted (asynchronous gait). — [PhilS94 Unity Procedural IK Wall Walking Spider](https://www.Github.com/PhilS94/Unity-Procedural-IK-Wall-Walking-Spider)
- Sumo Digital's Spyder (shipped, Apple Arcade 2020) bounds foot reach by the current coxa-to-foot distance to limit hyperextension. — [Unreal Engine tech blog](https://www.unrealengine.com/en-US/tech-blog/sumo-digital-shares-how-it-created-spyder-s-sophisticated-animation-systems)
- Baby Steps (2025): feet switch between FK while lifting and IK when set down; the body follows FK until blocked, then IK, and ragdolls if pushed too far. (Secondary analysis.) — [CritPoints](https://critpoints.net/2026/04/21/how-do-games-make-characters-touch-the-game-world/)

### Inferences
- Rain World is the closest shipped analogue to the author's library in dimensionality (2D, a few point masses with distance constraints) and it makes the opposite architectural choice: the *physics body is minimal* (two chunks) and limbs are purely cosmetic followers. That removes the balance problem entirely. The author's library puts limbs in the physics, which buys physical plausibility for throws and kicks but takes on the whole active-ragdoll tuning burden described in section 1.
- "Responsiveness in the physics first, animation on top" (Rosen, per attendees) and Tanaka's "must not break the authored animation" are the same layering rule from two directions: intent and gameplay motion are decided by a simple, stable layer; procedural detail is a correction on top.
- Tanaka's foot rules are a ready-made checklist for scripted foot placement: decide the target at lift-off, validate it, re-validate mid-swing, blend swing path, pin on contact, and release with interpolation.
- Velocity-led landing prediction plus a distance threshold gives stride length that scales with speed for free; this is cheaper and more robust than authoring stride per speed.

### Gaps
- I could not verify Rosen's specific rules in a text source this session. From prior knowledge of the talk (unverified here; check against the [video](https://www.youtube.com/watch?v=LNidsMesxSE)): the walk is built from two mirrored poses with the cycle advanced by distance travelled (a "surveyor's wheel") rather than time, non-linear (cubic/spring) interpolation between poses, body lean driven by acceleration, a gravity-shaped vertical bounce, and blending from walk to run by changing stride and pose weighting. Treat as leads, not citations.
- No transcript or notes found for the Rain World GDC 2016 talk; details beyond the two-chunk body and cosmetic limbs (hand reach targets, how limbs choose grab points) are video-only.
- The Spore paper's gait/locomotion specifics were not retrievable (author's site down); only the abstract-level structure is cited.
- No first-party technical account of Shadow of the Colossus's colossus locomotion beyond one slide line. No reliable first-party material found for Sable or for Rainbow Six's animation in this pass.
- I found no source stating an explicit "opposite leg must be planted before stepping" rule in words; implementations encode it via leg groups or a step manager.

---

## 3. Inverse kinematics in production

### Takeaway
Production IK is layered and mostly simple: analytic two-bone IK for limbs after a hip adjustment, a position-based full-body solver for multi-effector cases, and foot locking as a separate concern from foot placement. IK is applied as a late correction to an authored or matched pose, and root-motion "warping" handles alignment to targets before IK cleans up contacts.

### Cited Findings
- Unreal's Full Body IK is a Control Rig node (Hierarchy > Full Body IK) with a designated root, "likely the hips or pelvis"; per-bone rotation and position stiffness run from 0 (free) to 1 (locked). — [Epic docs, Control Rig Full Body IK](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-full-body-ik-in-unreal-engine)
- The solver (PBIK) is "based on a Position Based solver at core" and solves multiple chains from one root with multiple effectors; Epic frames FBIK as a procedural adjustment tool for cases such as ground alignment and arm reaching. — [Epic API, FRigUnit_PBIK](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PBIK/FRigUnit_PBIK); [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-full-body-ik-in-unreal-engine)
- In Epic's Game Animation Sample, Leg IK "pins the feet to the IK foot bone locations", used to keep feet correct when pose warping moves them and to improve leg blending. — [Epic docs, Game Animation Sample](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)
- Motion Warping adjusts a character's **root motion** to line up with targets: notify-state windows on a montage are tagged with a Warp Target Name, and gameplay code binds that name to a location. "Skew Warp" warps root motion so the character matches the target's location and rotation at the end of the window; "Scale" scales it uniformly. Examples given: mantling (hand contact) and a punch that closes distance before the hit. — [Epic docs, Motion Warping](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-warping-in-unreal-engine)
- Common hip-then-limb ordering in indie practice: modify hips, then two-bone IK per foot. — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)
- God of War (2018) / Ragnarok hit handling (secondary analysis with linked developer video): the axe attaches by IK at the point of contact while attacker and victim each play their own recovery/hitstun, so either can be interrupted independently. — [CritPoints, 21 Apr 2026](https://critpoints.net/2026/04/21/how-do-games-make-characters-touch-the-game-world/)
- Bloodborne and later FromSoftware titles use jiggle bones on large enemies to show hit reactions even when the attack does not interrupt the enemy's animation. (Secondary analysis.) — [CritPoints](https://critpoints.net/2026/04/21/how-do-games-make-characters-touch-the-game-world/)
- In Clavet/Bergamin/Holden's optimised motion-matching pipeline the IK pass costs about 2 µs of a 12 µs per-character total (search 6, lookup 2, blending 1, IK 2, other 1). — [Ubisoft La Forge GDC 2020 slides](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/74NXgJKzhhZw5sy4XsRag8/1327abfd28611ed5fd5e66efbdfb8a17/GDC20RagdollMotionMatching4.pdf)
- A GDC 2016 Ubisoft talk exists specifically on foot IK: "Fitting the World: A Biomechanical Approach to Foot IK". — [GDC Vault](https://gdcvault.com/play/1023009/Fitting-the-World-A-Biomechanical)

### Inferences
- For a 2D, two-segment limb, analytic two-bone IK (law of cosines plus a bend-direction sign) is the whole solution; FABRIK/CCD/PBIK exist to handle long chains and multiple competing effectors that a stick figure does not have. The one multi-effector case worth borrowing from PBIK is "both feet planted plus a hand target", which in 2D reduces to choosing the hip position first, then solving three independent two-bone chains.
- Motion warping is directly relevant to scripted "stories": author the kick or throw once relative to a nominal contact point, declare a warp window ending at the contact frame, and warp root translation (and facing) so contact coincides with the actual ball or release point. It keeps the authored timing while absorbing positional error.
- In a PD-driven physical figure, IK's role is to produce *joint-angle targets* for the PD controllers, not final poses. The production ordering (authored pose, hip offset, limb IK) still applies to target generation.

### Gaps
- Epic's Foot Placement node documentation (lock/unlock thresholds, pelvis spring) returned an empty body; no parameters could be cited.
- FABRIK (Aristidou and Lasenby 2011) and CCD primary pages were not retrievable (404), so no claims about iteration counts or comparisons are cited. Unity Animation Rigging and Final IK documentation were not consulted in this pass.
- The Ubisoft "Fitting the World" foot-IK talk content is Vault/video-only; not summarised.
- No first-party look-at/aim IK write-up was retrieved beyond the Game Animation Sample's simple aim offset.

---

## 4. Motion matching and the procedural layers on top

### Takeaway
Motion matching (searching a mocap database every frame or few frames for the pose best matching current pose plus desired future trajectory) is the mainstream AAA locomotion method in 2026 and ships as a stock Unreal feature. It does not replace procedural animation: shipped stacks put inertial blending, leg IK, root offsetting, steering/orientation warping, lean and aim layers on top of it. It needs a mocap database, so it is not itself transferable to a data-free library; its *feature design* and layering are.

### Cited Findings
- Simon Clavet's "Motion Matching and The Road to Next-Gen Animation" (GDC 2016, Ubisoft Montreal, For Honor) presented the brute-force approach: search every frame of the mocap data at runtime and jump to the best match. Earlier credit goes to Michael Büttner's 2015 talk; academic citations describe it as "a greedy approximation to Motion Fields ... significantly advanced for Ubisoft's For Honor". — [GDC Vault](https://www.gdcvault.com/play/1023280/Motion-Matching-and-The-Road); attribution per [arXiv 2510.22632](https://arxiv.org/pdf/2510.22632)
- A concrete feature set from Ubisoft La Forge's reference implementation: left foot position, right foot position (and velocities/hip velocity), and entity position **0.33, 0.66 and 1.0 seconds in the future**; 27 features over 90,000 frames; cost is a sum of squared differences with early-out. — [Ubisoft La Forge GDC 2020 slides](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/74NXgJKzhhZw5sy4XsRag8/1327abfd28611ed5fd5e66efbdfb8a17/GDC20RagdollMotionMatching4.pdf)
- The same slides show the search going from 901 µs brute force to single-digit microseconds through feature sorting by standard deviation, PCA, and two-level bounding boxes (16 and 64 frames), and searching only every few frames; they answer "Motion Matching is slow / uses lots of memory" with a learned variant keeping no animation data in memory and about 3 MB of weights for locomotion. — [Ubisoft La Forge GDC 2020 slides](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/74NXgJKzhhZw5sy4XsRag8/1327abfd28611ed5fd5e66efbdfb8a17/GDC20RagdollMotionMatching4.pdf)
- Naughty Dog presented "Motion Matching in The Last of Us Part II" at GDC 2021 (Michal Mach, Maksym Zhuravlov), describing the switch as "a leap of faith" to a then fairly experimental system. — [Naughty Dog blog](https://naughtydog.com/blog/naughty_dog_at_gdc_2021); [GDC Vault](https://gdcvault.com/play/1027118/Motion-Matching-in-The-Last)
- Epic's Game Animation Sample (CURRENT, updated with each major engine release) uses the Motion Matching node with a Pose Search Database/Schema and a trajectory query from a Pose History node; Chooser tables filter which databases are eligible by gameplay context. — [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)
- Procedural layers documented on top of it: **Leg IK** pinning feet; **Offset Root Bone** (experimental) which "dynamically applies an offset to the root bone" when capsule movement and animation disagree; **steering** toward a future facing from the predicted trajectory, disabled when idle to prevent sliding; **Orientation Warping**; **additive lean** from lateral acceleration; an **aim offset** reset using "Dead Blending (a better type of inertialization that supports blend curves)". — [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)
- Known issue stated by Epic: Offset Root Bone performs no collision checks on its translation offset. — [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)

### Inferences
- The matching features (foot positions and velocities, hip velocity, future trajectory at about 1/3, 2/3 and 1 s) are a compact, production-validated description of "locomotion state". The same vector is a good state description for a hand-written gait controller or for deciding which scripted story phase to enter.
- The split "character capsule simulates intent, animation follows, a root offset absorbs disagreement" is the AAA version of Rosen's physics-first rule and of Rain World's two chunks.
- For a no-data TypeScript library, motion matching itself is out of scope, but a tiny database of authored key poses selected by a nearest-match cost (instead of a state machine) is a legitimate small-scale variant.

### Gaps
- Clavet's 2016 cost-function weights and the For Honor procedural layers are Vault/video-only and not verified here.
- The TLOU2 talk's specifics on layering (physical hit reactions selecting matched motion) appear only in third-party write-ups and are not cited.
- Unity's motion-matching status (Kinematica was discontinued; current first-party offering) was not checked.
- The Epic page fetched was labelled "Unreal Engine 5.9 Documentation"; I did not independently confirm the engine version current in November 2026.

---

## 5. Physics-animation blending in engines, and learned physics controllers

### Takeaway
Engine tooling has converged on one abstraction: spring-damper "controls" that pull simulated bodies toward animation targets, parameterised by **strength and damping ratio** rather than raw stiffness/damping, in either world space (pinning, non-physical) or parent space (joint motors, physical), with per-tick multipliers to fade them. Learned controllers moved from research (DReCon 2019) to one well-documented shipped use (ARC Raiders, 2025), still with helper forces and a very large investment.

### Cited Findings

**Unreal Physics Control plugin (CURRENT)**
- The Physics Control Component "manages Controls and Body Modifiers associated with one or more static or skeletal meshes"; controls drive one body relative to another, or relative to the world, through spring/damper drives. — [Epic API, UPhysicsControlComponent](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PhysicsControl/UPhysicsControlComponent)
- Parameters: `LinearStrength` ("the strength used to drive linear motion"), `LinearDampingRatio` ("A value of 1 results in critically damped motion where the control drives as quickly as possible to the target without overshooting"), and `LinearExtraDamping`, "added to the damping that comes from LinearDampingRatio and can be useful when you want damping even when LinearStrength is zero"; angular equivalents exist. — [Epic API, FPhysicsControlData](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PhysicsControl/FPhysicsControlData)
- Multipliers scale strength/damping per tick so controls can be created with defaults (for example from the physics asset) and faded at runtime. — [Epic API, FPhysicsControlMultiplier](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PhysicsControl/FPhysicsControlMultiplier)
- Helper functions convert between spring stiffness/damping and strength/damping-ratio/extra-damping. — [Epic API, PhysicsControl helpers](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PhysicsControl/UE__PhysicsControl__ConvertSprin-)
- If no parent body is set, the control is global (acts against the world / simulation space). — [Epic Python API, RigPhysicsControlComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/RigPhysicsControlComponent)

**RootMotion PuppetMaster for Unity (2015 onward, CURRENT asset)**
- Dual-rig architecture: setup duplicates the character into a kinematic animated **Target** and a ragdoll **Puppet** whose muscles follow it; the two live on separate layers with collisions between them disabled; behaviours (BehaviourPuppet, BehaviourFall) are separate objects. — [PuppetMaster docs, setup](http://root-motion.com/puppetmasterdox/html/page4.html)
- Ragdolls can be shared between characters "as long as the positions of the muscles match with their targets". — [PuppetMaster docs](http://root-motion.com/puppetmasterdox/html/page4.html)
- Version 1.2 added BehaviourBipedStagger with "Can Regain Balance" and an "On Regain Balance" event that switches back to BehaviourPuppet, i.e. balance loss and recovery are explicit behaviour states with events. — [RootMotion patch notes](https://rootmotion.freshdesk.com/support/solutions/articles/77000484277-patches)

**Ubisoft La Forge (research, 2019-2020; not confirmed shipped)**
- DReCon (SIGGRAPH Asia 2019): a motion-matching kinematic controller produces the target; a reinforcement-learned policy drives a simulated character to track it. La Forge states gamepad-controlled characters "can be fully simulated using physics and simultaneously directed with a high level of responsiveness at a surprisingly low runtime cost on today's hardware". — [Ubisoft La Forge](https://www.ubisoft.com/en-us/studio/laforge/news/VjEIwquaIyEZZSw5RZI0V/drecon-datadriven-responsive-control-of-physicsbased-characters)
- "Ragdoll Motion Matching" (Clavet, Bergamin, Holden, GDC 2020) frames the goal as "a self-powered physical character", the difference between "a character playing an animation" and "a character actually doing something"; the policy is "rewarded when it follows motion matching" and the "reward goes to zero if tracking is bad". — [GDC 2020 slides](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/74NXgJKzhhZw5sy4XsRag8/1327abfd28611ed5fd5e66efbdfb8a17/GDC20RagdollMotionMatching4.pdf)
- Reported costs: about 1.6 ms per character for 10 characters (including raycasts, IK), CPU cost "a bit more than a normal ragdoll", training time "10 to 40 hours, depending on the difficulty"; a slide warns "Here's what happens when you mess up the reward". — [GDC 2020 slides](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/74NXgJKzhhZw5sy4XsRag8/1327abfd28611ed5fd5e66efbdfb8a17/GDC20RagdollMotionMatching4.pdf)
- SuperTrack (Fussell, Bergamin, Holden) shows tracking for simulated characters via supervised learning with a learned world model rather than RL alone. — [SuperTrack paper](https://theorangeduck.com/media/uploads/other_stuff/SuperTrack.pdf)

**Shipped learned controllers by 2025-2026**
- ARC Raiders (Embark, Oct 2025): RL-trained physical legged locomotion with helper forces, offline training, adversarial motion priors; see section 1. — [80.lv, 31 Mar 2026](https://80.lv/articles/inside-the-magic-of-machine-learning-that-powers-enemy-ai-in-arc-raiders)
- GDC 2026's Machine Learning Summit also listed an RL talk on EA Sports FC 26 goalkeepers (shipped RL, but not physics-based character animation). — [GDC 2026 ML Summit agenda](https://schedule.gdconf.com/sessions/?tags%5B%5D=machine_learning_summit)
- Research in 2025 still lists as obstacles that training physics controllers takes hours to days and that controllers are highly dependent on character model design such as joint and torque limits. — [PARC, arXiv 2505.04002](https://arxiv.org/pdf/2505.04002)

### Inferences
- Parameterise every PD joint in the library by (strength or frequency, damping ratio) with damping ratio defaulting to 1, plus a separate "extra damping" term that works at zero strength. This is Epic's shipped API and matches Holden's spring parameterisation (section 6); raw kp/kd pairs are what both moved away from.
- The world-space versus parent-space distinction is the cleanest vocabulary for "cheating": parent-space controls are muscles (momentum-conserving, internal torques), world-space controls are invisible hands. A balance servo that applies net external force or torque is a world-space control and should be exposed, bounded and fadeable as one, as Landfall and Embark do.
- PuppetMaster's dual-rig design (a kinematic target the physical body chases, with collisions between them off) generalises: the library's "scripted pose" can be an explicit kinematic ghost figure, which also provides a fallback pose to blend to when physics fails.
- Learned controllers are not a realistic dependency-free option, but ARC Raiders confirms that even with RL the production answer includes non-physical stabilising forces; the author's servo is not a compromise unique to hand-written controllers.

### Gaps
- Epic's narrative Physics Control page returned no body text, so there is no cited guidance on recommended strength values, body-modifier semantics (kinematic vs simulated, gravity multiplier), or whether the plugin is still labelled experimental/beta in November 2026.
- The older Unreal Physical Animation Component, Havok's powered ragdolls, and EA Frostbite/SEED physics-animation work were not reached in this pass; no claims are made about them.
- PuppetMaster's pin weight, muscle weight, knock-out distance and get-up parameters appear only in forum posts and third-party blogs in my results, so exact semantics are not cited.
- I found no evidence that DReCon or SuperTrack shipped in an Ubisoft title; absence of evidence, not confirmation.
- The Embark talk "Walk Lizzie, Walk!" (RL for physics-based creature animation) exists on GDC Vault but its year and shipped status were not confirmed.

---

## 6. Second-order dynamics, spring-damper smoothing and inertialisation (timestep-independent forms)

### Takeaway
The consistent practitioner advice is to stop integrating smoothing springs numerically: use closed-form exponential dampers and critically damped springs parameterised by half-life (and optionally frequency / damping ratio), which are exact for any `dt`. Transitions are handled by inertialisation: switch to the new target immediately and decay the recorded offset (or cross-fade from an extrapolation of the old motion), rather than evaluating and blending two sources.

### Cited Findings

**Daniel Holden, "Spring-It-On: The Game Developer's Spring-Roll-Call" (4 Mar 2021, CURRENT reference)**
- Frame-rate traps: `lerp(x, g, factor)` per frame is frame-rate dependent; `lerp(x, g, damping*dt)` is unstable when `damping*dt > 1`. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Exact half-life damper: `damper_exact(x, g, halflife, dt)` = `lerp(x, g, 1 - exp(-(ln2 * dt) / (halflife + eps)))`; Holden calls it "fast, stable, and has intuitive parameters". Optional `fast_negexp(x) = 1 / (1 + x + 0.48x² + 0.235x³)`. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Semi-implicit Euler spring-damper (`a = stiffness*(g - x) + damping*(q - v)`) is unstable for large `dt` or stiff settings; the exact solution has three branches on the sign of `s - d²/4`: under-damped (decaying cosine, `y = d/2`, `w = sqrt(s - d²/4)`), critical (`x = j0·e^(-yt) + t·j1·e^(-yt) + c`, `j0 = x0 - c`, `j1 = v0 + j0·y`), over-damped (two exponentials). — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Parameterisation: `halflife_to_damping = 4·ln2 / halflife` (the 4 is "a bit of a fudge factor"), `frequency_to_stiffness = (2π·f)²`, damping ratio `r = d / (2·sqrt(s))` with 1 = critical. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- The branch-free `critical_spring_damper_exact` / `simple_spring_damper_exact(x, v, x_goal, halflife, dt)` is the fastest variant and the one "you may have actually used in your games"; `y` and `exp(-y·dt)` can be precomputed when many springs share half-life and `dt`. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Character controller trick: treat the spring's *position* as the character's velocity (so the spring's velocity is the acceleration), and evaluate the same closed form at future times to **predict the trajectory** (`spring_character_predict`). — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Inertialisation by spring: at a transition record offset position and velocity between source and destination (`inertialize_transition`), then each frame decay the offset with `decay_spring_damper_exact` and add it to the destination (`inertialize_update`). No blend time needs storing; caveats are no fixed blend duration and possible overshoot. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Useful variants: **double spring** (two chained springs at half the half-life, S-shaped ease), **timed spring** (reach the goal at about a requested time, via `halflife_to_lag = halflife / ln2`), **velocity spring** (tracks an intermediate target moving at fixed velocity); `extrapolate()` assumes exponentially decaying velocity. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)
- Resonance warning: "frequency" is a pseudo-frequency, and a longer half-life gives a narrower but stronger resonant response. — [theorangeduck.com](https://theorangeduck.com/page/spring-roll-call)

**Inertialisation and dead blending**
- David Bollo (The Coalition/Microsoft) introduced inertialisation for Gears of War 4: drop blended transitions, cut immediately to the target animation and treat the transition as a post-process, removing the need to evaluate the source animation during the transition. — [SIGGRAPH 2017 talk abstract](https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Bollo_High-Performance-Animation-in-Gears-of-War-4.pdf); [GDC 2018 Vault](https://gdcvault.com/play/1025165/Inertialization-High-Performance-Animation-Transitions)
- Holden's "Dead Blending" (25 Feb 2023): instead of storing an offset, **extrapolate the source** from its pose and velocity at the transition and cross-fade that extrapolation into the destination: on transition `ext_x = src_x, ext_v = src_v, ext_t = 0`; each update `ext_x += ext_v·dt`, `alpha = smoothstep(ext_t / blendtime)`, output `lerp(ext_x, in_x, alpha)`. — [theorangeduck.com](https://theorangeduck.com/page/dead-blending)
- Required safeguards: decay the extrapolated velocity with an exponential damper (`v *= exp(-ln2·dt / halflife)`), keep blend times short (even 0.2 s can jitter; 1 s extrapolations produce "crazy poses"), and track quaternion sign so the blend does not switch sides. — [theorangeduck.com](https://theorangeduck.com/page/dead-blending)
- Stated advantages: needs only the current pose and its velocity (finite differences suffice), never evaluates two animations at the transition frame, only two things are ever blended. Stated drawbacks: damps destination detail, can still foot-slide or feel "mushy". — [theorangeduck.com](https://theorangeduck.com/page/dead-blending)
- Epic adopted it: the Game Animation Sample uses "Dead Blending (a better type of inertialization that supports blend curves)". — [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)

**t3ssel8r, "Giving Personality to Procedural Animations using Math" (2022, CURRENT and widely reimplemented)**
- A second-order system with three parameters controlling frequency, damping and initial response, integrated with **semi-implicit Euler**; large timesteps can blow up, so eigenvalue analysis gives a stable-step bound and the solver either sub-steps or temporarily bounds the change. — [Hackaday, 30 Jun 2022](https://hackaday.com/2022/06/30/a-math-based-personality-for-games); [video](https://www.youtube.com/watch?v=KPoeNZZ6H4s)
- Community implementations label the three controls Frequency ("how rapidly the spring tries to oscillate"), Damping ("how quickly the system bleeds off energy") and Responsiveness ("how quickly the system reacts to a change in input"). — [chemicalcrux VRC docs](https://chemicalcrux.github.io/vrc-docs/docs/code/best.crux.animator-dynamics/sources/second-order-dynamics)
- A video summary notes the stability fix slows the dynamics rather than constraining the timestep, explicitly prioritising stability over physical accuracy. — [Recapio digest](https://recapio.com/digest/giving-personality-to-procedural-animations-using-math-by-t3ssel8r)

**Applied examples**
- Little Polygon's locomotion uses a closed-form critically damped spring (`omega = 2/duration`, `exp(-omega·dt)`) for lean, yaw and amplitude, each with a duration in seconds as the only tuning parameter. — [Little Polygon](https://blog.littlepolygon.com/posts/loco1/)

### Inferences
- Two different things in the author's library need different treatment. (1) *Smoothing of targets and parameters* (lean, desired foot position, pose targets, camera) should use Holden's exact half-life springs: unconditionally stable and frame-rate independent. (2) *PD joint torques inside the rod/point-mass simulation* cannot use the closed form because the plant is coupled; those need a fixed simulation substep, and the t3ssel8r-style stability bound (clamp effective stiffness against `dt`) is the relevant safeguard. Mixing these up is the common source of "works at 60 Hz, explodes at 30 Hz" bugs.
- Half-life in seconds (or frequency in Hz plus damping ratio) is the tuning unit that all three sources converge on; it survives changes to mass, timestep and scale far better than raw gains.
- The response-shaping `r` parameter in t3ssel8r's system (anticipation when negative, overshoot when above 1) is a cheap source of "personality" for target followers and is not available from a plain critically damped spring; Holden's double/velocity/timed springs cover the "arrive on time" case that story scripting needs (for example, the foot must reach the ball at time T).
- Inertialisation is a natural fit for story-to-story or story-to-locomotion switches in the library: change the PD target instantly, record the target-space offset and velocity, decay it with a half-life. No blend state machine is needed and it composes with physics because only the *targets* are blended.

### Gaps
- The exact t3ssel8r formulas were not verifiable in text this session. From prior knowledge of the video (unverified here): `y + k1·y' + k2·y'' = x + k3·x'` with `k1 = ζ/(π·f)`, `k2 = 1/(2π·f)²`, `k3 = r·ζ/(2π·f)`, and a per-step stable `k2 = max(k2, T²/2 + T·k1/2, T·k1)`; a later revision uses pole matching for high frequencies. Check against the [video](https://www.youtube.com/watch?v=KPoeNZZ6H4s) before quoting.
- Bollo's exact decay function (commonly described as a quintic polynomial with a fixed blend time and overshoot clamp) was not confirmed in any text source retrieved.
- Holden's code licensing is not stated on the article page; check the repository before copying code into the library.

---

## 7. Practitioner lessons: robustness, tuning burden, determinism

### Takeaway
What works in shipped games is modular handlers with explicit state transitions and escape hatches (physics takes over on failure, then an event-driven return to control), plus an accepted budget of non-physical help. What fails is expecting a general physical controller to handle every condition: the people who shipped these systems say this directly, and the one studio that shipped a learned controller nearly cut it several times.

### Cited Findings
- Decompose: Landfall's third rewrite replaced one script handling upright posture, ground checks and leg rotation with independent components, which also enabled reuse across body types (snakes drop the standing handler). — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Explicit step gating: a step handler decides when a step is finished and when the next can begin, rather than leaving it to emerge from torques. — [Game Developer](https://www.gamedeveloper.com/design/how-landfall-games-finds-the-fun-in-physics-engines)
- Explicit balance-loss and recovery states with events: PuppetMaster's stagger behaviour has "Can Regain Balance" and an "On Regain Balance" event that switches behaviours. — [RootMotion patch notes](https://rootmotion.freshdesk.com/support/solutions/articles/77000484277-patches)
- Escalating fallback chain in a 2025 physics-walking game: FK, then IK when blocked, then full ragdoll when pushed too far. (Secondary analysis.) — [CritPoints](https://critpoints.net/2026/04/21/how-do-games-make-characters-touch-the-game-world/)
- Validate and re-validate procedural targets: The Last Guardian rejects foot placements near objects, on steep inclines or too close to walls, and rechecks the landing point during the swing. — [Tanaka CEDEC 2017 slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- Constraint from an animation director: procedural processing "should not break the authored animations" and modules must run in a fixed order from large body parts to small. — [Tanaka slides](https://docs.google.com/presentation/d/1cYDabTQGYe09w3PyUU4XLrDn2fHy9X5eJIFUjVDt89U/htmlpresent)
- Generality is not achievable: "procedurally generating animations on the fly capable of performing such an action under any condition is simply not possible" (Madoc Evans, Exanima). — [Bare Mettle forums](https://www.baremettle.com/forums/index.php?threads/about-the-parry-mechanic.5293/)
- Tuning burden and risk: "it's too difficult to get the result that you want"; physics games involve "a lot of engineering"; too risky for big productions because it would be expensive to change mid-cycle. (Tomas Sakalauskas.) — [TheGamer](https://www.thegamer.com/risky-human-fall-flat-big-games-simple-physics/)
- Strength escalation has side effects: Exanima's team reports having to keep "making characters stronger" alongside more rigid collisions, which created a further problem (Nov 2026). — [Steam, Exanima Coffee Diary](https://steamcommunity.com/games/362490/announcements/detail/707787161892555241)
- Performance pressure reduces physics fidelity: Human: Fall Flat simplified colliders and reduced calculation frequency for mobile. — [Game Developer](https://www.gamedeveloper.com/design/optimizing-human-fall-flat-for-mobile-devices)
- Reward/objective mistakes produce degenerate motion in learned controllers; training takes 10 to 40 hours per controller in Ubisoft's research setup. — [Ubisoft La Forge GDC 2020 slides](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/74NXgJKzhhZw5sy4XsRag8/1327abfd28611ed5fd5e66efbdfb8a17/GDC20RagdollMotionMatching4.pdf)
- Production reality for learned physics locomotion: years of work by five to ten people; nearly cut several times; quality only became acceptable after adopting adversarial motion priors; generalisation required randomised training scenarios. — [80.lv](https://80.lv/articles/inside-the-magic-of-machine-learning-that-powers-enemy-ai-in-arc-raiders)
- Networking/determinism: Bare Mettle described the physics simulation as "far too complex and demanding to use traditional network synchronisation methods" (2014-era interview, via search summary). — [PC Invasion interview with Madoc Evans](https://www.pcinvasion.com/sui-generis-interview-with-bare-mettles-madoc-evans/)
- Stability over accuracy is an accepted trade in smoothing dynamics: clamp or slow the dynamics when the timestep is too large rather than let them diverge. — [Hackaday](https://hackaday.com/2022/06/30/a-math-based-personality-for-games)
- Known failure of a production procedural layer: Epic's Offset Root Bone does no collision checks on its offset. — [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)

### Inferences
- A robustness checklist for the library, each item traceable to a shipped practice above: (1) every story phase and every step has a completion condition *and* a timeout; (2) balance has a hard failure state that releases control to passive physics instead of fighting indefinitely; (3) recovery (get-up) is its own scripted behaviour entered by event; (4) foot targets are validated at lift-off and re-validated mid-swing; (5) non-physical assist forces are explicit, bounded, and fade out with a multiplier; (6) handlers are independent so a figure without legs or a seated figure can drop the standing handler.
- Determinism was barely discussed by practitioners in the sources reached. For a browser library it is nonetheless cheap to obtain and valuable for tests and for reproducible "stories": fixed simulation substep with an accumulator, closed-form springs for smoothing (no `dt`-dependent drift), no `Math.random` without a seeded generator, and care with iteration order. The games above mostly avoid needing it (single-player, or wobble is acceptable); Exanima's networking remark shows what it costs when it is needed and absent.
- The tuning burden reported by every source argues for a small number of physically meaningful parameters (frequency, damping ratio, half-life, max force) with scale-invariant defaults, and for debug visualisation of each layer; attendee summaries of Rosen's talk note that each layer could be toggled and visualised independently.

### Gaps
- No first-party source retrieved describes get-up logic in detail (pose matching to a get-up animation, choosing front/back get-up, blend-in time). This is standard practice (Unreal pose snapshot, PuppetMaster get-up) but not cited here.
- No practitioner source on determinism or fixed-timestep policy for active ragdolls was found; the determinism inference above is engineering reasoning, not reported practice.
- No sources found on automated testing or regression strategies for procedural/physical animation.
- Havok, EA SEED/Frostbite and Unity first-party physics-animation guidance were not reached and remain open.
