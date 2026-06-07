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
 *   net.join({ code: 'WIND', name: 'Mounish', mode: 'race' });
 *   // in the per-frame loop:  net.update(dt, camera);
 */
import { connectToFlocked } from './connection.js';
import { RemoteBirds } from './remoteBirds.js';
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
  constructor({ scene, localState, onState, onError, onReady, flightPhysics, uri, dbName } = {}) {
    this.scene = scene;
    this.localState = localState;
    this.onState = onState;
    this.onError = onError || null;
    this.onReady = onReady || null;   // fired the instant the socket connects
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

    // Race mode (+ shared world application)
    this.mode = null;
    this.color = 0;
    this.skin = 'stork';   // selected bird avatar id (see flight/AvatarBird.js BIRDS)
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
    this._tithe = null;      // bottom-center 'buy mercy' TITHE control (lazy DOM)
    this._ticker = null;     // bottom-center LIVE COMMENTARY ticker (lazy DOM)
    this._tickerId = 0n;     // id of the last commentary row shown (dedupe)
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
            'SELECT * FROM favor_ledger', 'SELECT * FROM commentary',
          ]);
        // A survival join may have been queued before connect; init now if so.
        if (this.mode === 'survival') this._initSurvival();
        if (this._pendingJoin) {
          this.join(this._pendingJoin);
          this._pendingJoin = null;
        }
        // Notify UI immediately (don't wait for the first post-connect update()
        // frame to flip the status chip / fire a queued host Start).
        if (this.onReady) this.onReady(true);
        console.log('[net] connected as', this.identityHex.slice(0, 8));
      },
      onDisconnect: () => {
        this.connected = false;
        this.myRoomId = 0n;
        this.remote.clear();
        if (this.onReady) this.onReady(false);
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
  join({ code, name, mode, color, skin }) {
    this.mode = mode || this.mode;
    if (typeof color === 'number') this.color = color % 8;
    if (typeof skin === 'string' && skin) this.skin = skin;
    if (this.mode === 'race' && !this.course) this.course = new RingCourse(this.scene);
    if (this.mode === 'survival' && !this._survInit && this.connected) this._initSurvival();
    if (!this.connected) { this._pendingJoin = { code, name, mode, color: this.color, skin: this.skin }; return; }
    this.conn.reducers.joinRoom({ code, name, mode, color: this.color, skin: this.skin });
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
  setSkin(id) { if (typeof id === 'string' && id) this.skin = id; if (this.connected) this.conn.reducers.setSkin({ skin: this.skin }); }
  /** The local player's chosen avatar id — prefers the synced row, falls back to our local pick. */
  mySkin() { const r = this._myRow(); return (r && r.skin) || this.skin || 'stork'; }
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
    this._setTithe(false);
    this._setTicker(false);
    this._tickerId = 0n;
    if (this.course && this.course.clear) this.course.clear();
    if (this.survCourse && this.survCourse.clear) this.survCourse.clear();
  }
  reportFinish() { if (this.connected) this.conn.reducers.reportFinish({}); }
  reportDeath() { if (this.connected) this.conn.reducers.reportDeath({}); }
  /** Survival: covertly spend `amount` of my score into my private favor_ledger row to buy down the hunt. */
  tithe(amount) { if (this.connected) this.conn.reducers.tithe({ amount }); }

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
        roster.push({ name: r.name, color: r.color, skin: r.skin, me, host, score: r.score, finished: r.finished, alive: r.alive });
        if (!me) remoteRows.push(r);
      }
    }
    this.remote.reconcile(remoteRows, dt, camera);

    // 3) Race mode: apply the synced world + course, report finishes (no predator).
    if (this.mode === 'race') this._driveRace(room, roster, dt, camera);
    // 3b) Survival mode: predator render, course, sabotage FX, elimination.
    if (this.mode === 'survival') this._driveSurvival(room, roster, dt, camera);

    // 3c) LIVE COMMENTARY ticker — newest line for my room, only while playing.
    if (this.myRoomId !== 0n && room && room.state === 'playing') {
      this._updateTicker(this.myRoomId);
    } else {
      this._setTicker(false);
    }

    // 4) Surface room state for external UI/debug.
    if (this.onState) {
      const isHost = !!(room && room.host.toHexString() === this.identityHex);
      // My own selected skin: prefer the live server row, fall back to local cache.
      const mySkin = (myRow && myRow.skin) || this.skin;
      this.onState({
        connected: this.connected,
        inRoom: this.myRoomId !== 0n,
        roomCode: room ? room.code : null,
        roomState: room ? room.state : null,
        mode: room ? room.mode : null,
        isHost,
        players: roster.length,
        skin: mySkin,
        roster,
      });
    }
  }

  /**
   * Race-mode driver: applies the synced world (palette + RingCourse) once the
   * match is 'playing', then advances the course and reports finishes. No
   * predator, no prompt/lobby UI — the MenuShell handles the waiting room.
   */
  _driveRace(room, roster, dt, camera) {
    if (!this.course) this.course = new RingCourse(this.scene);
    const state = room ? room.state : null;

    if (state !== 'playing') {
      // Not racing yet → wait for the world; reset per-match application.
      this.worldApplied = false;
      return;
    }

    // Apply the synced world ONCE (palette + course).
    if (!this.worldApplied) {
      const cfgRow = this._worldConfig(room.id);
      if (cfgRow && cfgRow.status === 'ready' && cfgRow.json) {
        try {
          const cfg = JSON.parse(cfgRow.json);
          applyPalette(this.scene, cfg);
          this.course.build(cfg);
          this.worldApplied = true;
          console.log(`[net] race world applied: theme=${cfg.theme}, ${cfg.rings?.length} rings`);
        } catch (e) { console.warn('[net] bad world_config json', e); }
      }
    }

    // Course progress → reportFinish on completion (once).
    if (this.worldApplied && this.course) {
      const res = this.course.update(this.localState.position);
      if (res.justFinished) {
        this.reportFinish();
        console.log('[net] race course complete → reportFinish');
      }
    }
  }

  /** The predator row for a given room id (or null). */
  _predatorRow(roomId) {
    if (!this.conn || roomId === 0n) return null;
    for (const p of this.conn.db.predator.iter()) if (p.roomId === roomId) return p;
    return null;
  }

  /** MY favor_ledger row for a given room id (or null). Private table → only my row is here. */
  _favorRow(roomId) {
    if (!this.conn || roomId === 0n) return null;
    for (const f of this.conn.db.favorLedger.iter()) {
      if (f.roomId === roomId && f.identity.toHexString() === this.identityHex) return f;
    }
    return null;
  }

  /** The newest commentary row for a given room id (highest id), or null. */
  _latestCommentary(roomId) {
    if (!this.conn || roomId === 0n) return null;
    let best = null;
    for (const c of this.conn.db.commentary.iter()) {
      if (c.roomId !== roomId) continue;
      if (!best || c.id > best.id) best = c;
    }
    return best;
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
   * Lazily create + return the covert TITHE control (survival 'buy mercy').
   * Bottom-center dark pill: a button that spends 50 score → favor, plus a live
   * readout of my favor + score. All text via textContent → XSS-safe.
   */
  _ensureTithe() {
    if (this._tithe || typeof document === 'undefined') return this._tithe;
    if (!document.getElementById('flk-tithe-style')) {
      const style = document.createElement('style');
      style.id = 'flk-tithe-style';
      style.textContent = `
        .flk-tithe{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);
          z-index:1250;pointer-events:auto;display:none;flex-direction:column;
          align-items:center;gap:5px;font-family:system-ui,-apple-system,sans-serif}
        .flk-tithe-btn{appearance:none;cursor:pointer;border:1px solid #5a4a16;
          border-radius:999px;background:rgba(18,16,8,.86);color:#f4e6b0;
          font-size:13px;font-weight:700;letter-spacing:.3px;padding:8px 16px;
          box-shadow:0 8px 22px rgba(0,0,0,.5);transition:background .15s ease,opacity .15s ease}
        .flk-tithe-btn:hover:not(:disabled){background:rgba(40,34,12,.92)}
        .flk-tithe-btn:disabled{opacity:.4;cursor:default}
        .flk-tithe-read{font-size:11px;color:#cfc28a;letter-spacing:.4px;
          text-shadow:0 1px 3px rgba(0,0,0,.7)}
      `;
      document.head.appendChild(style);
    }
    const wrap = document.createElement('div');
    wrap.className = 'flk-tithe';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flk-tithe-btn';
    btn.textContent = '🪶 TITHE 50 → buy mercy';
    // Click only — never steals game keys (no key listeners). Prevent the click
    // from bubbling to canvas/game handlers just in case.
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!btn.disabled) this.tithe(50);
    });

    const read = document.createElement('div');
    read.className = 'flk-tithe-read';
    read.textContent = 'favor 0 · score 0';

    wrap.appendChild(btn);
    wrap.appendChild(read);
    document.body.appendChild(wrap);
    this._tithe = { wrap, btn, read };
    return this._tithe;
  }

  _setTithe(on) {
    const t = this._ensureTithe();
    if (t) t.wrap.style.display = on ? 'flex' : 'none';
  }

  /** Refresh the TITHE readout + button-enabled state from my live rows. */
  _updateTithe(score, favor) {
    const t = this._tithe;
    if (!t) return;
    const s = Math.max(0, Math.floor(score));
    const f = Math.max(0, Math.round(favor));
    t.read.textContent = `favor ${f} · score ${s}`;
    t.btn.disabled = s < 50;
  }

  /**
   * Lazily create + return the LIVE COMMENTARY ticker (sleek bottom-center glass
   * pill). Pure display: pointer-events none, never steals input. Each new line
   * re-triggers a fade/slide-in animation. All text via textContent → XSS-safe.
   */
  _ensureTicker() {
    if (this._ticker || typeof document === 'undefined') return this._ticker;
    if (!document.getElementById('flk-ticker-style')) {
      const style = document.createElement('style');
      style.id = 'flk-ticker-style';
      style.textContent = `
        @keyframes flkTickerIn {
          from { opacity:0; transform:translate(-50%, 14px); }
          to   { opacity:1; transform:translate(-50%, 0); }
        }
        .flk-ticker{position:fixed;left:50%;bottom:74px;transform:translate(-50%,0);
          z-index:1240;pointer-events:none;display:none;max-width:min(72vw,640px);
          padding:9px 20px;border-radius:999px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(12,14,20,.62);backdrop-filter:blur(10px);
          -webkit-backdrop-filter:blur(10px);
          box-shadow:0 10px 30px rgba(0,0,0,.45);
          font-family:system-ui,-apple-system,sans-serif;font-size:14px;
          font-weight:600;letter-spacing:.2px;line-height:1.3;color:#eef2ff;
          text-align:center;text-shadow:0 1px 4px rgba(0,0,0,.6);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .flk-ticker.flk-ticker-anim{animation:flkTickerIn .42s cubic-bezier(.2,.8,.2,1)}
      `;
      document.head.appendChild(style);
    }
    const el = document.createElement('div');
    el.className = 'flk-ticker';
    document.body.appendChild(el);
    this._ticker = el;
    return el;
  }

  _setTicker(on) {
    const el = this._ensureTicker();
    if (el) el.style.display = on ? 'block' : 'none';
  }

  /**
   * Show the newest commentary line for my room while playing. Dedupes on row id
   * so the fade/slide-in only fires when the line actually changes.
   */
  _updateTicker(roomId) {
    const row = this._latestCommentary(roomId);
    if (!row) { this._setTicker(false); return; }
    const el = this._ensureTicker();
    if (!el) return;
    if (row.id !== this._tickerId) {
      this._tickerId = row.id;
      el.textContent = row.text || '';            // XSS-safe
      // Restart the entrance animation on each new line.
      el.classList.remove('flk-ticker-anim');
      void el.offsetWidth;                          // reflow → re-trigger keyframes
      el.classList.add('flk-ticker-anim');
    }
    this._setTicker(true);
  }

  /**
   * Survival-mode driver: mirrors _driveRace's world application, then adds
   * the predator hawk, sabotage FX, proximity elimination, and HUNTED vignette.
   * Race mode is never touched by this path.
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
      this._setTithe(false);
      this._survWorldApplied = false;
      this._huntTimer = 0;
      this._deathReported = false;
      return;
    }

    // Apply the synced world ONCE (palette + course) exactly like _driveRace.
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

    // Covert TITHE control: visible only while alive & playing. Drives off my
    // live player score + my private favor_ledger row.
    if (!this.amDead) {
      this._setTithe(true);
      const myRow = this._myRow();
      const favRow = this._favorRow(room.id);
      this._updateTithe(myRow ? myRow.score : 0, favRow ? favRow.favor : 0);
    } else {
      this._setTithe(false);
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
