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
import { DbConnection } from '../../src/net/bindings';
import { generateWorld } from './worldgen';

const URI = process.env.STDB_URI || 'ws://localhost:3000';
const DB = process.env.STDB_DB || 'flocked';
const SWEEP_MS = 500;

const inFlight = new Set<string>();

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

function connect() {
  DbConnection.builder()
    .withUri(URI)
    .withDatabaseName(DB)
    .onConnect((conn: any, identity: any) => {
      console.log('[sidecar] connected as', identity.toHexString().slice(0, 8));
      conn.subscriptionBuilder()
        .onApplied(() => console.log('[sidecar] subscribed; watching for building rooms'))
        .subscribe(['SELECT * FROM room', 'SELECT * FROM lobby_prompt', 'SELECT * FROM world_config']);
      setInterval(() => sweep(conn), SWEEP_MS);
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
