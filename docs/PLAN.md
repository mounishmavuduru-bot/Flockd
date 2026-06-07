# FLOCKED — Build Plan

Vertical-slice-first: demoable at every phase. Forked flight core already runs.

## Phase 0 — Foundation ✅ (in progress)
- [x] Fork birdybird → `~/flocked`, strip author's personal files, fresh git
- [x] Scaffold dirs: `src/net/`, `src/game/modes/`, `services/ai-sidecar/`, `server/` (next), `docs/`
- [x] `package.json` rename + add `spacetimedb` dep + STDB/sidecar scripts
- [ ] `npm install`, verify forked base still builds (`npm run build`)
- [ ] First commit

## Phase 1 — Netcode base (hardest infra; everything builds on it)
- [ ] `spacetime init` TS module in `server/`
- [ ] Tables: `room`, `player`; reducers: join/leave/lifecycle/`update_transform`; scheduled `game_tick`
- [ ] `spacetime start` (local) + publish + `stdb:gen` bindings
- [ ] `src/net/connection.js` connect/subscribe/reconnect (+ token persistence)
- [ ] `src/net/remoteBirds.js` render+interpolate other storks
- [ ] `src/net/sync.js` throttled local transform push
- [ ] **Slice demo:** 2 browser tabs = 2 storks flying in the same world, seeing each other

## Phase 2 — Creative mode + LLM #1 (co-authored world)
- [ ] Lobby UI: room code, join, prompt box, "ready"/start
- [ ] Reducers: `submit_prompt`, `start_build`, `set_world_config`, `start_game`
- [ ] AI sidecar: subscribe → on `building`, fuse prompts → Claude structured level JSON → `set_world_config`
- [ ] `WorldBuilder` consumes `world_config` (theme/seed/obstacles)
- [ ] "Forging your world…" lobby screen (hides latency)
- [ ] **Slice demo:** group types prompts → Claude builds one world → everyone races it

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
