# FLOCKD — Research Synthesis & Prioritized Backlog

> Distilled from 4 parallel research tracks (LLM×STDB ideas, addictive game-feel,
> god-tier web UI, Fortnite lobby). Goal: maximize hackathon win-probability across
> the 3 judging pillars — **multiplayer/collaboration**, **substantial LLM use**,
> **SpacetimeDB backend** — while staying realistic in a vanilla-JS + Three.js
> (WebGPU/TSL) + SpacetimeDB + Claude stack.
>
> **Status context:** Phase 0 (fork), Phase 1 (netcode), Phase 2 (Creative mode +
> world-gen LLM) are DONE. Phase 3 (Survival + LLM predator) and Phase 4
> (polish/deploy) remain. Most ideas below slot into Phase 3 / lobby / polish.

The single strongest strategic move surfaced across tracks: **make the LLM a NAMED,
visible character whose decisions are written to SpacetimeDB rows and synced to
everyone at once** — that collapses "substantial LLM use" and "SpacetimeDB
collaboration" into the *same* feature, and it is what judges can actually *see*.

---

## 1. LLM × SpacetimeDB ideas

Theme: stop hiding Claude behind invisible numbers. Personify it, persist its
memory in rows, sync its decisions. Reuse the sidecar's existing 2–4s call cadence
so most of these add **zero new latency**.

| Idea | Insight | Impact | Effort |
|---|---|---|---|
| **Named trash-talking predator w/ persistent memory** ("Skraah") | Personify the survival predator; its targeting call also emits a first-person taunt referencing your past deaths (read from `match_event` rows). Persona + cross-round memory makes emergent behavior *land*. | High | Low |
| **Legible L4D-style AI Director** | Claude reads pack spread + who's runaway-leading, outputs a `director_state` (buildup/peak/fade/relax) + the sabotage to enforce it — hunts leader, aids last place. Show the state on a HUD chip so judges watch the AI "change its mind." | High | Low |
| **STDB time-travel replay → Claude "Legend of the Flock" recap** | Append-only history + deterministic seed = a free replay. At match end Claude narrates the ordered event log into a saga w/ per-player MVP awards; client renders a ghost-camera flythrough. Viral share artifact + a 3rd substantial LLM use. | High | Medium |
| **Dead birds → live audience: STDB prediction market + Claude heckler** | Eliminated players enter dead-cam, spend feathers to predict outcomes (no-money Twitch-Predictions). Claude casts/heckles. Turns churned players into an active crowd + a 2nd collaboration surface. | High | Medium |
| **Per-player secret LLM side-quests (soft social deduction)** | Private, identity-scoped `secret_mission` row; one Claude call at world-gen emits a machine-verifiable predicate (ring index, altitude, placement). Post-match reveal of who completed theirs = cheap personalized surprise. | High | Medium |

**Cheap bolt-ons mentioned:** mid-flight prompt-injection world DELTAS the flock
co-edits live; an AI co-pilot "whisper" ally; cross-match rivalries mined from the
event log; a scheduled-reducer split (deterministic `game_tick` owns truth, sidecar
only *thinks*); a live-streamed Forging `build_log`; speculative pregeneration cache
so a slow Claude call never stalls the demo.

---

## 2. Addictive game-feel

Theme: the cheapest huge unlock for a *flight* game is the **Superflight near-miss /
proximity-combo loop** — reward flying CLOSE to geometry with an escalating, bankable
multiplier. It turns existing terrain + physics into a self-generating dopamine engine
with zero new content. Layer Vlambeer-grade juice on every beat; wrap it in fast
.io-style rounds with instant restart.

