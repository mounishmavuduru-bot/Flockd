/**
 * FLOCKED — SpacetimeDB module (TypeScript, v2.4)
 *
 * Single source of truth + real-time sync layer for a multiplayer bird-flight game.
 *
 * Design rules (see docs/ARCHITECTURE.md):
 *  - Positions are client-authoritative + throttled (~12 Hz). Arcade game, no anti-cheat.
 *  - Scores / lifecycle / room state go through validating reducers.
 *  - World config + predator/sabotage rows are written by the AI sidecar (a privileged
 *    client) — Claude is the only author of "AI" state. STDB just fans it out.
 *  - Deterministic world from `room.seed` → zero per-frame world sync.
 *
 * Phase 1 (this file): room, player, transform sync, lifecycle, scheduled tick.
 * Phase 2 adds: lobby_prompt, world_config + creative reducers.
 * Phase 3 adds: predator, sabotage_event + survival reducers.
 */
import { schema, table, t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

// ───────────────────────────── Tables ─────────────────────────────

/** A lobby / match. First client to use a code creates it (and becomes host). */
const room = table(
  { name: 'room', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string().unique(), // join code, e.g. "WIND"
    mode: t.string(), // 'creative' | 'survival'
    state: t.string(), // 'lobby' | 'building' | 'playing' | 'over'
    seed: t.u32(), // deterministic world seed shared by all players
    host: t.identity(),
    tick: t.u64(), // server tick counter (scheduled reducer)
    playerCount: t.u32(),
    createdAt: t.timestamp(),
  }
);

/** One row per connected identity. room_id 0 = not in a room (in menu). */
const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    roomId: t.u64().index('btree'), // 0 = none; clients subscribe WHERE room_id = X
    name: t.string(),
    color: t.u32(), // palette index 0..7 (client maps to a hue)
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
    pitch: t.f32(),
    roll: t.f32(),
    speed: t.f32(),
    alive: t.bool(),
    finished: t.bool(),
    score: t.i32(),
    online: t.bool(),
    updatedAt: t.timestamp(),
  }
);

/** Scheduled heartbeat — drives timers / win-loss / predator expiry (fleshed out later). */
const tickTimer = table(
  {
    name: 'tick_timer',
    scheduled: (): any => tick, // (): any => avoids the circular-reference type error
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({ room, player, tickTimer });
export default spacetimedb;

// ──────────────────────────── Constants ───────────────────────────

const SPAWN = { x: 0, y: 60, z: 0 }; // matches birdybird nest-ish altitude
const TICK_INTERVAL_MICROS = 1_000_000n; // 1 Hz heartbeat for now (tighten in Phase 3)

// ───────────────────────────── Helpers ────────────────────────────

function randomSeed(ctx: any): number {
  return ctx.random.integerInRange(1, 2_000_000_000);
}

function spawnPlayerInto(ctx: any, p: any, roomId: bigint, name: string, color: number) {
  ctx.db.player.identity.update({
    ...p,
    roomId,
    name: name.slice(0, 24) || 'Bird',
    color,
    x: SPAWN.x,
    y: SPAWN.y,
    z: SPAWN.z,
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    alive: true,
    finished: false,
    score: 0,
    updatedAt: ctx.timestamp,
  });
}

// ──────────────────────────── Lifecycle ───────────────────────────

export const init = spacetimedb.init((ctx) => {
  // Start the recurring heartbeat once, at publish time.
  ctx.db.tickTimer.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(TICK_INTERVAL_MICROS),
  });
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, online: true, updatedAt: ctx.timestamp });
    return;
  }
  ctx.db.player.insert({
    identity: ctx.sender,
    roomId: 0n,
    name: 'Bird',
    color: 0,
    x: SPAWN.x,
    y: SPAWN.y,
    z: SPAWN.z,
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    alive: false,
    finished: false,
    score: 0,
    online: true,
    updatedAt: ctx.timestamp,
  });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  // Keep the row for reconnect; just mark offline and decrement the room count.
  ctx.db.player.identity.update({ ...p, online: false, updatedAt: ctx.timestamp });
  if (p.roomId !== 0n) decrementRoom(ctx, p.roomId);
});

function decrementRoom(ctx: any, roomId: bigint) {
  const r = ctx.db.room.id.find(roomId);
  if (!r) return;
  const next = r.playerCount > 0 ? r.playerCount - 1 : 0;
  ctx.db.room.id.update({ ...r, playerCount: next });
}

// ───────────────────────────── Reducers ───────────────────────────

