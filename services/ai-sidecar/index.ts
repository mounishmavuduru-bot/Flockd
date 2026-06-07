/**
 * FLOCKED AI sidecar.
 *
 * A privileged SpacetimeDB client that watches for rooms entering the
 * 'building' state, generates a level config (Claude or mock), and writes it
 * back via the setWorldConfig reducer — which flips the room to 'playing'.
 *
 * This is where the ANTHROPIC_API_KEY lives (never in the browser). STDB modules
 * are sandboxed and cannot make outbound HTTP, so the LLM call happens here and
 * the result is fanned out to all players as an ordinary synced row.
 *
 * Run: npm run sidecar   (needs local STDB running + module published)
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DbConnection } from '../../src/net/bindings';
import { generateWorld } from './worldgen';
import { startSurvivalDirector, stopSurvivalDirector } from './survival';
import { startCommentary, stopCommentary } from './commentary';

const URI = process.env.STDB_URI || 'ws://localhost:3000';
const DB = process.env.STDB_DB || 'flocked';
const SWEEP_MS = 500;

const inFlight = new Set<string>();
// Rooms whose survival director loops are currently running (keyed by roomId string).
const survivalStarted = new Set<string>();
// Rooms whose live-commentary loops are currently running (keyed by roomId string).
// Runs for ANY playing room (creative AND survival).
const commentaryStarted = new Set<string>();

// Persist the sidecar's STDB identity token so it reconnects as the SAME identity
// across restarts — required for the server's claimSidecar() gate to keep working.
// Tokens are per-STDB-instance, so key the file by target: a local token is
// Unauthorized on maincloud and vice-versa. Local keeps the original filename.
const TOKEN_SUFFIX = /localhost|127\.0\.0\.1/.test(URI) ? '' : '-' + URI.replace(/[^a-z0-9]/gi, '');
const TOKEN_FILE = resolve(process.cwd(), '.sidecar-token' + TOKEN_SUFFIX);
function loadToken(): string | undefined {
  try { return existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() || undefined : undefined; } catch { return undefined; }
}
function saveToken(tok: string) {
  try { writeFileSync(TOKEN_FILE, tok, 'utf8'); } catch (e: any) { console.warn('[sidecar] could not persist token:', e?.message || e); }
}

function findWorldConfig(conn: any, roomId: bigint) {
  for (const w of conn.db.worldConfig.iter()) if (w.roomId === roomId) return w;
  return null;
}

async function sweep(conn: any) {
  for (const r of conn.db.room.iter()) {
    if (r.state !== 'building') continue;
    const cfg = findWorldConfig(conn, r.id);
    if (cfg && cfg.status === 'ready') continue;
    const key = r.id.toString();
    if (inFlight.has(key)) continue;
    inFlight.add(key);

    const prompts = [...conn.db.lobbyPrompt.iter()]
      .filter((p: any) => p.roomId === r.id)
      .map((p: any) => p.text);
    console.log(`[sidecar] building room ${r.code} (${r.mode}) from ${prompts.length} prompt(s):`, prompts);

    try {
      const level = await generateWorld(prompts, Number(r.seed));
      conn.reducers.setWorldConfig({ roomId: r.id, json: JSON.stringify(level) });
      console.log(`[sidecar] ✦ world ready for ${r.code}: theme="${level.theme}", ${level.rings.length} rings, gravity ${level.gravityScale}`);
    } catch (e: any) {
      console.error('[sidecar] generation failed:', e?.message || e);
    } finally {
      inFlight.delete(key);
    }
  }
}

/**
 * Survival lifecycle sweep — runs alongside the world-gen sweep.
 *
 * The world-gen sweep already builds a course for ALL 'building' rooms (creative
 * AND survival), so survival rooms get a world too. THIS sweep only manages the
 * predator + Claude director:
 *
 *  - A survival room transitions to 'playing' when setWorldConfig flips it (the
 *    server's start path sets state='playing'). We detect that transition by
 *    scanning live `room` rows for mode==='survival' && state==='playing'. The
 *    first time we see such a room that we haven't started, we spawn the predator
 *    ONCE and start the director loops.
 *  - When a started room is no longer 'playing' (state moved to 'over', or the
 *    room row disappeared entirely), we stop the loops and despawn the predator.
 */
