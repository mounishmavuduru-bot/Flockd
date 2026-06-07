# 🐦 FLOCKED

**Multiplayer co-author + battle-royale bird-flight arcade.**
Fly a stork with a real aerodynamic flight model — together or against each other.

Built for a hackathon on three pillars:
- 🤝 **Multiplayer / collaborative** — real-time, backed by [SpacetimeDB](https://spacetimedb.com)
- 🧠 **Substantial LLM use** — [Claude](https://claude.com) (Haiku 4.5) builds the worlds *and* drives the predators
- ⚙️ **SpacetimeDB backend** — tables + reducers are the single source of truth & sync layer

## Two modes
- 🎨 **Creative** — everyone drops a prompt in the lobby; Claude fuses them into one
  guaranteed-playable world; the whole flock races the level *they co-authored*.
- 💀 **Survival** — battle royale, every bird for itself, while a Claude-driven
  **predator group** hunts the leader and unleashes sabotage (wing-clip, fog, headwind)
  to keep the pack close.

## Stack
Vanilla JS + Three.js (WebGPU→WebGL2) flight client · SpacetimeDB (TS module) ·
Node AI sidecar (holds the Claude key, writes results back as synced rows).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/PLAN.md`](docs/PLAN.md).

## Dev
```bash
npm install
npm run dev            # client → http://localhost:5173/birdybird/   (base path; renamed later)

# backend (separate terminals)
npm run stdb:start              # local SpacetimeDB
npm run stdb:publish:local      # build + publish the module
npm run stdb:gen                # generate TS client bindings → src/net/bindings
npm run sidecar                 # AI sidecar (needs ANTHROPIC_API_KEY)
```

## Credits
Flight core, world rendering, and tilt/pose controls forked from
[**pmmathias/birdybird**](https://github.com/pmmathias/birdybird) — see [`LICENSE`](LICENSE).
Vendor ocean (Ocean3/4, CC BY-NC-SA) and forest (RedReddingtonForest, MIT) retain their
original licenses; used here for a non-commercial hackathon with attribution.
