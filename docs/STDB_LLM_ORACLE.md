# STDB_LLM_ORACLE — Claude reads the live DB and writes a synced row

**The judges' bar for this track:** an LLM reads the *already-filled* database and produces output that is a **function of rows the LLM did not write** (player transforms, deaths, the ledger, its own prior logs). That's the "not preplanned" proof — change the input rows, the output text changes on the next tick. The exhibit is a second screen (`dashboard.html`) subscribed to the LLM's output row, so a judge watches the model think with no API between them.

**What FLOCKD already has (grounding — verified in repo):**
- The **sidecar** (`services/ai-sidecar/index.ts`) is a privileged STDB client: it `claimSidecar()`s, subscribes to `room / player / predator / director_log / favor_ledger / world_config / lobby_prompt / sidecar`, runs a `setInterval` sweep, and calls Claude `claude-haiku-4-5` via **forced `tool_use`** (`survival.ts:238`).
- Cadences exist and keep Claude **off the 16 ms flight path**: `DIRECTOR_MS=2500`, `STEER_MS=160` (`survival.ts:19`).
- Sidecar-gated reducers (`assertSidecar`, `index.ts:228`) are the only writers of AI rows: `movePredator`, `emitSabotage`, `logDirector`, `setWorldConfig`. Every one fans out to clients as an ordinary synced row.
- The repeatable recipe: **add a sweep that SELECTs existing rows → Claude (own `setInterval`, forced tool_use, cached system block) → write a row back via a new sidecar-gated reducer → dashboard/game subscribes.** Nothing below touches per-frame sync.

Everything in `docs/UNIQUE_STDB.md` (ghost-replay, sim-in-tick, mind-killcam, hunter-memory, presence globe, spectate, atomic tithe, dashboard, time-travel) is **not repeated here**. This doc is the **LLM-as-DB-oracle** angle plus three genuinely new STDB capabilities (RLS hidden-info, the agent-memory loop, procedure-calls-Claude).

---

## Ranked idea table

`uniqueness` = why this is uniquely-STDB *or* a hard live-LLM proof. `R/W` = which rows it reads / the row it writes.

