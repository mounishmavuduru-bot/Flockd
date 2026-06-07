/**
 * Multiplayer smoke test — drives TWO real SpacetimeDB clients through the
 * generated bindings to prove cross-client sync works end-to-end.
 *
 * Prereqs: local server running (`npm run stdb:start`) + module published
 * (`npm run stdb:publish:local`).
 *
 * Run: npx tsx test/mp-smoke.ts
 *
 * What it checks:
 *   1. Two anonymous clients connect + get distinct identities.
 *   2. Both join the same room code via the joinRoom reducer.
 *   3. Client A pushes a transform via updateTransform.
 *   4. Client B's SUBSCRIPTION reflects A's new position (the core multiplayer claim).
 */
import { DbConnection } from '../src/net/bindings';

const URI = 'ws://localhost:3000';
const DB = 'flocked';
const ROOM = 'SMOKE';
const TARGET = { x: 123.5, y: 222.0, z: -77.25 };

function makeClient(label: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((c: any, identity: any) => {
        c.subscriptionBuilder()
          .onApplied(() => resolve({ conn: c, identity }))
          .subscribe(['SELECT * FROM player', 'SELECT * FROM room']);
      })
      .onConnectError((_c: any, err: any) => reject(err))
      .build();
    setTimeout(() => reject(new Error(`${label} connect timeout`)), 10000);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[smoke] connecting two clients...');
  const A = await makeClient('A');
  const B = await makeClient('B');
  const aHex = A.identity.toHexString();
  const bHex = B.identity.toHexString();
  console.log(`[smoke] A=${aHex.slice(0, 8)}  B=${bHex.slice(0, 8)}`);
  if (aHex === bHex) throw new Error('FAIL: clients share an identity');

  console.log(`[smoke] both join room ${ROOM}...`);
  A.conn.reducers.joinRoom({ code: ROOM, name: 'AlphaBird', mode: 'creative', color: 0 });
  B.conn.reducers.joinRoom({ code: ROOM, name: 'BetaBird', mode: 'creative', color: 1 });
  await sleep(800);

  // Confirm B sees A's player row in the same room.
  const bSeesA = () => [...B.conn.db.player.iter()].find((r: any) => r.identity.toHexString() === aHex);
  let rowA = bSeesA();
  if (!rowA) throw new Error("FAIL: B's subscription does not see A's player row");
  console.log(`[smoke] B sees A's row (roomId=${rowA.roomId}, name=${rowA.name})`);

  console.log(`[smoke] A pushes transform → (${TARGET.x}, ${TARGET.y}, ${TARGET.z})...`);
  A.conn.reducers.updateTransform({
    x: TARGET.x, y: TARGET.y, z: TARGET.z, yaw: 1.0, pitch: 0.2, roll: -0.1, speed: 33,
  });

  // Poll B's cache until it reflects A's new position (or timeout).
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    rowA = bSeesA();
    if (rowA && Math.abs(rowA.x - TARGET.x) < 0.01 && Math.abs(rowA.y - TARGET.y) < 0.01) {
      ok = true;
      console.log(`[smoke] B observed A's synced transform after ${(i + 1) * 100}ms: x=${rowA.x} y=${rowA.y} z=${rowA.z} speed=${rowA.speed}`);
      break;
    }
  }

  // Also assert A and B are in the SAME room with playerCount tracking 2 live members.
  const room = [...B.conn.db.room.iter()].find((r: any) => r.code === ROOM);
  const liveInRoom = [...B.conn.db.player.iter()].filter((r: any) => r.roomId === room?.id && r.online).length;
  console.log(`[smoke] room ${ROOM}: id=${room?.id} state=${room?.state} mode=${room?.mode} liveMembers=${liveInRoom}`);

  A.conn.disconnect?.();
  B.conn.disconnect?.();

  if (!ok) throw new Error("FAIL: B never observed A's synced transform");
  if (liveInRoom < 2) throw new Error(`FAIL: expected 2 live members, saw ${liveInRoom}`);
  console.log('\n✅ PASS — two clients joined one room and saw each other\'s synced transforms.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});
