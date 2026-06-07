# FLOCKD — Secret Allegiance & Most-Beautiful-Ever Plan

> Lead-designer brief. Grounded in the real stack: SpacetimeDB module (`server/spacetimedb/src/index.ts`,
> `table()` + `spacetimedb.reducer`), the AI sidecar director (`services/ai-sidecar/survival.ts` — cached
> `SYSTEM`, forced `tool_use` `direct_hunt`, ~2.5 s `directorTick`, `buildSummary` → Claude → `applyDecision`
> → `logDirector`/`emitSabotage`), WebGPU renderer with ACES tonemap and **zero postprocessing**
> (`Renderer.js:37`, `main.js:663`), and the 12 Hz transform netcode (`src/net/`).

---

## Secret Allegiance Mechanics

A "secret allegiance" is a covert, private bargain between a player and **THE HUNT** (the Claude-driven
predator). The player takes a hidden action; the sidecar folds it into `buildSummary`; Claude's targeting
shifts; the favor stays secret until a dramatic reveal in `director_log`. This is the killer LLM-meets-DB
feature: *the AI predator can be bribed, and SpacetimeDB's private tables make the bribe genuinely secret.*

### Ranked mechanics

| # | Mechanic | Secret action | How Claude is swayed | Why it stays secret | Counterplay | Reveal | Impact | Effort |
|---|----------|---------------|----------------------|---------------------|-------------|--------|:------:|:------:|
| 1 | **Whispered Pact** | `whisperPact` reducer writes a plea into private `secret_pact` table | `buildSummary` appends a private pact block; `SYSTEM` gains a pact clause; Claude shifts target away from patron | `secret_pact` is private; `redactReasoning` strips the patron name before `logDirector` | Pacts expire; rivals out-plead; **tell**: spared bird's `distToPredator` stays suspiciously high | Climax: un-redacted `director_log` row + taunt, then honor-or-betray | **High** | Med |
| 2 | **Feather Tithe** | `tithePredator` spends `player.score` into private `favor_ledger` | Private ranked favor block in `buildSummary`; `SYSTEM` biases hunt toward **low-favor** birds | `favor_ledger` private; the score drop reads as normal gameplay; sabotage never hits the patron | Favor **decays per tick** so you must re-buy; rivals out-tithe; director may still betray | Postgame results: "mercy was purchased" + feathers spent | **High** | Med |
| 3 | **Blood Offering** | `offerRival` marks a rival; private `bounty` row; pays only if victim dies soon | `buildSummary` injects the bounty; `SYSTEM` tells Claude to focus the named victim | `bounty` private; predator "just happens" to chase the victim; offerer "happens" to be safe | Herding slows you; victim can counter-offer; once victim dies the patron becomes the new leader (and target) | On the catch, a public taunt names the betrayal; victim sees who sold them out | **High** | Med |
| 4 | **Hidden Task** | Sidecar secretly assigns each player a private trial in `secret_task`; completing it earns protection | Sidecar detects completion from transforms, sets a favor flag; `SYSTEM` prefers the **un-initiated** | Tasks are private; the completing behaviors are ordinary flight (e.g. "thread 3 rings low") | Trials cost tempo; cap at 1–2; a winning initiate is still suppressed; favor decays | Climax line + a HUD sigil on the initiate | Med | Med |
| 5 | **Monarch's Mercy** | One single-use `claimMercy` buys a time-boxed immunity window | Private mercy window in `buildSummary`; `SYSTEM` may grant **or refuse** | Mercy window private; the player just stops being hunted briefly | One-shot; bad timing wastes it; director may refuse a runaway leader | Honored: *"There are no more."* Refused: *"I am the wrong predator to beg."* | Med | **Low** |
| 6 | **Betrayal Clock** | *Not* a player action — sustained protection silently builds betrayal pressure | Sidecar tracks `sparedTicks`, injects a strain line; `SYSTEM` prizes closeness so Claude eventually **turns** | Strain counter private; the patron just looks lucky until the flip | Caps how durable any favor is; the patron must convert protection into a real lead, fast | *"Loyalty is a luxury, gold."* — public `director_log` line when the patron flips | **High** | **Low** |

### ⭐ TOP-3 RECOMMENDATION

**#1 PICK — Whispered Pact (+ Betrayal Clock as its built-in twist).**

> **Pitch:** A player secretly DMs the AI predator a plea ("spare me and I'll herd the leader into you"),
> and Claude — reading that private plea inside its real targeting prompt — actually shifts the hunt.
> Nobody else can see the deal, until the climactic moment when the predator either honors the pact on
> camera or betrays it with a one-line taunt that names the traitor to the whole room.

**Why it wins this hackathon (all four judging axes at once):**

1. **It is the most "substantial LLM" feature you can ship.** The pact text flows straight into the
   `buildSummary` prompt the director already builds, so Claude's *real* reasoning is provably altered by
   player words. That is uncopyable by a scripted bot and reads instantly as "the AI is negotiating."
