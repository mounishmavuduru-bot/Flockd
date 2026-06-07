/**
 * NetClient — high-level multiplayer orchestrator for FLOCKED.
 *
 * Responsibilities:
 *  - connect to SpacetimeDB + subscribe to room/player tables
 *  - push the LOCAL bird's transform at a throttled rate (~12 Hz)
 *  - reconcile remote birds in my room each frame
 *  - expose room state to the UI via an onState callback
 *
 * Usage (from main.js):
 *   const net = new NetClient({ scene, localState: flightState });
 *   net.connect();
 *   net.join({ code: 'WIND', name: 'Mounish', mode: 'creative' });
 *   // in the per-frame loop:  net.update(dt, camera);
 */
import { connectToFlocked } from './connection.js';
import { RemoteBirds } from './remoteBirds.js';
import { LobbyUI } from './lobbyUI.js';
import { RingCourse, applyPalette } from './applyWorld.js';

const DB_NAME = 'flocked';
const SEND_HZ = 12;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

function defaultUri() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://localhost:3000';
  // Override with ?stdb=wss://host to point at a deployed module.
  const param = new URLSearchParams(location.search).get('stdb');
  return param || 'wss://maincloud.spacetimedb.com';
}

export class NetClient {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {object} opts.localState   the local FlightState (read each frame)
   * @param {(info:object)=>void} [opts.onState]
   * @param {string} [opts.uri]
   * @param {string} [opts.dbName]
   */
  constructor({ scene, localState, onState, uri, dbName } = {}) {
    this.scene = scene;
    this.localState = localState;
    this.onState = onState;
    this.uri = uri || defaultUri();
    this.dbName = dbName || DB_NAME;

    this.conn = null;
    this.identity = null;
    this.identityHex = null;
    this.connected = false;
    this.myRoomId = 0n;

    this.remote = new RemoteBirds(scene);
    this._lastSend = 0;
    this._pendingJoin = null;

    // Creative mode
    this.mode = null;
    this.lobby = null;
    this.course = null;
    this.worldApplied = false;
  }

  connect() {
    this.conn = connectToFlocked({
      uri: this.uri,
      dbName: this.dbName,
      onConnect: (conn, identity) => {
        this.identity = identity;
        this.identityHex = identity.toHexString();
        this.connected = true;
        conn.subscriptionBuilder()
          .onApplied(() => { /* initial rows loaded */ })
          .subscribe(['SELECT * FROM player', 'SELECT * FROM room']);
        if (this._pendingJoin) {
          this.join(this._pendingJoin);
          this._pendingJoin = null;
        }
        console.log('[net] connected as', this.identityHex.slice(0, 8));
      },
      onDisconnect: () => {
        this.connected = false;
        this.myRoomId = 0n;
        this.remote.clear();
        console.warn('[net] disconnected');
      },
      onError: (err) => { console.warn('[net] connect error:', err); },
    });
  }

  // ---- reducer wrappers ----
  join({ code, name, mode }) {
    this.mode = mode || this.mode;
    if (this.mode === 'creative' && !this.lobby) this._initCreative();
    if (!this.connected) { this._pendingJoin = { code, name, mode }; return; }
    this.conn.reducers.joinRoom({ code, name, mode });
  }

  _initCreative() {
    this.lobby = new LobbyUI();
    this.lobby.onSubmitPrompt = (text) => { if (this.connected) this.conn.reducers.submitPrompt({ text }); };
    this.lobby.onForge = () => this.startBuild();
    this.course = new RingCourse(this.scene);
  }

  setName(name) { if (this.connected) this.conn.reducers.setName({ name }); }
  startGame() { if (this.connected) this.conn.reducers.startGame({}); }
  startBuild() { if (this.connected) this.conn.reducers.startBuild(); }
  leave() { if (this.connected) this.conn.reducers.leaveRoom({}); }
  reportFinish() { if (this.connected) this.conn.reducers.reportFinish({}); }
  reportDeath() { if (this.connected) this.conn.reducers.reportDeath({}); }

  /** My own player row from the live cache (or null). */
  _myRow() {
    if (!this.conn) return null;
    for (const row of this.conn.db.player.iter()) {
      if (row.identity.toHexString() === this.identityHex) return row;
    }
    return null;
  }

  _room(roomId) {
    if (!this.conn || roomId === 0n) return null;
    for (const r of this.conn.db.room.iter()) if (r.id === roomId) return r;
    return null;
  }

  _worldConfig(roomId) {
    if (!this.conn) return null;
    for (const w of this.conn.db.worldConfig.iter()) if (w.roomId === roomId) return w;
    return null;
  }

  /** Call once per frame after physics. */
  update(dt, camera) {
    if (!this.connected || !this.conn) return;

    const myRow = this._myRow();
    this.myRoomId = myRow ? myRow.roomId : 0n;
    const room = this._room(this.myRoomId);

    // 1) Push my transform (throttled, only while in a room).
    const now = performance.now();
    if (this.myRoomId !== 0n && now - this._lastSend >= SEND_INTERVAL_MS) {
      this._lastSend = now;
      const s = this.localState;
      this.conn.reducers.updateTransform({
        x: s.position.x, y: s.position.y, z: s.position.z,
        yaw: s.yaw, pitch: s.pitch, roll: s.roll, speed: s.speed,
      });
    }

    // 2) Members in my room (online) → roster + remote birds.
    const remoteRows = [];
    const roster = [];
    if (this.myRoomId !== 0n) {
      for (const r of this.conn.db.player.iter()) {
        if (r.roomId !== this.myRoomId || !r.online) continue;
        const me = r.identity.toHexString() === this.identityHex;
        roster.push({ name: r.name, color: r.color, me });
        if (!me) remoteRows.push(r);
      }
    }
    this.remote.reconcile(remoteRows, dt, camera);

    // 3) Creative mode: lobby UI + co-authored world application.
    if (this.mode === 'creative' && this.lobby) this._driveCreative(room, roster);

    // 4) Surface room state for external UI/debug.
    if (this.onState) {
      const isHost = !!(room && room.host.toHexString() === this.identityHex);
      this.onState({
        connected: this.connected,
        inRoom: this.myRoomId !== 0n,
        roomCode: room ? room.code : null,
        roomState: room ? room.state : null,
        mode: room ? room.mode : null,
        isHost,
        players: roster.length,
      });
    }
  }

  _driveCreative(room, roster) {
    const state = room ? room.state : null;
    const isHost = !!(room && room.host.toHexString() === this.identityHex);

    if (state === 'lobby' || state === 'building') {
      this.lobby.show();
      this.lobby.setState({ roomCode: room.code, mode: room.mode, state, isHost, roster });
      this.worldApplied = false;
      return;
    }

    if (state === 'playing') {
      this.lobby.hide();
      if (!this.worldApplied) {
        const cfgRow = this._worldConfig(room.id);
        if (cfgRow && cfgRow.status === 'ready' && cfgRow.json) {
          try {
            const cfg = JSON.parse(cfgRow.json);
            applyPalette(this.scene, cfg);
            this.course.build(cfg);
            this.worldApplied = true;
            console.log(`[net] world applied: theme=${cfg.theme}, ${cfg.rings?.length} rings`);
          } catch (e) { console.warn('[net] bad world_config json', e); }
        }
      }
      if (this.worldApplied && this.course) {
        const res = this.course.update(this.localState.position);
        if (res.justFinished) {
          this.reportFinish();
          console.log('[net] course complete → reportFinish');
        }
      }
      return;
    }

    this.lobby.hide();
  }
}
