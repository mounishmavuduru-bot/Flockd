# FLOCKED — Build Plan

Vertical-slice-first: demoable at every phase. Forked flight core already runs.

## Phase 0 — Foundation ✅ (in progress)
- [x] Fork birdybird → `~/flocked`, strip author's personal files, fresh git
- [x] Scaffold dirs: `src/net/`, `src/game/modes/`, `services/ai-sidecar/`, `server/` (next), `docs/`
- [x] `package.json` rename + add `spacetimedb` dep + STDB/sidecar scripts
- [x] `npm install`, verify forked base still builds (`npm run build`)
- [x] First commit

## Phase 1 — Netcode base (hardest infra; everything builds on it)
- [x] `spacetime init` TS module in `server/` (TypeScript, v2.4)
- [x] Tables: `room`, `player`, `tick_timer`; reducers: join/leave/lifecycle/`update_transform`/`start_game`/finish/death; scheduled `tick`
- [x] `spacetime start` (local) + publish (`flocked` db) + `stdb:gen` bindings → `src/net/bindings`
- [x] Backend validated end-to-end via CLI (join_room → room+player rows; start_game → state=playing)
- [x] `src/net/connection.js` connect + token persistence (reconnect as same identity)
- [x] `src/net/remoteBirds.js` render+interpolate other storks (reuses BirdModel + tint palette)
- [x] `src/net/index.js` NetClient: throttled (12 Hz) transform push + per-frame remote reconcile
- [x] Wire net into `main.js` (opt-in `?room=CODE&name=&mp=creative|survival`; G = host start)
- [x] **Slice validated at network layer:** `test/mp-smoke.ts` — 2 real clients join 1 room, B sees A's synced transform <100ms, liveMembers=2 ✅
- [ ] Visual confirm in browser (2 tabs) — needs a human; dev server + local STDB are running

### Phase 1 — known refinements (do in Phase 2 lobby work)
- Count room members via live `online && roomId==X` filter instead of stored `playerCount` (reconnect-robust)
- onConnect should restore room membership / onDisconnect grace timer

## Phase 2 — Creative mode + LLM #1 (co-authored world)
- [x] Tables: `lobby_prompt`, `world_config`; reducers `submit_prompt`, `start_build`, `set_world_config` (+ `beginPlaying` helper)
- [x] AI sidecar (`services/ai-sidecar/`): subscribe → on `building`, fuse prompts → world JSON → `set_world_config` → room goes `playing`
- [x] `worldgen.ts`: deterministic MOCK generator + Claude Haiku 4.5 path (structured output, prompt cache), drop-in via `ANTHROPIC_API_KEY`
- [x] **Verified:** `test/creative-smoke.ts` — prompt "spooky frozen narrow canyons at night" → theme=night, 14 rings, synced + room `playing` in 300ms. PASS
- [ ] Lobby UI (client): room code, player list, prompt box, host "Forge World" + "Forging your world…" screen
- [ ] Client consumes `world_config`: apply sky/fog/water palette + spawn the ring course; race = fly the rings
- [ ] **Slice demo:** group types prompts → world recolors + course appears → everyone races it

## Phase 3 — Survival mode + LLM #2 (battle royale + predator)
- [ ] Battle-royale rules in `survival.js` (last-bird/first-finish, elimination)
- [ ] Tables/reducers: `predator`, `sabotage_event`, `spawn/move_predator`, `emit_sabotage`
- [ ] Predator entity render (hawk/hunting flock) + interpolation
- [ ] Sabotage debuffs hooked into `FlightPhysics` (wing-clip, fog, headwind, scatter)
- [ ] Sidecar survival loop: read state every 2–4 s → Claude director → predator moves + sabotage
- [ ] **Slice demo:** birds race; Claude-driven hawks hunt the leader + sabotage to keep it close

## Phase 4 — Polish + deploy
- [ ] Optional LLM #3: live commentator / post-match MVP awards
- [ ] Lobby/HUD polish, mode select, spectator on death
- [ ] Deploy: STDB module → Maincloud; client → Vercel/Pages; sidecar → small Node host
- [ ] Demo script + fallback (cached world config so a live Claude hiccup never blocks the pitch)

## Open decisions (defaults chosen, override anytime)
- Module language: **TypeScript** (one language w/ client). Rust fallback if TS module APIs bite.
- Game name: **FLOCKED** (working title).
- Position sync: client-authoritative, ~12 Hz throttle (arcade; no anti-cheat needed for hackathon).
