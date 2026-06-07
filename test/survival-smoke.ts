/**
 * Survival-mode smoke test — proves the full predator/director loop:
 *   two clients join a survival room → host startBuild → sidecar generates a
 *   world → room 'playing' → sidecar spawnPredator → steering moves the predator
 *   → Claude (or mock) director writes director_log rows (reasoning + taunt) and
 *   may emit sabotage_event rows.
 *
 * Prereqs: local STDB + module published + sidecar running (npm run sidecar).
 * Run: npx tsx test/survival-smoke.ts
 */
import { DbConnection } from '../src/net/bindings';

const URI = 'ws://localhost:3000';
const DB = 'flocked';
const ROOM = ('S' + (Date.now() % 100000)).toUpperCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeClient(onSabotage?: (row: any) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((c: any, identity: any) => {
        // Count sabotage events (EVENT table → onInsert only, never cached).
        if (onSabotage) c.db.sabotageEvent.onInsert((_ctx: any, row: any) => onSabotage(row));
        c.subscriptionBuilder()
          .onApplied(() => resolve({ conn: c, identity }))
          .subscribe([
            'SELECT * FROM room', 'SELECT * FROM player', 'SELECT * FROM world_config',
            'SELECT * FROM predator', 'SELECT * FROM sabotage_event', 'SELECT * FROM director_log',
          ]);
      })
      .onConnectError((_c: any, e: any) => reject(e))
      .build();
    setTimeout(() => reject(new Error('connect timeout')), 10000);
  });
}

async function main() {
  console.log(`[survival] room=${ROOM}`);
  let sabotageCount = 0;
  const H = await makeClient((row) => { sabotageCount++; console.log(`[survival]  ⚡ sabotage: ${row.kind} → "${row.reason}"`); });
  const P = await makeClient();
  console.log('[survival] host', H.identity.toHexString().slice(0, 8), 'hunter', P.identity.toHexString().slice(0, 8));

  H.conn.reducers.joinRoom({ code: ROOM, name: 'Skyler', mode: 'survival', color: 3 });
  await sleep(250);
  P.conn.reducers.joinRoom({ code: ROOM, name: 'Talon', mode: 'survival', color: 6 });
  await sleep(350);

  const room0 = [...H.conn.db.room.iter()].find((r: any) => r.code === ROOM);
  if (!room0) throw new Error('FAIL: room not created');
  if (room0.mode !== 'survival') throw new Error(`FAIL: room mode is ${room0.mode}, expected survival`);
  console.log(`[survival] room id=${room0.id} mode=${room0.mode} state=${room0.state}`);

  console.log('[survival] host → startBuild (sidecar generates world, then predator + director)...');
  H.conn.reducers.startBuild();

  // 1) Wait for the world + 'playing'.
  let room: any = null, cfg: any = null;
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    room = [...H.conn.db.room.iter()].find((r: any) => r.id === room0.id);
    cfg = [...H.conn.db.worldConfig.iter()].find((w: any) => w.roomId === room0.id);
    if (cfg?.status === 'ready' && room?.state === 'playing') { console.log(`[survival] world ready + playing after ${(i + 1) * 100}ms`); break; }
  }
  if (cfg?.status !== 'ready' || room?.state !== 'playing') {
    throw new Error(`FAIL: room never reached playing (state=${room?.state}, cfg=${cfg?.status}) — is the sidecar running?`);
  }

  // 2) Wait for the predator to spawn.
  let pred: any = null;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    pred = [...H.conn.db.predator.iter()].find((p: any) => p.roomId === room0.id);
    if (pred && pred.active) { console.log(`[survival] predator spawned after ${(i + 1) * 100}ms @ (${pred.x.toFixed(0)},${pred.y.toFixed(0)},${pred.z.toFixed(0)}) behavior=${pred.behavior}`); break; }
  }
  if (!pred || !pred.active) throw new Error('FAIL: predator never spawned (sidecar survival loop not running?)');

  // 3) Predator should MOVE (steering tick).
  const p1 = { x: pred.x, y: pred.y, z: pred.z };
  await sleep(1200);
  const pred2 = [...H.conn.db.predator.iter()].find((p: any) => p.roomId === room0.id);
  const moved = pred2 && (Math.abs(pred2.x - p1.x) + Math.abs(pred2.y - p1.y) + Math.abs(pred2.z - p1.z)) > 0.01;
  console.log(`[survival] predator moved over 1.2s: ${moved ? 'YES' : 'no'} (Δ=${pred2 ? (Math.abs(pred2.x-p1.x)+Math.abs(pred2.z-p1.z)).toFixed(1) : '?'})`);

  // 4) Wait for the Claude/mock director to log its reasoning.
  let logs: any[] = [];
  for (let i = 0; i < 90; i++) {
    await sleep(100);
    logs = [...H.conn.db.directorLog.iter()].filter((l: any) => l.roomId === room0.id);
    if (logs.length >= 1) break;
  }
  if (logs.length < 1) throw new Error('FAIL: director never logged a decision (no director_log rows)');
  logs.sort((a, b) => Number(a.id - b.id));
  const last = logs[logs.length - 1];
  console.log(`[survival] director_log rows=${logs.length}. latest:`);
  console.log(`           target="${last.targetName}" behavior=${last.behavior} sabotage="${last.sabotageKind || '(none)'}"`);
  console.log(`           reasoning="${last.reasoning}"`);
  console.log(`           taunt="${last.taunt}"`);
  if (!last.reasoning || last.reasoning.length < 3) throw new Error('FAIL: director_log reasoning is empty');

  await sleep(400); // let any sabotage land
  console.log(`[survival] sabotage_event count observed: ${sabotageCount}`);

  H.conn.disconnect?.(); P.conn.disconnect?.();
  console.log('\n✅ PASS — survival: world → predator spawned + moving → director logged live reasoning. The hunt is real.');
  process.exit(0);
}

main().catch((e) => { console.error('\n❌', e?.message || e); process.exit(1); });