| Idea | Impact | Effort |
|---|---|---|
| **Near-miss proximity multiplier (the Superflight loop)** — per-frame distance to nearest geometry; inside a danger band, award points scaled by closeness × speed; live multiplier rises in-band, decays out. Predator near-misses pay the biggest. | High | Low |
| **Bankable combo w/ crash-to-lose tension (Tony Hawk)** — near-miss points sit UNBANKED in a visible pot; commit on a "safe" event (ring clear / Bank tap); a crash forfeits the whole pot. Push-your-luck. | High | Low |
| **Rocket-League canned quick-chat** — radial/hotkey of 4–8 bird-themed lines ("Nice flock!", "On your tail!", "GG flock") broadcast as a synced STDB event → speech bubble + chirp. No text moderation; makes MP feel ALIVE. | High | Low |
| **Vlambeer-grade juice on every flight beat** — FOV punch + streak particles w/ speed; freeze-frame + screenshake + whoosh on near-miss/overtake; feather-burst on boost; chunky crash. All client-side. | High | Medium |
| **Boost economy charged by skill (near-miss = fuel)** — boost meter fills ONLY from near-misses/ring-threads/overtakes, drains on use. Optimal line = dangerous line. Escaping a predator grants a big charge. | High | Medium |
| **.io fast round + instant restart loop** — cap rounds 60–120s, auto-respawn in 2–3s on one key, same room/flock, no loading screens. Persistent top-right live leaderboard. | High | Medium |
| **Predator as Hades-style escalating, variable-reward threat** — slow stalk → coordinated hunt → frenzy; sabotage on a semi-random schedule; surviving a lunge = giant scored near-miss + boost. Doubles down on the LLM pillar. | High | Medium |
| **Collaborative flock combo (co-op score)** — N birds in close formation/slipstream → shared multiplier boost + visible tether/glow; drafting refills boost. Makes presence a mechanic; directly serves the collaboration pillar. | High | Medium |
| **Near-miss FX as central feedback signal** — on every near-miss: brief slow-mo, escalating callout (NICE→SLICK→INSANE), rising-pitch SFX, multiplier pop. | Medium | Low |
| **Live leaderboard + spectate-the-leader drama** — leader gets golden trail/glow AND is the predator's prime target (built-in comeback); dead spectators auto-follow leader. | Medium | Low |
| **Roguelite "failure is progress" results card + meta XP** — post-round XP (distance/near-miss/rings/overtakes), unlock progress, best-run deltas; persist a profile row. Last place still progresses. | Medium | Medium |
| **Flow-tuned speed curve** — ramp speed floor / ring gaps / predator pressure / fog over a round; always show next goal + immediate feedback. Budget time to make the core glide feel great first. | Medium | Medium |
| **Daily/seasonal return hook (streak FOMO)** — rotating daily challenge + login-streak cosmetics; Creative "world of the day" from flock prompts. Post-hackathon stretch. | Medium | Medium |

---

## 3. God-tier web UI (Three r184 / WebGPU / TSL)

Theme: FLOCKD is already on the ideal stack (WebGPU-default, TSL/NodeMaterial,
Ocean4 iFFT water, TSL forest, ACES tone mapping). Two gaps dominate: **(1) no
postprocessing pipeline yet**, and **(2) the WebGPU path skips the PMREM env probe**
(`Scene.js`), so water/forest lack sky reflections there.

**Critical foundation:** use the **TSL-native `PostProcessing` class** (`three/webgpu`
+ `three/tsl`) — NOT pmndrs/postprocessing or EffectComposer (WebGLRenderer-only, no
WebGPU migration path). One node graph unlocks bloom, DoF, vignette, grain, chromatic
aberration, god-rays, LUT, AA in a single fullscreen pass at near-zero marginal cost.

| Idea | Impact | Effort | Files |
|---|---|---|---|
| **TSL-native PostProcessing pipeline (do FIRST)** — swap `renderer.renderAsync` for `post.renderAsync()`; gate behind WebGPU + `?fx=on`; WebGL2 fallback keeps plain path. | High | Medium | `GameLoop.js`, `Renderer.js`, `Scene.js` |
| **Bloom on emissive** (sun, rings, predator, speed) — boost `emissiveNode` on SkyMesh sun, Ring/RingBurst, predator; spike bloom on ring pass; menacing red predator glow as it closes. | High | Low | `Ring.js`, `RingBurst.js` |
| **3D LUT / .cube color grading** — warm golden-hour grade for Creative, cold high-contrast for Survival; swap LUT uniform on mode switch. Makes the two modes feel like different games. | High | Low | postproc graph |
| **GSAP-driven animated HUD + glassmorphism** — frosted cards for lobby/Forge/leaderboard/timer; GSAP count-up scores, slide/scale leaderboard on rank swaps, red pulse + shake on sabotage, lobby→countdown→go timeline. ~6KB. | High | Medium | `lobbyUI.js` |
| **God-rays / volumetric shafts from the low sun** — project sun screen-pos → radial-blur god-ray node; sunElevation=20 already perfect for long shafts. Heroic golden-hour hero shot. | High | Medium | `Scene.js`, postproc |
| **GPU compute particle wing-trails** (WebGPU killer feature) — per-player glowing trail ribbon; per-identity color; red embered predator trail + sabotage-burst puffs. WebGL2 fallback: cheap fading InstancedMesh ribbon. | High | High | `remoteBirds.js` |
| **Speed-feel kit: radial speed-lines, motion blur, FOV punch** — on boost/dive GSAP-tween FOV +10–15°, ramp speed-lines + CA + bloom from one `speed01` uniform; invert for headwind sabotage. | Medium | Medium | `CameraRig.js`, `FlightPhysics.js` |
| **Cel/toon + rim-light option** — toon pass + fresnel rim makes low-poly a *feature*; rim doubles as readability when 8 birds overlap. Toggle photoreal vs stylized. | Medium | Medium | `BirdModel.js` |
| **DoF + vignette + grain + chromatic aberration** — gentle vignette + faint grain always-on; DoF rack-focus on menu / "you are hunted" callout; CA driven by speed + sabotage. | Medium | Medium | postproc graph |
| **WebGPU env probe to restore water reflections** — bake sky to equirect / render SkyMesh once to RT → `scene.environment`; optional Reflector plane near rings. Closes parity gap (`Scene.js` L33–52). | Medium | Medium | `Scene.js` |
| **Stylized gradient skydome + animated clouds** — let Claude's Creative prompt drive sky mood (palette/time-of-day from fused-world JSON → 3 color uniforms). Makes LLM authoring visibly tangible. | Medium | Low | `CloudPlane.js` |
| **Game-grade typography** — 2 Google Fonts: display (Orbitron/Russo One) for titles, Rajdhani/Space Grotesk for HUD; keep tabular-nums on timers. One `<link>` tag. | Medium | Low | `index.html` |
| **AgX tone mapping + AA node** — A/B AgX vs ACES on bright sky/bloom; add FXAA/SMAA/TAA node since the pipeline can disable MSAA. Tiny diffs, outsized payoff. | Medium | Low | `Renderer.js`, postproc |

