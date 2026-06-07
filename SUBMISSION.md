# FLOCKD — submission

**Track:** SpacetimeDB × Claude
**Live:** https://flyflockd.vercel.app
**Repo:** https://github.com/mounishmavuduru-bot/Flockd
**Demo video script + shot cues:** [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

> Personal details below are marked `[like this]`. Fill those in before you submit — I didn't want to invent them.

## Title

FLOCKD

## Tagline

Flap your arms, fly a bird, and outrun a Claude-driven hawk.

## Short description (≈50 words)

FLOCKD is a multiplayer 3D bird-flight game with a real aerodynamic model, flown by webcam arm-flapping or keyboard. Race a flock through real landmark worlds, or survive a predator hawk that Claude controls by reading live game rows straight out of SpacetimeDB and writing its attacks back as ordinary synced data.

## Full description

FLOCKD is a multiplayer bird-flight game. You fly a real aerodynamic model, together or against other players in real time, by flapping your arms at a webcam (MediaPipe pose) or with keyboard and device tilt.

Two modes. RACE sends the whole flock around a ring course through real places — Sydney Opera House, Niagara Falls, Himeji Castle, eight Sketchfab landmark worlds in all. SURVIVAL is a battle royale stalked by one Claude-driven hawk named Skraah, who hunts the leader and fires sabotage (wing-clip, fog, headwind) to keep the pack tight. You spend feathers on a Feather Tithe to buy its mercy, and that mercy decays every tick.

Here's the part I'm proud of: the AI is just another database client. A small sidecar holds the Claude key, subscribes to live player positions and scores, calls Haiku 4.5 every 2.5 seconds, and writes the hawk's decisions back as plain synced rows. No API sits between the game and the model. Players can't tell an AI row from a human one. The hawk's own decision log is fed back as its next prompt, so one table is both the spectator feed and the model's memory. A second Claude agent reads rows it never wrote and calls the live race like an esports caster. A separate dashboard renders all of it by subscribing to those rows and calling zero reducers. The database is the whole interface.

## How we used SpacetimeDB and Claude

The full write-up with code references is in the [README](README.md#why-the-architecture-is-unusual). The short version:

- **The AI is just another DB client.** The hawk's moves and the live commentary are synced rows, identical in shape to player rows. There is no REST or socket API between the game and the model.
- **An LLM in the gameplay loop.** Claude reads live `player` rows every 2.5s and decides who to hunt and what sabotage to fire, then writes the decision back through sidecar-gated reducers.
- **The hawk's log is its own next prompt.** `director_log` is both the dashboard's history feed and the model's working memory — event-sourced agent memory with no external store.
- **Commentary from rows the model never wrote.** A second Claude agent names the real leader and the real gap every 3.5s. Move a player in raw SQL and the next line tracks it, which is the proof it's reading the DB, not a script.
- **Atomic Feather Tithe economy.** One ACID reducer spends feathers and credits a capped favor ledger; a per-tick decay sweep keeps mercy temporary. No dupes by construction.
- **A live dashboard with no backend of its own.** `dashboard.html` calls zero reducers and renders Claude's reasoning, a radar, and a sabotage timeline purely by subscription.
- **The scheduled tick is the world's heartbeat.** Win/loss, favor decay, and abandoned-room cleanup run inside the DB; cleanup also stops the sidecar's Claude loops, which caps API spend.

## About the builder

**Short:** I'm Mounish, `[student at X / role]`. I built FLOCKD, a multiplayer 3D bird-flight game where the whole backend is a SpacetimeDB module and Claude runs inside the database as just another client. You flap your arms at your webcam to fly. The AI narrates and hunts you. It's online at flyflockd.vercel.app.

**Longer:** I'm Mounish, `[student at X / role — short line on background]`. FLOCKD is a multiplayer 3D bird-flight game I built for the SpacetimeDB × Claude hackathon. The whole backend is one SpacetimeDB module: tables, reducers, and a scheduled tick. No separate server.

The part I'm proud of is the AI architecture. Instead of bolting an LLM onto the side, I run Claude Haiku 4.5 as just another database client. A small Node sidecar subscribes to game state, asks Claude what the predator should do and what to say, then writes those decisions back as rows that sync to every player. The director, the live commentary, the Feather Tithe economy, the subscription-only dashboard, the avatar system, eight landmark worlds, and the webcam arm-flap controls all hang off that.

Thanks to `[team name + members]` for the early testing and feedback. That's the build.

## Team

Thanks to `[team name + members]` for the early testing and feedback. (Build and write-up credited to Mounish.)

## Submission materials checklist

- [x] Project title — FLOCKD
- [x] Project description — above (short + full)
- [ ] Demo video — record from [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) (script, shot cues, and capture notes are ready)
- [x] Live demo — https://flyflockd.vercel.app
- [x] Source code — https://github.com/mounishmavuduru-bot/Flockd
- [x] Documentation / README — [README.md](README.md)
- [ ] Team / builder info — above (fill the `[placeholders]`)
