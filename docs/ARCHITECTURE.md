# FLOCKED — Architecture

> Multiplayer co-author + battle-royale bird-flight arcade.
> Flight core forked from [`pmmathias/birdybird`](https://github.com/pmmathias/birdybird) (vanilla JS + Three.js + WebGPU).
> Added pillars: **SpacetimeDB** backend, **Claude** (Haiku 4.5) for worlds & predators, **two multiplayer modes**.

## Two modes

### 🎨 Creative (collaborative)
Players co-author the level in the lobby. Each submits a prompt fragment
("pirate cove", "narrow canyons", "add lasers"). Claude fuses all fragments into a
single **schema-clamped, guaranteed-playable** world config (theme, palette, terrain
seed, obstacle/ring layout, hazards). Everyone then flies the *same* co-authored world.
→ Satisfies **collaborative + multiplayer + substantial-LLM** in one feature.

### 💀 Survival (battle royale)
Every bird for itself. Last bird flying / first to finish wins. An **LLM-driven predator
group** (hawks / hunting flock) is the antagonist: Claude reads the live match state every
~2–4 s and decides predator targeting + **sabotage events** that hinder players
(wing-clip → weaker flap, fog → reduced vision, headwind gust, scatter the flock).
→ LLM is the *adversary AI director*, not decoration.

## The latency rule (non-negotiable)
LLM calls (1–5 s) MUST NEVER sit on the 16 ms flight-input path.
- Creative world-gen runs **in the lobby** behind a "Forging your world…" screen.
- Survival predator "thinks" on a **2–4 s cooldown**; birds simulate at 60 fps locally.
- SpacetimeDB syncs **events + slow state**, never per-frame physics.
- Deterministic world from a shared **seed** → zero per-frame world sync.

## Components

```
┌─────────────────────────────┐   reducer calls    ┌──────────────────────────┐
│  CLIENT (vanilla JS+Three)  │ ─────────────────▶ │   SpacetimeDB MODULE     │
│  forked birdybird flight    │ ◀───────────────── │   (TS, v2.4)             │
│  + src/net/  (sync)         │   subscriptions    │   source of truth + sync │
│  + src/game/modes/          │                    └────────────┬─────────────┘
└─────────────────────────────┘                        subscribe │ ▲ reducer
            ▲ renders remote birds, world_config,                 │ │ (write back)
            │ predators from synced rows                          ▼ │
            │                                          ┌────────────────────────┐
            └──────────────────────────────────────── │  AI SIDECAR (Node)     │
                                                       │  subscribes as a client│
                                                       │  ANTHROPIC_API_KEY here │
                                                       │  creative: prompts→world│
                                                       │  survival: state→predator│
                                                       └───────────┬────────────┘
                                                                   │ HTTPS
                                                                   ▼
                                                            Claude Haiku 4.5
                                                    (structured outputs + prompt cache)
```

**Why the sidecar:** SpacetimeDB modules are sandboxed WASM — no outbound HTTP, so they
cannot call Claude. The sidecar is just another subscribed STDB client that holds the API
key, calls Claude, and writes results back via reducers. STDB stays the single source of
truth → multiplayer "just works" (everyone reads the same synced rows).

## SpacetimeDB data model (draft — see server/)

Tables (all `public` unless noted):
- `room(id, code, mode, state, seed, host, tick)` — state ∈ lobby|building|playing|over
- `player(identity PK, room_id, name, color, x,y,z, yaw,pitch,roll, alive, finished, score, online)`
- `lobby_prompt(id, room_id, player_identity, text)` — creative co-author fragments
- `world_config(room_id PK, json)` — Claude-generated level (written by sidecar)
- `predator(id, room_id, kind, x,y,z, target_identity, state)` — survival; sidecar-driven
- `sabotage_event(id, room_id, ts, kind, target_identity, payload, expires_at)` — survival
- `match_event(id, room_id, ts, kind, data)` — deaths / lead changes (commentary + recap)

Reducers:
- lifecycle: `client_connected`, `client_disconnected`
- `join_room(code, name, mode)`, `leave_room`
- `submit_prompt(text)` (creative)
- `start_build()` → state=building (sidecar reacts, calls Claude, writes config)
- `set_world_config(room_id, json)` (called by sidecar)
- `start_game()` → state=playing
- `update_transform(x,y,z,yaw,pitch,roll)` — **throttled** (~10–15 Hz), client-authoritative position
- `report_finish()`, `report_death()`
- `spawn_predator(...)`, `move_predator(...)`, `emit_sabotage(...)` (sidecar, survival)
- scheduled `game_tick()` (~10 Hz) — authority: timer, win/lose, predator expiry

**Granularity:** position is client-authoritative + throttled (arcade, anti-cheat is not a
hackathon concern). Scores/deaths/finishes go through validating reducers. Predator + world
are sidecar-written so the LLM is the only author of "AI" state.

## Client integration points (forked birdybird)
- `src/net/connection.js` — STDB connect/subscribe/reconnect, identity/token persistence
- `src/net/remoteBirds.js` — render + interpolate other players' storks
- `src/net/sync.js` — push local transform (throttled), apply server events
- `src/game/modes/creative.js` — lobby prompt UI, build flow, apply `world_config`
- `src/game/modes/survival.js` — battle-royale rules, predator entities, apply sabotage debuffs to `FlightPhysics`
- World: `WorldBuilder` reads `world_config` (theme/seed/obstacles) instead of pure local RNG

## LLM specifics (Claude)
- Model: `claude-haiku-4-5` (fast/cheap; world-gen & director are templated, not reasoning-heavy)
- **Structured outputs** (GA) — schema-constrained JSON; min/max clamps double as balance guardrails (gap height can't go unplayable)
- **Prompt caching** — big static system prompt (obstacle catalog, theme vocab, few-shots) cached; only player prompt varies
- Prompt-injection defense: player text wrapped as untrusted data; structured output means worst case is still valid level JSON
- Cooldowns + length caps enforced in the sidecar, never the browser. **API key never ships to client.**

## Licensing note
Forked from birdybird (see LICENSE). Vendor `src/vendor/Ocean3|Ocean4` (iFFT ocean) and
RedReddingtonForest are **CC BY-NC-SA (non-commercial)** / MIT respectively — fine for a
non-commercial hackathon with attribution; swap before any commercial use.