2. **It is a textbook SpacetimeDB showpiece.** `secret_pact` is a *private* table — the engine itself
   guarantees the secret. The reveal flips one `director_log` row from redacted to un-redacted. "A
   database that keeps a secret the other players literally cannot subscribe to" is a jaw-drop line.
3. **It is inherently multiplayer/social.** Pacts create betrayal, paranoia, and tells (the spared bird's
   high `distToPredator`) — emergent table-talk that makes a 3-minute demo *story-driven*.
4. **Betrayal Clock makes it self-balancing for free.** Bundle the **Low/Low** Betrayal Clock as the pact's
   expiry pressure: protection that lasts too long *forces* Claude to flip, so a pact can't be a runaway
   "I win" button — and the flip is the single best dramatic beat in the build.

**Implementation sketch (matches the existing pattern exactly):**
- Table: `const secretPact = table({ name: 'secret_pact' /* private: no public flag */ }, { id, roomId, patron: t.identity(), plea: t.string(), untilTick: t.u64(), createdAt })`.
- Reducer: `export const whisperPact = spacetimedb.reducer({ roomId, plea }, (ctx, a) => { /* gate to ctx.sender, cap length, set untilTick */ })`.
- Sidecar: `buildSummary` reads active pacts for the room and appends a private `=== PACTS (secret) ===`
  block; add one pact clause to `SYSTEM`; in `applyDecision`, when `targetPlayer` would be a patron, redact
  the patron's name before `logDirector` (new `redactReasoning` helper). Track `sparedTicks` in the
  `RoomHandle` (Betrayal Clock); when it exceeds a cap, fire the un-redacted reveal row.
- Cost: sidecar ~1.5 h, module 1 table + 1 reducer, client a tiny "whisper" input + reveal toast.

**Runner-up A — Feather Tithe (High/Med):** spend `score` to buy down your hunt priority; favor *decays
per tick* so it's a live economy, and the postgame "mercy was purchased" reveal is clean. Pick this if you
want a numeric, always-on system rather than a one-time dramatic beat.

**Runner-up B — Betrayal Clock (High/Low):** pure sidecar, zero new reducers — track `sparedTicks` and fire
a public betrayal line when Claude flips on a too-long-protected bird. Lowest effort wow in the whole list;
ship it regardless, ideally as the Whispered Pact's expiry mechanism.

---

## Most-Beautiful-Ever Plan

Benchmark truth (Bruno Simon, Lusion, Active Theory): **post-processing + color grade + motion + audio do
~80% of perceived beauty, and they're cheap.** FLOCKD's single biggest gap is that it ships **zero post**.
The plan is phased so each phase is independently demo-able.

### Phase A — Quick juice (half a day, Wow/Effort is absurd)
- [ ] **Bloom post pass** — new `src/core/PostFX.js` using `PostProcessing` + `bloom` from `three/webgpu`
      + `three/tsl`; wrap `main.js:663`'s `renderer.render` in `postProcessing.render()`. Push ring/pickup
      emissive >1.0 so only they glow. **Wow 9 / Effort 1.**
- [ ] **Vignette + per-biome color grade** — TSL radial-falloff multiply + lift/gamma/gain (or a LUT per
      biome), driven from the existing `applyBiome`. **Wow 8 / Effort 1.**
- [ ] **Film grain + subtle chromatic aberration** — animated TSL noise + R/G/B UV offset scaled by radius;
      kills the flat-WebGL plastic feel. **Wow 7 / Effort 1.**
- [ ] **Speed-driven radial motion blur** — cheap radial blur, intensity = `clamp(FlightState.speed)`;
      diving suddenly feels *fast*. **Wow 8 / Effort 2.**

### Phase B — Locker / bird identity (1–1.5 days)
- [ ] **Per-player plumage via matcap or gradient ramp** — swap the grey `Stork.glb`
      `MeshStandardMaterial` for `MeshMatcapMaterial` (or TSL `matcap()`); give each of the 8 colors a
      2-tone matcap (light belly → saturated back) so birds read as *species*, not tinted clones.
      256px PNGs, free at github.com/nidorx/matcaps. **Wow 7 / Effort 2.**
- [ ] **Flight trail / wingtip ribbon** — additive trail behind each bird, brightened so Phase-A bloom
      catches it; trail length scales with speed. **Wow 8 / Effort 2.**
- [ ] **Iridescent wing sheen** — TSL fresnel/iridescence term on the wing material for a hummingbird
      shimmer. **Wow 6 / Effort 2.**
- [ ] **3D menu/locker** — replace the flat CSS-gradient card (`MenuShell.js`) with the live bird on the
      real canvas, slow turntable + the post chain, so the menu *is* the game looking gorgeous. **Wow 7 / Effort 2.**

