/**
 * Creative-mode smoke test — proves the full AI-sidecar loop:
 *   client joins → submits prompt → host startBuild → sidecar generates a
 *   world (mock or Claude) → setWorldConfig → room flips to 'playing' with a
 *   playable ring course synced to the client.
 *
 * Prereqs: local STDB + module published + sidecar running (npm run sidecar).
 * Run: npx tsx test/creative-smoke.ts
 */
import { DbConnection } from '../src/net/bindings';

const URI = 'ws://localhost:3000';
const DB = 'flocked';
const ROOM = ('B' + (Date.now() % 100000)).toUpperCase(); // fresh room each run

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeClient(): Promise<any> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((c: any, identity: any) => {
        c.subscriptionBuilder()
          .onApplied(() => resolve({ conn: c, identity }))
          .subscribe(['SELECT * FROM room', 'SELECT * FROM player', 'SELECT * FROM world_config', 'SELECT * FROM lobby_prompt']);
      })
      .onConnectError((_c: any, e: any) => reject(e))
      .build();
    setTimeout(() => reject(new Error('connect timeout')), 10000);
  });
}

async function main() {
  console.log(`[creative] room=${ROOM}`);
  const H = await makeClient();
  console.log('[creative] host connected', H.identity.toHexString().slice(0, 8));

  H.conn.reducers.joinRoom({ code: ROOM, name: 'Host', mode: 'creative' });
  await sleep(400);
  H.conn.reducers.submitPrompt({ text: 'spooky frozen narrow canyons at night' });
  await sleep(300);

  const room0 = [...H.conn.db.room.iter()].find((r: any) => r.code === ROOM);
  if (!room0) throw new Error('FAIL: room not created');
  const prompts = [...H.conn.db.lobbyPrompt.iter()].filter((p: any) => p.roomId === room0.id);
  console.log(`[creative] room id=${room0.id} state=${room0.state}, prompts=${prompts.length}`);
  if (prompts.length !== 1) throw new Error(`FAIL: expected 1 prompt, saw ${prompts.length}`);

  console.log('[creative] host → startBuild (sidecar should react)...');
  H.conn.reducers.startBuild();

  // Wait for the sidecar to generate + setWorldConfig.
  let cfg: any = null;
  let room: any = null;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    room = [...H.conn.db.room.iter()].find((r: any) => r.id === room0.id);
    cfg = [...H.conn.db.worldConfig.iter()].find((w: any) => w.roomId === room0.id);
    if (cfg && cfg.status === 'ready' && room && room.state === 'playing') {
      console.log(`[creative] world ready after ${(i + 1) * 100}ms`);
      break;
    }
  }

  H.conn.disconnect?.();

  if (!cfg || cfg.status !== 'ready') {
    throw new Error("FAIL: sidecar never produced a ready world_config (is `npm run sidecar` running?)");
  }
  if (!room || room.state !== 'playing') throw new Error(`FAIL: room did not advance to playing (state=${room?.state})`);

  const level = JSON.parse(cfg.json);
  console.log(`[creative] level: theme="${level.theme}" sky=${level.skyColor} rings=${level.rings?.length} gravity=${level.gravityScale}`);
  if (!Array.isArray(level.rings) || level.rings.length < 8) {
    throw new Error(`FAIL: level has too few rings (${level.rings?.length})`);
  }

  console.log('\n✅ PASS — prompt → sidecar → co-authored world synced; room is live (playing).');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});
