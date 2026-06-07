# 🐦 FLOCKD

Fly a bird with a real aerodynamic flight model, with everyone else in the same world, in real time. Flap your arms at your webcam to climb, or use the keyboard if you'd rather not.

Live: https://flyflockd.vercel.app
Repo: https://github.com/mounishmavuduru-bot/Flockd

The whole backend is one SpacetimeDB module. There is no game server process, no REST API, no socket gateway. Clients connect straight to the database, and the database runs the simulation clock. The AI is not special either: it's another client that reads live rows and writes its decisions back as rows.

## Controls

- Webcam arm-flapping (MediaPipe pose detection, runs entirely in the browser)
- Keyboard
- Device tilt on phones

## Two modes

**Race.** The flock chases a ring course through a real place. Eight landmark maps ship as compressed GLB worlds served from Vercel Blob: Sydney Opera House, Niagara Falls, Himeji Castle, Christ the Redeemer, the Pantheon, Riomaggiore, the Ducal Palace, and the Indy 500.

**Survival.** Battle royale. One Claude-driven predator hawk named Skraah hunts whoever is in the lead and fires sabotage at them: wing-clip, fog, headwind. The point is to keep the pack bunched up so nobody runs away with it. If the hawk is on you, you can spend feathers on a **Feather Tithe** to buy a few seconds of mercy.

## Why the architecture is unusual

The pitch in one sentence: a SpacetimeDB 2.4.0 TypeScript module is the only backend, and Claude participates in the game by reading and writing the same rows players do. Here are the patterns that fall out of that, and why each one is worth a look.

### The AI is just another database client

Skraah's decisions and the live commentary are normal synced rows. A client subscribing to the database cannot tell an AI-written row from a player-written one. There is no API sitting between the game and the model, so there is nothing to keep in sync, version, or fall out of sync. The "integration surface" is the schema.

### An LLM inside the gameplay loop

Every 2.5 seconds, Claude reads the live `player` rows (positions, scores) and decides who to chase and which sabotage to fire. It writes the result back through reducers (`movePredator`, `emitSabotage`, `logDirector`). The model is reacting to the actual game state, not a canned script, and its output becomes part of the world the next tick simulates over.

### The hawk's log is its own next prompt

The `director_log` table holds the hawk's running history of decisions. That same table is the source for the dashboard's feed *and* the model's working memory: each call gets fed the recent log back as context. It's event-sourced agent memory with no vector store and no separate memory service. The database row is the memory.

### Live commentary the LLM computes from rows it never wrote

A second Claude agent reads `player`, `predator`, and `director_log` and emits one play-by-play line every 3.5 seconds, naming the actual current leader and the actual gap. Change the rows, and the next line changes. That's the proof it's reading the database and not reciting a template: the words track the numbers.

### Atomic Feather Tithe economy

Paying the tithe is a single ACID reducer. It spends feathers and credits a capped favor ledger in one transaction, and a per-tick decay sweep drains favor back down so mercy is temporary. There is no path where feathers get spent twice or favor gets credited without payment. The invariant holds by construction, not by careful client code.

### A read-only dashboard whose only backend is the database

`dashboard.html` is a standalone client called THE HUNT. It calls zero reducers. It subscribes to the AI's output rows and renders Claude's reasoning, a Canvas radar of the flock and the hawk, and a sabotage timeline. No endpoint, no extra service, just a subscription to the same tables. The database is the entire backend for a live ops dashboard.

### The scheduled tick is the world's heartbeat

A scheduled `tick` reducer runs inside the database and owns the things a server loop usually owns: win/loss checks, favor decay, and cleanup of abandoned rooms. Cleaning up a room also signals the sidecar to stop its Claude loops for that room, which caps API spend. The game clock lives in the database, not in an external timer.

## Identity and safety

Only the AI sidecar may call the AI-writing reducers. It claims a single identity at startup (`claimSidecar`) and every AI reducer checks it (`assertSidecar`). Player reducers only ever mutate the caller's own row via `ctx.sender`, so one player can't move another. Inputs are capped and validated: name, skin, color, and string lengths are bounded.

## Stack

- **SpacetimeDB 2.4.0** — TypeScript module, the only backend (tables, reducers, scheduled tick)
- **Three.js ^0.184** — WebGPU with a WebGL2 fallback, TSL post-processing
- **Claude `claude-haiku-4-5`** via **@anthropic-ai/sdk ^0.102** — forced tool use, cached system prompt, called off the 16ms flight path on its own intervals
- **Node sidecar** run with **tsx** — holds the Claude key, subscribes to live rows, writes results back
- **@mediapipe/tasks-vision** — in-browser webcam pose detection for the arm-flap controls
- **Vite ^5.4** — multi-page build (game + dashboard)
- **Vercel** for hosting, **Vercel Blob** for the heavy GLB worlds

## Run it locally

```bash
npm install
npm run dev                     # client at http://localhost:5173

# backend, in separate terminals
npm run stdb:start              # local SpacetimeDB
npm run stdb:publish:local      # build + publish the module
npm run stdb:gen                # generate TS client bindings → src/net/bindings
npm run sidecar                 # AI sidecar (needs ANTHROPIC_API_KEY in .env)
```

The sidecar reads `ANTHROPIC_API_KEY` from `.env`. Without it, the game and dashboard still run; you just won't have a predator or commentary.

## How the AI sidecar works

The sidecar is a small Node process. On startup it claims its sidecar identity, then opens a subscription to the live tables. On its own intervals (not the render loop) it runs two independent Claude loops:

1. **Director** — every 2.5s, reads `player` rows, sends them plus recent `director_log` to Claude with the move/sabotage tools, and writes the chosen action back through the gated reducers.
2. **Commentary** — every 3.5s, reads `player` + `predator` + `director_log` and asks Claude for one line of play-by-play, which it writes back as a row.

Both use a cached system prompt and forced `tool_use` so responses are structured and cheap. When the `tick` reducer cleans up an abandoned room, the sidecar stops that room's loops so it isn't paying Claude to narrate an empty world.

## Credits and license

Flight core, world rendering, and the tilt and pose controls are forked from [**pmmathias/birdybird**](https://github.com/pmmathias/birdybird). The repo is MIT (see [`LICENSE`](LICENSE)), with bundled third-party assets under their own terms:

- Ocean3.js / Ocean4.js water — CC BY-NC-SA 3.0, non-commercial; an MIT Gerstner-wave fallback is included for commercial use
- RedReddingtonForest — MIT
- Three.js, lil-gui — MIT; MediaPipe Tasks Vision — Apache 2.0
- Stork model and terrain textures — community / CC0 assets

Used here for a non-commercial hackathon with attribution, which is also shown in the in-app Credits overlay.
