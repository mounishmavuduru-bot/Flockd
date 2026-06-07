# FLOCKD — Survival Mode + LLM Predator (design spec)

Source of truth for the survival build **and** the LLM-thinking dashboard. The
predator is driven by Claude; SpacetimeDB only fans the decisions out. Claude is
**never** on the per-frame path (see latency rule in ARCHITECTURE.md).

## The loop (what the player experiences)
1. Host picks **Survival** in the shell → creates room → presses **START MATCH**.
2. Room goes `lobby → building → playing` — the AI sidecar generates a course
   (reuse `worldgen`, survival-flavored seed/prompt: tighter, more vertical).
3. All birds race the ring course. **But** a Claude-driven **predator hawk**
   (later: a small hunting group) hunts whoever is closest to winning and fires
   **sabotages** to keep the pack bunched and the leader suppressed.
4. You're **eliminated** if the predator stays on you inside catch-range too long
   (or you crash). Eliminated → spectate.
5. **Win** = first to finish the course, or last bird flying.
6. Postgame scoreboard → Play Again → back to the shell.

## Two-rate control (keeps Claude off the 16 ms path)
- **Director tick (~2.5 s, Claude):** reads the match state, **thinks**, and emits
  a decision: which player to hunt, a behavior, an optional sabotage + a short
  human-readable *reason* + a *taunt*. Its reasoning is logged for the dashboard.
- **Steering tick (~6 Hz, no LLM):** sidecar seeks the predator toward its current
  target (simple steering) and writes the predator transform. Smooth, cheap,
  deterministic between Claude calls.

## New tables (extend `server/spacetimedb/src/index.ts`)
```
predator        (public)
  roomId        u64  primaryKey         // one predator per room (group = phase 2)
  x,y,z         f32
  yaw           f32
  targetPlayer  identity                // who it's hunting (zero-ish = none)
  behavior      string                  // 'chase' | 'intercept' | 'patrol' | 'ambush'
  speed         f32
  active        bool
  updatedAt     timestamp

sabotage_event  (public, EVENT table: event:true)   // client applies on onInsert
  id            u64  primaryKey autoInc
  roomId        u64  index btree
  target        identity                // who gets debuffed
  kind          string                  // 'wingclip' | 'fog' | 'headwind' | 'scatter'
  magnitude     f32                     // 0..1 strength
  durationMs    u32
  reason        string                  // Claude's short justification (shown in HUD + dashboard)
  createdAt     timestamp

director_log    (public TABLE — dashboard loads history + live)
  id            u64  primaryKey autoInc
  roomId        u64  index btree
  tick          u64
  targetName    string                  // display name of the hunted bird
  behavior      string
  sabotageKind  string                  // '' if none this tick
  reasoning     string                  // Claude's distilled thinking ("why")
  taunt         string                  // in-character line ("the gold one flies too clean…")
  createdAt     timestamp
```

## New reducers (sidecar = privileged author; clients only self-report)
- `spawnPredator(roomId)` — sidecar, on survival room → `playing`. Upsert predator row (active, centered, no target).
- `movePredator(roomId, x, y, z, yaw, targetPlayer, behavior, speed)` — sidecar steering tick.
- `emitSabotage(roomId, target, kind, magnitude, durationMs, reason)` — sidecar inserts a `sabotage_event`.
- `logDirector(roomId, tick, targetName, behavior, sabotageKind, reasoning, taunt)` — sidecar writes a `director_log` row.
- `despawnPredator(roomId)` — on room → `over`/empty.
- Reuse existing `reportDeath` for elimination (client self-reports when the predator
  parks inside catch-range for `CATCH_SECONDS`, or on terrain crash).

Auth note: these are sidecar-authored. For the hackathon we don't gate by identity
(the sidecar connects as an ordinary privileged client); a `// TODO authz` is fine.

## Client (survival)
- `src/net/predator.js` — render the predator hawk from the synced `predator` row
  (reuse a tinted/black `BirdModel` scaled up, menacing; interpolate like remote birds).
  Detect proximity → if within `CATCH_RADIUS` of my bird for `CATCH_SECONDS`, call
  `reportDeath`. Show a red "HUNTED" vignette when I am the `targetPlayer`.
- `src/net/sabotage.js` — subscribe to `sabotage_event`; on a row targeting me, apply
  a timed debuff to `FlightPhysics` and surface a toast with the `reason`.
- `FlightPhysics` debuff hooks (additive, default no-op):
  - `wingclip`  → flap/lift power × (1 − magnitude) for duration
  - `headwind`  → constant backward accel ∝ magnitude
  - `scatter`   → small random roll/pitch jitter
  - `fog`       → client visual only (thicken local fog / shrink far plane); no physics
  Implement as a small `DebuffState` the physics reads each frame; expiry by timestamp.
- Survival wiring in `NetClient` (`_driveSurvival`): on `playing`, ensure predator +
  sabotage subscriptions, render predator, run the course (reuse RingCourse), elimination,
  win/over detection → `showResults`.

## Sidecar (`services/ai-sidecar/`)
- `survival.ts` — the director. Per playing survival room:
  - steering tick (6 Hz): seek predator → target, `movePredator`.
  - director tick (2.5 s): build a compact state summary (each bird: name, color, rings
    left, dist-to-predator, alive; predator pos), call Claude **with extended thinking**
    + a forced `direct_hunt` tool → `{ targetColor, behavior, sabotage?: {kind, magnitude, durationMs, reason}, taunt }`.
    Capture a distilled `reasoning` from the thinking. Then `movePredator` (retarget),
    optional `emitSabotage`, and `logDirector(reasoning, taunt, …)`.
  - Mock fallback (no key / error): heuristic director (target = closest-to-finish,
    behavior=chase, occasional headwind) with a templated reasoning string so the
    dashboard still has content. Same standing "mock-first" guarantee as worldgen.
- `worldgen` reuse for the survival course (a survival system-prompt variant or a
  fixed "gauntlet" prompt). Sidecar generates the world on `building` for BOTH modes.

## Director Claude contract (tool_use, like worldgen)
System: "You are THE HUNT — the predator director in FLOCKD. Keep the match tense and
close: suppress whoever is about to win, herd the flock, never let one bird run away.
You may chase/intercept/patrol/ambush and fire ONE sabotage per tick. Think briefly,
then call direct_hunt." Tool `direct_hunt` input schema:
```
{ targetColor:int(0..7), behavior:enum, sabotage?:{kind:enum, magnitude:0..1, durationMs:int, reason:string}, taunt:string }
```
Use `thinking` (extended) → distill 1–2 sentences into `reasoning` for the log.

## Dashboard (separate site — see DASHBOARD task)
A standalone page subscribing to `director_log` + `predator` + `player` for a room,
visualizing in real time: the predator's current target, behavior, the live reasoning
feed ("why"), sabotage timeline, and taunts — proof to judges the LLM is genuinely
driving the hunt. Read-only client; never calls reducers.

## Demo guardrails
- Cache/seed a fallback so a Claude hiccup never freezes the predator (mock director).
- Tunables up top: `DIRECTOR_MS=2500`, `STEER_HZ=6`, `CATCH_RADIUS=18`, `CATCH_SECONDS=2.2`,
  `PREDATOR_SPEED≈ player top speed × 0.92` (catchable-but-scary; never strictly faster).
