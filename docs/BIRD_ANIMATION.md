# FLOCKD — Bird Avatars + "Mass-Conform" Flight Animation

Players pick a bird avatar (a `.glb`) in the locker; it's their bird everywhere.
The hard part: **7 models, 7 different rigs** (dragon, cardinal, phoenix, pigeon,
generic) — how do they all *fly* believably?

## The research verdict (firecrawl)
- **Retargeting ONE clip onto all rigs does NOT work reliably.** three.js
  `SkeletonUtils.retargetClip()` is documented-buggy (off-by-one frame, errors)
  and needs near-matching skeletons (same bone names/hierarchy). These varied
  bird models don't share a skeleton, so a single shared flight clip won't conform.
- **Mixamo is humanoid-only** — no bird/quadruped auto-rigging. Useless here.
- **Plenty of FREE already-animated rigged bird GLBs exist** (Sketchfab: "Low Poly
  Bird (Animated)", "Bird Flying Animation loop", LizardSquare "Rigged Birds"
  collection; Quaternius/Poly Pizza animated packs). Prefer sourcing avatars that
  already ship a fly cycle.
- **Playing a model's OWN embedded clip is trivial** (`AnimationMixer` + the GLB's
  `gltf.animations`).

## The plan — a 3-tier `BirdModel` that conforms ANY model
One avatar wrapper picks the best available motion per model, at load time:

1. **Tier 1 — embedded clip (best).** If `gltf.animations.length > 0`, run an
   `AnimationMixer` and play the fly/flap/idle clip (match by name: `fly|flap|wing|
   idle`, else clip 0). Drive its timeScale from flight speed/flap input. → phoenix
   ("real-time_bones_demo"), celestial, dragon likely land here.
2. **Tier 2 — procedural wing-bone flap.** Else if the model has a skeleton, find
   wing bones by name heuristic (`wing|arm|feather|pinion|l_/r_|left/right`) and
   oscillate their local rotation with a sine wave synced to the flap gesture. Works
   on any rigged-but-unanimated bird.
3. **Tier 3 — whole-model pseudo-flight (universal).** Else (static mesh — lowpoly
   pigeon, `bird.glb`, `bird_grey`) reuse the Stork motion the current `BirdModel`
   already does: y-bob, bank-on-turn (roll), pitch on climb/dive, subtle "breathe"
   scale. No rig required — conforms to literally anything.

Normalization (shared with all tiers): auto-scale each model to a consistent
wingspan (~6–10 units), center, orient nose to −Z (the game's forward), drop origin
to the body center. Mirror the existing `GlbWorld` normalize logic.

## Skin system (sync)
- STDB: add `skin` (string id) to the `player` row; `setSkin(id)` reducer (like
  `setColor`). Default `'stork'`.
- Locker: pick model + color → `net.setSkin(id)` + `net.setColor(idx)`.
- `BirdModel` (local) + `remoteBirds.js` load the chosen GLB via the wrapper above;
  `color` still tints (multiply) where the material allows.
- Registry `BIRDS = { stork, dragon, cardinal, celestial, pigeon, bird, phoenix, grey }`
  → `{ file, label, tier-hint }`, mirroring `WORLDS`.
- Lazy-load + cache per skin; remote birds sharing a skin clone one load.

## Files / deploy
- Same pipeline as worlds: drop `.glb`s in `~/Downloads`, I compress
  (gltf-transform; birds are small so often no compression needed), place in
  `public/birds/`, gitignore + host on Vercel Blob for deploy.
- Sources to fill gaps with pre-animated birds: Sketchfab "Rigged Birds" /
  "Bird Flying Animation loop", Quaternius animated bird pack, Poly Pizza.

## Status
Files were NOT in ~/Downloads at request time (0 .glb present) — need them to
compress + render-verify + classify each into a tier and build the system.