function survivalSweep(conn: any) {
  // Snapshot the set of survival rooms that are currently 'playing'.
  const playingNow = new Set<string>();

  for (const r of conn.db.room.iter()) {
    if (r.mode !== 'survival') continue;
    if (r.state !== 'playing') continue;
    const k = r.id.toString();
    playingNow.add(k);

    if (!survivalStarted.has(k)) {
      // First time this survival room is playing → spawn predator + start director.
      try {
        conn.reducers.spawnPredator({ roomId: r.id });
        startSurvivalDirector(conn, r);
        survivalStarted.add(k);
        console.log(`[sidecar] survival predator spawned + director started for room ${r.code}`);
      } catch (e: any) {
        console.error('[sidecar] failed to start survival director:', e?.message || e);
      }
    }
  }

  // Tear down any started room that is no longer playing (state changed or gone).
  for (const k of [...survivalStarted]) {
    if (playingNow.has(k)) continue;
    const roomId = BigInt(k);
    try {
      stopSurvivalDirector(roomId);
      conn.reducers.despawnPredator({ roomId });
      console.log(`[sidecar] survival director stopped + predator despawned for room ${k}`);
    } catch (e: any) {
      console.error('[sidecar] failed to stop survival director:', e?.message || e);
    } finally {
      survivalStarted.delete(k);
    }
  }
}

/**
 * Live-commentary lifecycle sweep — runs alongside the world-gen + survival
 * sweeps. Unlike the survival sweep, this fires for ANY room that is 'playing'
 * (creative AND survival), so the esports-caster feed is live in every match.
 *
 *  - The first time we see a room in state==='playing' that we haven't started,
 *    we start its commentary loop ONCE.
 *  - When a started room is no longer 'playing' (state moved on, or the row
 *    disappeared), we stop the loop.
 */
function commentarySweep(conn: any) {
  const playingNow = new Set<string>();

  for (const r of conn.db.room.iter()) {
    if (r.state !== 'playing') continue;
    const k = r.id.toString();
    playingNow.add(k);

    if (!commentaryStarted.has(k)) {
      try {
        startCommentary(conn, r);
        commentaryStarted.add(k);
      } catch (e: any) {
        console.error('[sidecar] failed to start commentary:', e?.message || e);
      }
    }
  }

  // Tear down any started room that is no longer playing (state changed or gone).
  for (const k of [...commentaryStarted]) {
    if (playingNow.has(k)) continue;
    try {
      stopCommentary(BigInt(k));
    } catch (e: any) {
      console.error('[sidecar] failed to stop commentary:', e?.message || e);
    } finally {
      commentaryStarted.delete(k);
    }
  }
}

function connect() {
  const builder = DbConnection.builder().withUri(URI).withDatabaseName(DB);
  const saved = loadToken();
  if (saved) builder.withToken(saved);
  builder
    .onConnect((conn: any, identity: any, token: string) => {
      if (token) saveToken(token);
      console.log('[sidecar] connected as', identity.toHexString().slice(0, 8));
      // Register as THE sidecar so identity-gated survival/world reducers accept us.
      try { conn.reducers.claimSidecar(); } catch (e: any) { console.warn('[sidecar] claimSidecar failed:', e?.message || e); }
      conn.subscriptionBuilder()
        .onApplied(() => console.log('[sidecar] subscribed; watching for building/playing rooms'))
        .subscribe([
          'SELECT * FROM room',
          'SELECT * FROM lobby_prompt',
          'SELECT * FROM world_config',
          'SELECT * FROM player',
          'SELECT * FROM predator',
          'SELECT * FROM sidecar',
          'SELECT * FROM favor_ledger',
          'SELECT * FROM director_log',
          'SELECT * FROM commentary',
        ]);
      setInterval(() => {
        sweep(conn);
        survivalSweep(conn);
        commentarySweep(conn);
      }, SWEEP_MS);
    })
    .onConnectError((_c: any, err: any) => console.error('[sidecar] connect error:', err))
    .onDisconnect(() => {
      console.warn('[sidecar] disconnected; reconnecting in 2s');
      setTimeout(connect, 2000);
    })
    .build();
}

connect();
console.log(`[sidecar] FLOCKED AI sidecar online. STDB=${URI}/${DB}. LLM=${process.env.ANTHROPIC_API_KEY ? 'Claude (live)' : 'MOCK'}`);