/** Set / change display name while in the menu. */
export const setName = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new Error('no player row');
  ctx.db.player.identity.update({ ...p, name: name.slice(0, 24) || 'Bird', updatedAt: ctx.timestamp });
});

/**
 * Join an existing room by code, or create it if it doesn't exist.
 * Creator becomes host and picks the mode.
 */
export const joinRoom = spacetimedb.reducer(
  { code: t.string(), name: t.string(), mode: t.string() },
  (ctx, { code, name, mode }) => {
    const p = ctx.db.player.identity.find(ctx.sender);
    if (!p) throw new Error('no player row');

    const cleanCode = code.trim().toUpperCase().slice(0, 8) || 'WIND';
    const cleanMode = mode === 'survival' ? 'survival' : 'creative';

    let r = ctx.db.room.code.find(cleanCode);
    if (!r) {
      const id = ctx.db.room.insert({
        id: 0n,
        code: cleanCode,
        mode: cleanMode,
        state: 'lobby',
        seed: randomSeed(ctx),
        host: ctx.sender,
        tick: 0n,
        playerCount: 0,
        createdAt: ctx.timestamp,
      }).id;
      r = ctx.db.room.id.find(id)!;
    }

    // Assign a color = current player count (mod palette size).
    const color = r.playerCount % 8;
    spawnPlayerInto(ctx, p, r.id, name, color);
    ctx.db.room.id.update({ ...r, playerCount: r.playerCount + 1 });
  }
);

/** Leave the current room (back to menu). */
export const leaveRoom = spacetimedb.reducer((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.roomId === 0n) return;
  const roomId = p.roomId;
  ctx.db.player.identity.update({ ...p, roomId: 0n, alive: false, updatedAt: ctx.timestamp });
  decrementRoom(ctx, roomId);
});

/**
 * Push local flight transform. Client-authoritative + client-throttled (~12 Hz).
 * Only the caller's own row is mutated.
 */
export const updateTransform = spacetimedb.reducer(
  {
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
    pitch: t.f32(),
    roll: t.f32(),
    speed: t.f32(),
  },
  (ctx, { x, y, z, yaw, pitch, roll, speed }) => {
    const p = ctx.db.player.identity.find(ctx.sender);
    if (!p || p.roomId === 0n) return;
    ctx.db.player.identity.update({ ...p, x, y, z, yaw, pitch, roll, speed, updatedAt: ctx.timestamp });
  }
);

/** Host starts the match. (Creative will route lobby→building→playing in Phase 2.) */
export const startGame = spacetimedb.reducer((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.roomId === 0n) throw new Error('not in a room');
  const r = ctx.db.room.id.find(p.roomId);
  if (!r) throw new Error('room gone');
  if (!r.host.equals(ctx.sender)) throw new Error('only the host can start');
  ctx.db.room.id.update({ ...r, state: 'playing', tick: 0n });
  // Reset everyone in the room to a clean racing state.
  for (const member of ctx.db.player.roomId.filter(r.id)) {
    ctx.db.player.identity.update({
      ...member,
      x: SPAWN.x,
      y: SPAWN.y,
      z: SPAWN.z,
      alive: true,
      finished: false,
      score: 0,
      updatedAt: ctx.timestamp,
    });
  }
});

/** Report crossing the finish (creative race) — scores by arrival order. */
export const reportFinish = spacetimedb.reducer((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.roomId === 0n || p.finished) return;
  const r = ctx.db.room.id.find(p.roomId);
  if (!r || r.state !== 'playing') return;
  const alreadyFinished = [...ctx.db.player.roomId.filter(r.id)].filter((m) => m.finished).length;
  const points = Math.max(100 - alreadyFinished * 20, 10); // 1st=100, 2nd=80, ...
  ctx.db.player.identity.update({ ...p, finished: true, score: p.score + points, updatedAt: ctx.timestamp });
});

/** Report death (survival elimination). */
export const reportDeath = spacetimedb.reducer((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.roomId === 0n || !p.alive) return;
  ctx.db.player.identity.update({ ...p, alive: false, updatedAt: ctx.timestamp });
});

// ──────────────────────────── Scheduled ───────────────────────────

/** Heartbeat: advance each playing room's tick. Win/loss + predator expiry land here later. */
export const tick = spacetimedb.reducer({ timer: tickTimer.rowType }, (ctx) => {
  for (const r of ctx.db.room.iter()) {
    if (r.state === 'playing') {
      ctx.db.room.id.update({ ...r, tick: r.tick + 1n });
    }
  }
});
