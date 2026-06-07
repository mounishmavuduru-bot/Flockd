# FLOCKD — "THE HUNT" Live AI Dashboard (judge-facing transparency site)

A standalone, read-only page that proves the LLM is genuinely driving the survival
predator in real time. Judges watch Claude *think* and *act* live. This is the
"substantial LLM use" pillar made **visible**.

## Why
Emergent AI behavior is invisible unless you surface it. The predator's every
decision is already written to SpacetimeDB rows (`director_log`, `predator`,
`sabotage_event`). The dashboard just subscribes and renders them — same data the
game uses, zero new backend, second collaboration/visualization surface.

## Form factor
- A **second Vite entry**: `dashboard.html` at repo root → `src/dashboard/main.js`.
  (Vite multi-page: add `dashboard.html` and a `build.rollupOptions.input` map, or
  it's auto-included as a root `.html`.) Same deploy, same origin, reuses
  `src/net/bindings` + `src/net/connection.js`. NO Three.js — pure DOM/Canvas2D, light.
- Open with `?room=CODE` to watch a specific match (defaults to the most recent
  active survival room if omitted).

## What it shows (read-only; NEVER calls a reducer)
Subscribe to: `SELECT * FROM director_log`, `SELECT * FROM predator`,
`SELECT * FROM player`, `SELECT * FROM room`, `SELECT * FROM sabotage_event`.

1. **Header** — room code, mode, tick, # alive, a pulsing "● LIVE" indicator + the
   predator persona name ("SKRAAH — THE HUNT").
2. **Current decision card** — the latest `director_log` row, big: current TARGET
   (colored name chip), BEHAVIOR (chase/intercept/patrol/ambush) as a state badge,
   and the active SABOTAGE if any (kind + magnitude bar).
3. **Reasoning feed** — a live, auto-scrolling stream of `director_log.reasoning`
   ("why") entries, newest on top, timestamped, with the `taunt` rendered as an
   in-character speech line. This is the centerpiece — judges literally read the
   model's logic as it hunts.
4. **Sabotage timeline** — `sabotage_event` rows as a horizontal time strip
   (icon per kind: ✂️ wingclip · 🌫️ fog · 💨 headwind · 🎲 scatter) with target +
   reason on hover.
5. **Mini radar (Canvas2D)** — top-down dots: birds (their palette colors) + the
   predator (red), updated from `predator`/`player` rows. A line from predator → its
   target. Cheap, ~80 lines, huge "it's really tracking them" payoff.
6. **AI Director state chip** — the L4D-style buildup/peak/relax read off behavior +
   sabotage cadence (derive client-side from recent rows).

## Build notes
- Reuse `connectToFlocked` from `src/net/connection.js` (persist a distinct token key
  e.g. `flockd.dashboard.token` so it doesn't clash with a player tab).
- All user/model text via `textContent` (XSS-safe) — `reasoning`/`taunt`/names are
  model- and user-authored.
- Keep last ~40 reasoning rows in the DOM (prune) so a long match doesn't bloat.
- Style to match the shell: dark navy→violet, neon accents, monospace for the
  reasoning feed (terminal-of-the-mind vibe).
- Graceful empty state: "Waiting for a survival match… start one in the game."

## Deploy
Ships in the same Vercel build as the game (second page). Link to it from the
survival results screen ("watch the hunt's mind →") and from the game HUD.