---

## 4. Fortnite lobby (the gold-standard MP front-end)

Theme: **the menu is not a menu — it's a continuous living 3D social space.** Your
persistent avatar (and friends') stands present, every interaction has motion+sound
juice, one big PLAY button collapses friction, and a single seamless transition flows
lobby→match with no hard cut. FLOCKD's nearly-free killer: render the whole room as a
**flock of perched birds in the reused gameplay scene** — literally dramatizes the
game's name AND showcases the STDB pillar on the *first* screen.

| Idea | Impact | Effort | Files |
|---|---|---|---|
| **Shared-flock lobby scene** — every player in the room = a perched bird in the SAME scene, positions/colors synced from `player` table; idle flutter + auto-chirp. Nearly free (reuses `remoteBirds.js`). Strongest single differentiator. | High | Medium | `main.js`, `remoteBirds.js` |
| **Persistent 3D character in the lobby** — YOUR bird on a perch w/ idle wing-flutter + head-bob, rim light, slow orbit camera, under a `lobbyMode` flag. | High | Medium | `main.js` |
| **Live plumage preview synced to player row** — 4–8 HSL swatches + 2–3 trail colors applied live to lobby bird w/ scale-pop; persist `color`/`cosmetic` on the `player` row → your color is your identity in flight. | High | Low | `lobbyUI.js`, player table |
| **Party panel + ready-up + single big PLAY** — roster as bird-avatar chips w/ green/grey ready dots; `ready` boolean flips on click; host launches via reducer. Live STDB dot-flips = the collaboration pillar made visible. | High | Medium | `lobbyUI.js`, player table |
| **Looping ambient bed + 3–4 UI SFX** — lobby loop (wind+birdsong+pad); hover blip, plumage pop, ready chirp, bright launch rise (loudest, per audio hierarchy). High polish-per-byte. | High | Low | `src/audio` |
| **Motion/transition juice (micro-interactions)** — CSS 150–250ms ease-out: buttons scale 1.05 + glow on hover, roster chips stagger-in, FORGE pulses when ready; in-scene slow orbit + drifting leaves. Cheapest perceived-quality win. | High | Low | `lobbyUI.js` |
| **Low-friction invites (room codes / links / QR)** — show room code BIG, one-click "Copy invite link" (full `?room=&mp=` URL) + optional QR; friendly two-word codes (SWIFT-HERON). ~15 lines, huge demo win. | High | Low | `lobbyUI.js` |
| **Seamless matchmaking → match-found (no hard cuts)** — reuse gameplay scene → on launch fly orbit camera off perch into start gate, fade lobby DOM out / world in; "forging your world…" shimmer over the perch for Creative. | Medium | Medium | `main.js` |
| **Player identity front-and-center** — nameplate above lobby bird tinted w/ plumage color (reuse remote-bird billboard) + one-emoji banner on the player row; recognizability doubles as Survival readability. | Medium | Low | `remoteBirds.js`, player table |
| **Flock XP progression surface** — thin lobby XP bar filled by contributions (prompts, rings, placements); unlock plumage/trail at thresholds; XP on player row. Return-loop + rewards collaborative prompting. | Medium | Medium | player table, `lobbyUI.js` |
| **"Today's Flight" featured card** — rotating Claude-seeded Creative theme-of-the-day, one-click load, tiny preview thumb. Showcases LLM use on the FIRST screen; reuses existing sidecar. | Medium | Low | `lobbyUI.js`, sidecar |

---

## PRIORITIZED BACKLOG

Ranked by impact/effort (high-impact + low-effort first). **Phase** maps each idea to
where it fits: **lobby** (front-end social space), **survival** (Phase 3 mode + LLM
predator), **dashboard** (HUD/score/leaderboard/results UI), **polish** (Phase 4
visual/audio/feel), **deploy** (Phase 4 ship + demo safety).

| # | Idea | Impact | Effort | Phase | Track |
|---|---|---|---|---|---|
| 1 | Copy-invite-link button + friendly room codes (+QR) | High | Low | lobby | Fortnite |
| 2 | Rocket-League canned quick-chat (synced STDB event) | High | Low | lobby | game-feel |
| 3 | Live plumage preview synced to player row | High | Low | lobby | Fortnite |
| 4 | Lobby ambient bed + 3–4 UI SFX | High | Low | lobby | Fortnite |
| 5 | CSS/lerp micro-interaction juice (hover/stagger/pulse) | High | Low | lobby | Fortnite |
| 6 | Bloom on emissive (sun/rings/predator) | High | Low | polish | web-UI |
| 7 | Per-mode 3D LUT color grade (warm Creative / cold Survival) | High | Low | polish | web-UI |
| 8 | Near-miss proximity multiplier (Superflight loop) | High | Low | survival | game-feel |
| 9 | Bankable combo w/ crash-to-lose tension | High | Low | survival | game-feel |
| 10 | Named trash-talking predator + persistent memory ("Skraah") | High | Low | survival | LLM×STDB |
| 11 | Legible L4D-style AI Director (HUD state chip) | High | Low | survival | LLM×STDB |
| 12 | Shared-flock lobby scene (room = perched birds) | High | Medium | lobby | Fortnite |
| 13 | TSL-native PostProcessing pipeline (foundation) | High | Medium | polish | web-UI |
| 14 | GSAP HUD + glassmorphism + animated leaderboard | High | Medium | dashboard | web-UI |
| 15 | Party panel + ready-up + single big PLAY | High | Medium | lobby | Fortnite |
| 16 | Vlambeer-grade juice on every flight beat | High | Medium | polish | game-feel |
| 17 | .io fast round + instant restart + live leaderboard | High | Medium | dashboard | game-feel |
| 18 | Boost economy charged by skill (near-miss = fuel) | High | Medium | survival | game-feel |
| 19 | Predator as Hades-style escalating variable threat | High | Medium | survival | game-feel |
| 20 | Collaborative flock combo (shared co-op score) | High | Medium | survival | game-feel |
| 21 | God-rays / volumetric shafts from low sun | High | Medium | polish | web-UI |
| 22 | Persistent 3D character in lobby (idle + orbit cam) | High | Medium | lobby | Fortnite |
| 23 | STDB time-travel replay → Claude "Legend" recap | High | Medium | dashboard | LLM×STDB |
| 24 | Dead-birds prediction market + Claude heckler | High | Medium | survival | LLM×STDB |
| 25 | Per-player secret LLM side-quests | High | Medium | survival | LLM×STDB |
| 26 | GPU compute particle wing-trails (per-player color) | High | High | polish | web-UI |
| 27 | Near-miss FX as central feedback (escalating callouts) | Medium | Low | dashboard | game-feel |
| 28 | Live leaderboard + spectate-the-leader (golden target) | Medium | Low | dashboard | game-feel |
| 29 | Game-grade typography (2 Google Fonts) | Medium | Low | polish | web-UI |
| 30 | AgX tone mapping + AA node | Medium | Low | polish | web-UI |
| 31 | Player identity front-and-center (nameplate + emoji) | Medium | Low | lobby | Fortnite |
| 32 | Prompt-driven stylized gradient skydome | Medium | Low | polish | web-UI |
| 33 | "Today's Flight" Claude theme-of-the-day card | Medium | Low | lobby | LLM×STDB |
| 34 | Speed-feel kit (speed-lines, motion blur, FOV punch) | Medium | Medium | polish | web-UI |
| 35 | Cel/toon + rim-light option | Medium | Medium | polish | web-UI |
| 36 | DoF + vignette + grain + chromatic aberration | Medium | Medium | polish | web-UI |
| 37 | WebGPU env probe → restore water reflections | Medium | Medium | polish | web-UI |
| 38 | Roguelite results card + meta XP profile row | Medium | Medium | dashboard | game-feel |
| 39 | Flock XP progression surface in lobby | Medium | Medium | lobby | Fortnite |
| 40 | Flow-tuned speed curve (ramping intensity) | Medium | Medium | survival | game-feel |
| 41 | Seamless lobby→match transition (no hard cut) | Medium | Medium | lobby | Fortnite |
| 42 | Daily/seasonal return hook (streak FOMO) | Medium | Medium | deploy | game-feel |

**Demo-safety (always do for Phase 4 deploy):** speculative-pregeneration / cached
world+predator config so a slow or failed Claude call never stalls the live pitch.