### Phase C — Postproc / environment depth (1 day)
- [ ] **Re-enable env map on WebGPU** — bake `SkyMesh` to an equirect (or render once to a
      `WebGLCubeRenderTarget`) and assign `scene.environment` (the `Scene.js:42-52` TODO). Gives water and
      wings *real* reflections instead of flat shading. **Wow 7 / Effort 2.**
- [ ] **Depth of Field** — native TSL `dof(scenePass, viewZ, focus, aperture)`, subtle aperture so far
      terrain softens around the focused bird; the "expensive" cinematic look. **Wow 8 / Effort 2.**
- [ ] **Fake god rays / light shafts** — radial blur from the sun's screen position masked by a depth/bright
      buffer (real volumetrics are too heavy for web). **Wow 9 / Effort 3.**
- [ ] **SMAA/FXAA final node** — TSL `fxaa()` as the last pass to clean edges after the chain. **Wow 5 / Effort 1.**
- [ ] **Audio layer** — replace procedural-only `SoundFX.js` with a music bed + wind/ambience + spatialized
      wingbeats; audio is half of "felt" beauty and is currently absent. **Wow 8 / Effort 3.**

### Phase D — LLM depth (the "substantial AI" judging axis)
- [ ] **Whispered Pact + Betrayal Clock** (see top recommendation). **Impact very high.**
- [ ] **Two-agent "Murder of Crows"** — replace the single `direct_hunt` with two cheap Haiku personas that
      *argue* (STALKER vs HARRIER) inside the 2.5 s budget; a one-line referee picks; log *both* arguments
      to `director_log`. Add a 2nd `cache_control` breakpoint on the match-summary block. **Impact very high / Effort ~1.5 h.**
- [ ] **Agentic memory across matches** — new `hunter_memory` table; at room→`over`, one Claude call
      summarizes each player's style ("dives early, overshoots tight rings — bait low"); inject as
      `priorNotes` into next match's `buildSummary`. Persists for free via SpacetimeDB row history.
      **Impact very high / Effort ~1.25 h.**
- [ ] **Streaming reasoning to the dashboard** — `client.messages.stream(...)` writing partial text to a
      `director_stream` row (~5 Hz) so the dashboard types the predator's thoughts live. **Impact high (pure wow) / Effort ~1.25 h.**
- [ ] **Post-match saga + cutting taunts** — one Haiku call over `director_log` + `match_event` writes a
      4-line mock-heroic saga into `match_saga` for the results screen; feed `hunter_memory` so taunts bite.
      **Impact medium.**
- [ ] **CUT:** extended *thinking* on the hot director tick — it blows the 2.5 s latency budget; the debate
      (above) already gives visible reasoning. Keep Haiku, not Opus, on the hot path.

### Phase E — SpacetimeDB showpiece (the "I didn't know a DB could do that" axis)
- [ ] **Private-table secret** — lean into `secret_pact`/`favor_ledger` being private: demo that other
      clients literally cannot subscribe to the bribe. Engine-guaranteed secrecy is the headline.
- [ ] **Commitlog / full row history** — surface that event-table inserts (sabotage, pacts) are recorded in
      the commitlog even though rows vanish from clients, and that `hunter_memory` persists across publishes
      for free — the cross-match callback is a DB feature, not app glue.
- [ ] **Sidecar-as-privileged-client** — frame the architecture out loud: Claude is the *only* author of AI
      state, SpacetimeDB just fans it out deterministically from `room.seed`.

---

## DO-THIS-NEXT (ordered by wow-per-effort)

1. **Bloom post pass** (`PostFX.js`, wrap `main.js:663`). Half-day, instantly lifts the *entire* game. 🟢
2. **Vignette + per-biome color grade + film grain.** Same afternoon, cinematic mood. 🟢
3. **Betrayal Clock** — pure sidecar, no new reducers; the predator dramatically turns on the over-protected. 🟢
4. **Whispered Pact** — the flagship: bribe-the-AI via `secret_pact`, redacted `director_log`, on-camera
   honor-or-betray reveal. The single best hackathon feature; Betrayal Clock is its expiry twist. 🔵
5. **Agentic memory across matches** (`hunter_memory`) — "the AI learned how *you* fly last round." Cheap,
   exploits STDB persistence, turns the demo into a 2-match payoff. 🔵
6. **Two-agent Murder of Crows** — predators that argue strategy live; the strongest "substantial LLM" line. 🔵
7. **Per-player matcap plumage + speed-scaled flight trail** — birds become *species*, trails catch the bloom. 🟡
8. **Re-enable WebGPU env map + DoF** — real reflections + dreamy focus; the "expensive" look. 🟡
9. **Streaming reasoning to dashboard** — the predator's mind types itself out live. 🟡
10. **Audio layer + fake god rays** — the last 20% of "felt" beauty; do if time remains. 🟠

Legend: 🟢 do today · 🔵 flagship LLM/STDB wow · 🟡 high-value polish · 🟠 stretch.