| # | Idea | Uniquely-STDB / LLM-live proof | Reads → Writes (rows) | Demo wow | Impact | Effort |
|---|------|--------------------------------|------------------------|----------|--------|--------|
| **O1** | **Live play-by-play COMMENTARY** | The single most legible "AI on live data" beat: the line names the *actual* current leader and *actual* gap. Swap who's leading → next line changes. Proof is one row that is a pure function of `player` rows the LLM never wrote. | **R:** `player` (x/y/z, speed, score, alive, finished), `predator`, `sabotage_event`, `director_log`. **W:** new `commentary(id, roomId, ts, line, excitement, refColor)` via new `logCommentary` | HUD/dashboard tickers the latest 3 lines; "WIND_BORN pulls two rings clear as Skraah peels off the gold one." Edit a position in `spacetime sql` → next line reflects it. | **Very high** | **Low** |
| **O2** | **The hawk's log is its OWN next prompt** — STDB as the agent's memory bus | True event-sourcing loop with zero glue: `director_log` is the LLM's action sink, memory store, *and* next observation feed — one subscription closes the loop. On a normal stack this is an external vector store / queue. | **R:** last N `director_log` rows for the room (already subscribed). **W:** richer `director_log` rows | Hawk references its own earlier taunt: "I promised the gold one I'd wait at the rings. I waited." Reasoning becomes a continuous narrative, not 1-shot reactions. | **Very high** | **Low** |
| **O3** | **NL→SQL QUERY over the live DB** ("who's winning and why?") | The textbook "LLM over a database" demo. Optional `sqlUsed` field literally shows the read-only `SELECT` the LLM wrote against live rows — the strongest "it read the database" exhibit. | **R:** `player / favor_ledger / director_log / predator` (sidecar already holds them in memory). **W:** `query_answer(id, roomId, asker, question, answer, sqlUsed)` | Ask mid-match, get an answer grounded in the values *right now*; `sqlUsed` shows the query the LLM authored. | **Very high** | Med |
| **O4** | **Post-match SAGA + MVP awards** | Narrated from the *actual ordered timeline* of rows (`director_log` history + deaths/finishes + final `score`). No two matches produce the same saga. Fires once on `room.state → over`; 1–3 s is invisible behind the scoreboard. | **R:** full `director_log` for room, `player` finals, `favor_ledger`. **W:** `match_saga(roomId, narrative, mvpIdentity)` + per-player `award(roomId, identity, title, citation)` | Shareable artifact: "at tick 412 you bought the hawk's mercy with your last 3 feathers, then died to fog 9 s later." | High | **Low** |
| **O5** | **Personalized COACHING / roast** from flight stats | Cites *your real numbers* (crash count, panic-turn direction, time-near-predator). Personal, data-derived, impossible to pre-write. Post-death one-shot, off the hot path. | **R:** your `player` + (if built) `transform_history`, `favor_ledger`, deaths. **W:** `coach_note(identity, roomId, tone, text)` | Death screen, addressed to *you*: "you bank right under pressure 80% of the time and crashed the same canyon twice." | High | Low–Med |
| **O6** | **ANOMALY / cheat explainer** over transform history | LLM reads numbers it never produced and *explains* the flag in NL. Cheap JS pre-filter finds candidate windows (LLMs are weak at raw numeric scanning, strong at explaining flagged ones). Judge-friendly: "AI auditing the DB's own history." | **R:** `transform_history` (proposed in UNIQUE_STDB #1 — this is the reason to build it). **W:** `flight_flag(id, roomId, identity, tick, kind, severity, explanation)` | Integrity panel: "teleport: 140 m in one tick, ~9× max flap speed — impossible." | High | Med (needs `transform_history`) |
| **O7** | **Predator dossier → taunts that reference your past** | Folds persistent cross-match `hunter_memory` (UNIQUE_STDB #4) into the *existing* director prompt. The taunt is provably a function of historical rows + live rows. | **R:** `hunter_memory` + live `player`. **W:** updated `hunter_memory` + richer `director_log.taunt` | Taunt fires *before* you dive: "you always break right when I close." | High | Med |
| **N1** | **Fog of War as RLS — the predator literally cannot see hidden birds** | NEW capability. RLS `client_visibility_filter` (unstable) filters rows *per subscriber, on the server, on the wire*. The hidden bird's row is **never sent** — cheating is impossible *by construction*, not obfuscation. The sidecar's identity is just another subscriber, so a cloaked bird vanishes from `conn.db.player.iter()` in `survival.ts:54` → Claude genuinely doesn't know you're there. | **R:** `player` (filtered per-sender). **W:** add `cloaked`/`cloakUntil` to `player`; `cloak()` reducer spends score | Cloak on stage; `director_log` reasoning stops mid-sentence: "where did the gold one—". Then `spacetime sql` *as owner* shows the bird still exists. | **Very high** | Med (RLS unstable — gate behind a flag; fall back to a `visible_player` view) |
| **N2** | **Reactive sidecar — the DB *pushes* the LLM awake** | NEW pattern. A subscription is a server→client push, so the per-room poll (`survival.ts:374`) is unnecessary: hang director logic off `room.onUpdate` / `player.onUpdate`. A **death row-update** fires an *immediate* re-think instead of waiting 2500 ms. The trigger lives in the DB, not a cron. | **R:** `room`, `player.alive` via existing callbacks. **W:** same director rows, fired on event | A bird dies → the hawk *instantly* taunts the next one. "The kill itself triggered the AI — the database pushed." | High | Low–Med |
| **N3** | **Procedure-as-oracle — the DB itself phones Claude** | NEW capability (beta). A **procedure** can do outbound `ctx.http.fetch` *from inside the database*, then `ctx.withTx` to write the answer back atomically. Collapses the sidecar into the DB. No other DB can call an LLM and commit the answer in one transaction. | **R:** match summary inside procedure. **W:** `predator` / `sabotage_event` / `director_log` via `ctx.withTx` | "There is no AI server. The database called Claude and wrote the hawk's mind back — one transaction." `spacetime logs` shows the HTTP call originating inside the module. | Very high | **High** (beta + risky live; keep sidecar as the safe path, show as a flex) |

---

## TOP 3 TO BUILD NEXT

### 🥇 #1 — O1 Live Commentary  ← single best pick
Highest wow-per-hour: it's the most legible "AI reading live data" beat, it reuses the survival sweep almost verbatim, and it touches **no client flight code** — just a HUD/dashboard ticker. **What a judge SEES:** a live ticker naming the *actual* leader and gap ("WIND_BORN pulls two rings clear as Skraah peels off the gold one"); edit a position in `spacetime sql` and the very next line reflects it — proof it's reading the DB, not a script.

### 🥈 #2 — O2 The hawk's log is its own next prompt
Near-zero effort (~15 lines in `buildSummary`), and it upgrades the *existing* director from 1-shot reactions to a continuous narrative — a huge perceived-intelligence jump for the cost. **What a judge SEES:** the hawk references its own earlier promise — "I said I'd ambush at the canyon — now I commit" — proving the LLM's memory and reasoning are just subscribable rows folded back in.

### 🥉 #3 — O3 NL→SQL query over the live DB
The textbook "LLM over a database" exhibit, and the `sqlUsed` field is the single most undeniable "it read the database" artifact. **What a judge SEES:** type "who's winning and why?" mid-match, get an answer grounded in current values, *and* the read-only `SELECT` the LLM wrote against the live tables shown beside it.

---

## Build plan for the #1 pick (O1 Live Commentary) — step by step on our exact stack

The whole feature mirrors the survival director: a new sweep reads existing rows, calls Claude on its own interval (off-frame, prompt-cached, forced tool_use), and writes one synced row the dashboard/HUD shows.

**1. Server — new table + new sidecar-gated reducer** (`server/spacetimedb/src/index.ts`)

```ts
/** AI commentary: Claude reads live match rows and emits a play-by-play line. */
const commentary = table(
  { name: 'commentary', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    line: t.string(),       // the play-by-play sentence
    excitement: t.f32(),    // 0..1, drives ticker pulse/color
    refColor: t.u32(),      // palette idx the line is about (HUD can highlight)
    createdAt: t.timestamp(),
  }
);
// add `commentary` to the schema({...}) object.

/** Sidecar logs a commentary line for the dashboard/HUD. Gated like logDirector. */
export const logCommentary = spacetimedb.reducer(
  { roomId: t.u64(), line: t.string(), excitement: t.f32(), refColor: t.u32() },
  (ctx, { roomId, line, excitement, refColor }) => {
    assertSidecar(ctx);                       // same gate as the director reducers
    ctx.db.commentary.insert({
      id: 0n, roomId,
      line: capStr(line, 160),                // reuse existing input hardening
      excitement: Math.max(0, Math.min(1, excitement)),
      refColor: refColor % 8,
      createdAt: ctx.timestamp,
    });
  }
);
```
Publish the module and regenerate bindings (`spacetime generate` → `src/net/bindings/`) so the sidecar gets `conn.reducers.logCommentary` and the dashboard gets the `commentary` table.

**2. Sidecar — a new commentary sweep** (`services/ai-sidecar/`, e.g. `commentary.ts`)

Clone the director's two-rate shape but with **only** the LLM tick (no steering). Run it on its **own** `setInterval` (~3500 ms) so it never contends with `DIRECTOR_MS`. Reuse `alivePlayers`, `ringsForRoom`, `remainingToFinish`, `dist3` from `survival.ts` (export them) to build the summary.

- Prompt: a **cached** system block ("You are the FLOCKD commentator…") + a compact per-tick state delta (leader, gap to 2nd, predator target, last taunt). Forced `tool_use` returning `{ line, excitement, refColor }` — same reliable pattern as `directWithClaude` (`survival.ts:238`).
- The summary input is *built from rows the LLM did not write* (player positions/scores, predator target, the latest `director_log` taunt) — that's the live proof.
- Always-on fallback: a `mockCommentary()` (like `directMock`) so the ticker has content with no API key.
- Write back: `conn.reducers.logCommentary({ roomId, line, excitement, refColor })`.

**3. Wire the lifecycle** (`services/ai-sidecar/index.ts`)
- Subscribe to the new table (and `director_log` if not already needed for the prompt): add `'SELECT * FROM commentary'` to the `subscribe([...])` list (`index.ts:136`).
- In `survivalSweep`, alongside `startSurvivalDirector`, call `startCommentary(conn, r)`; in the teardown branch call `stopCommentary(roomId)`. (Commentary can also run for **creative** rooms — gate on `state==='playing'` rather than `mode`, to widen the demo.)

**4. Show it** (`src/dashboard/main.js` and/or the in-game HUD)
- Dashboard subscribes `SELECT * FROM commentary WHERE roomId = X`, sorts by `createdAt`, renders the latest 3 lines as a ticker; pulse/color by `excitement`, highlight `refColor`.
- In-game HUD (`index.html` flow) can show the single latest line.

**5. Prove it live (the judge moment)**
- Open the dashboard next to the game. Lines name the real leader and gap, updating every few seconds.
- `spacetime sql flocked "UPDATE player SET x = 9999 WHERE name = '<someone>'"` (or just play) → the *next* commentary line reflects the new standings. "The model is reading the database, not following a script."
- `spacetime sql flocked "SELECT line FROM commentary WHERE roomId = <id> ORDER BY created_at DESC LIMIT 5"` shows the corpus is real, durable DB state — replayable like everything else in FLOCKD.

**Why this is safe for a live demo:** identical architecture to the shipped survival director (own interval, off the 16 ms path, mock-first fallback, sidecar-gated write), so it inherits the same reliability guarantees. No new failure mode on the flight path.
