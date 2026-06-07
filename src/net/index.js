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
import { Predator } from './predator.js';
import { SabotageFX } from './sabotage.js';

const DB_NAME = 'flocked';
const SEND_HZ = 12;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

// Survival proximity-elimination tunables (mirror docs/SURVIVAL.md).
const CATCH_RADIUS = 18;     // metres
const CATCH_SECONDS = 2.2;   // continuous time inside catch-range → eliminated

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
   * @param {object} [opts.flightPhysics]  local FlightPhysics (for survival debuffs)
   * @param {string} [opts.uri]
   * @param {string} [opts.dbName]
   */
  constructor({ scene, localState, onState, onError, flightPhysics, uri, dbName } = {}) {
    this.scene = scene;
    this.localState = localState;
    this.onState = onState;
    this.onError = onError || null;
    this.flightPhysics = flightPhysics || null;
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
    this.color = 0;
    this.lobby = null;
    this.course = null;
    this.worldApplied = false;

    // Survival mode (lazy-initialized in _initSurvival)
    this.predator = null;
    this.sabotage = null;
    this.survCourse = null;
    this._survInit = false;
    this._survWorldApplied = false;
    this._huntTimer = 0;     // continuous seconds inside catch-range
    this._deathReported = false;
    this._vignette = null;
    this.amDead = false;     // eliminated this match (spectating) — read by main.js
    this._connectTimer = null;
  }

  connect() {
    // Guaranteed escape from the "Connecting…" screen if the server is unreachable
    // (e.g. the deployed site before the module is on maincloud).
    if (this._connectTimer) clearTimeout(this._connectTimer);
    this._connectTimer = setTimeout(() => {
      if (!this.connected) {
        console.warn('[net] connect timeout');
        if (this.onError) this.onError('timeout');
      }
    }, 9000);

    this.conn = connectToFlocked({
      uri: this.uri,
      dbName: this.dbName,
      onConnect: (conn, identity) => {
        if (this._connectTimer) { clearTimeout(this._connectTimer); this._connectTimer = null; }
        this.identity = identity;
        this.identityHex = identity.toHexString();
        this.connected = true;
        conn.subscriptionBuilder()
          .onApplied(() => { /* initial rows loaded */ })
          .subscribe([
            'SELECT * FROM player', 'SELECT * FROM room',
            'SELECT * FROM predator', 'SELECT * FROM sabotage_event', 'SELECT * FROM director_log',
          ]);
        // A survival join may have been queued before connect; init now if so.
        if (this.mode === 'survival') this._initSurvival();
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
        if (this.onError) this.onError('disconnected');
      },
      onError: (err) => {
        console.warn('[net] connect error:', err);
        if (this._connectTimer) { clearTimeout(this._connectTimer); this._connectTimer = null; }
        if (this.onError) this.onError('error');
      },
    });
  }

  // ---- reducer wrappers ----
  join({ code, name, mode, color }) {
    this.mode = mode || this.mode;
    if (typeof color === 'number') this.color = color % 8;
    if (this.mode === 'creative' && !this.lobby) this._initCreative();
    if (this.mode === 'survival' && !this._survInit && this.connected) this._initSurvival();
    if (!this.connected) { this._pendingJoin = { code, name, mode, color: this.color }; return; }
    this.conn.reducers.joinRoom({ code, name, mode, color: this.color });
  }

  _initCreative() {
    this.lobby = new LobbyUI();
    this.lobby.onSubmitPrompt = (text) => { if (this.connected) this.conn.reducers.submitPrompt({ text }); };
    this.lobby.onForge = () => this.startBuild();
    this.course = new RingCourse(this.scene);
  }

  /**
   * Lazy survival init. Safe to call repeatedly: the predator/sabotage/course
   * objects + the sabotage_event onInsert callback are created exactly once,
   * and only after we're connected (so this.conn.db exists).
   */
  _initSurvival() {
    if (this._survInit || !this.connected || !this.conn) return;
    this.predator = new Predator(this.scene);
    this.sabotage = new SabotageFX(this.scene, () => this.flightPhysics);
    this.survCourse = new RingCourse(this.scene);

    // Apply each sabotage_event the instant it lands (EVENT table → onInsert).
    this.conn.db.sabotageEvent.onInsert((_ctx, row) => {
      this.sabotage.handleEvent(row, this.identityHex);
    });

    this._survInit = true;
    console.log('[net] survival initialized');
  }

  setName(name) { if (this.connected) this.conn.reducers.setName({ name }); }
  setColor(color) { this.color = color % 8; if (this.connected) this.conn.reducers.setColor({ color: this.color }); }
  startGame() { if (this.connected) this.conn.reducers.startGame({}); }
  startBuild() { if (this.connected) this.conn.reducers.startBuild(); }
  leave() {
    if (this.connected) this.conn.reducers.leaveRoom({});
    // Reset per-match state so the NEXT match starts clean (no stale world/eliminated flags).
    this.worldApplied = false;
    this._survWorldApplied = false;
    this._huntTimer = 0;
    this._deathReported = false;
    this.amDead = false;
    this._setVignette(false);
    if (this.course && this.course.clear) this.course.clear();
    if (this.survCourse && this.survCourse.clear) this.survCourse.clear();
  }
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

    // Eliminated this match? main.js reads this to freeze control + show a banner.
    this.amDead = !!(myRow && room && room.state === 'playing' && myRow.alive === false);

    // 1) Push my transform (throttled, only while alive in a room).
    const now = performance.now();
    if (this.myRoomId !== 0n && !this.amDead && now - this._lastSend >= SEND_INTERVAL_MS) {
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
        const host = !!(room && room.host.toHexString() === r.identity.toHexString());
        roster.push({ name: r.name, color: r.color, me, host, score: r.score, finished: r.finished, alive: r.alive });
        if (!me) remoteRows.push(r);
      }
    }
    this.remote.reconcile(remoteRows, dt, camera);

    // 3) Creative mode: lobby UI + co-authored world application.
    if (this.mode === 'creative' && this.lobby) this._driveCreative(room, roster);
    // 3b) Survival mode: predator render, course, sabotage FX, elimination.
    if (this.mode === 'survival') this._driveSurvival(room, roster, dt, camera);

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
        roster,
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

  /** The predator row for a given room id (or null). */
  _predatorRow(roomId) {
    if (!this.conn || roomId === 0n) return null;
    for (const p of this.conn.db.predator.iter()) if (p.roomId === roomId) return p;
    return null;
  }

  /** Lazily create + return the red HUNTED vignette DOM element. */
  _ensureVignette() {
    if (this._vignette || typeof document === 'undefined') return this._vignette;
    if (!document.getElementById('flk-hunted-style')) {
      const style = document.createElement('style');
      style.id = 'flk-hunted-style';
      style.textContent = `
        @keyframes flkHuntPulse { 0%,100%{opacity:.55} 50%{opacity:.9} }
        .flk-hunted{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;
          box-shadow:inset 0 0 220px 60px rgba(200,12,12,.72);
          animation:flkHuntPulse 1.1s ease-in-out infinite}
        .flk-hunted::after{content:'HUNTED';position:absolute;top:18px;left:50%;
          transform:translateX(-50%);color:#ff5151;font-family:system-ui,sans-serif;
          font-weight:800;letter-spacing:6px;font-size:15px;
          text-shadow:0 0 12px rgba(255,40,40,.8)}
      `;
      document.head.appendChild(style);
    }
    const el = document.createElement('div');
    el.className = 'flk-hunted';
    document.body.appendChild(el);
    this._vignette = el;
    return el;
  }

  _setVignette(on) {
    const el = this._ensureVignette();
    if (el) el.style.display = on ? 'block' : 'none';
  }

  /**
   * Survival-mode driver: mirrors _driveCreative's world application, then adds
   * the predator hawk, sabotage FX, proximity elimination, and HUNTED vignette.
   * Creative mode is never touched by this path.
   */
  _driveSurvival(room, roster, dt, camera) {
    // Lazy init (in case the survival join happened before connect).
    if (!this._survInit && this.connected) this._initSurvival();
    if (!this._survInit) return;

    const state = room ? room.state : null;

    // Always advance sabotage FX (handles fog restore even between states).
    this.sabotage.update(dt);

    if (state !== 'playing') {
      // Not racing → no predator, reset per-match elimination/vignette state.
      this.predator.reconcile(null, dt, camera);
      this._setVignette(false);
      this._survWorldApplied = false;
      this._huntTimer = 0;
      this._deathReported = false;
      return;
    }

    // Apply the synced world ONCE (palette + course) exactly like _driveCreative.
    if (!this._survWorldApplied) {
      const cfgRow = this._worldConfig(room.id);
      if (cfgRow && cfgRow.status === 'ready' && cfgRow.json) {
        try {
          const cfg = JSON.parse(cfgRow.json);
          applyPalette(this.scene, cfg);
          this.survCourse.build(cfg);
          this._survWorldApplied = true;
          console.log(`[net] survival world applied: theme=${cfg.theme}, ${cfg.rings?.length} rings`);
        } catch (e) { console.warn('[net] bad world_config json', e); }
      }
    }

    // Course progress → reportFinish on completion (once).
    if (this._survWorldApplied && this.survCourse) {
      const res = this.survCourse.update(this.localState.position);
      if (res.justFinished) {
        this.reportFinish();
        console.log('[net] survival course complete → reportFinish');
      }
    }

    // Predator render + proximity elimination.
    const pRow = this._predatorRow(room.id);
    this.predator.reconcile(pRow, dt, camera);

    if (pRow && pRow.active) {
      // HUNTED vignette when the predator is targeting ME.
      let targetHex = null;
      try { targetHex = pRow.targetPlayer.toHexString(); } catch { targetHex = null; }
      this._setVignette(targetHex === this.identityHex);

      // Continuous-proximity elimination — only once the hunt has actually begun
      // (never during 'patrol' / at spawn), so nobody dies before the chase.
      const dist = this.predator.getPosition().distanceTo(this.localState.position);
      if (dist < CATCH_RADIUS && pRow.behavior !== 'patrol' && !this._deathReported) {
        this._huntTimer += dt;
        if (this._huntTimer >= CATCH_SECONDS && !this._deathReported) {
          this._deathReported = true;
          this.reportDeath();
          console.log('[net] predator caught me → reportDeath');
        }
      } else {
        this._huntTimer = 0; // must be CONTINUOUS
      }
    } else {
      this._setVignette(false);
      this._huntTimer = 0;
    }
  }
}
