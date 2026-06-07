/**
 * THE HUNT — FLOCKD AI Director live dashboard.
 *
 * A standalone, READ-ONLY visualizer that proves the LLM genuinely drives the
 * survival predator. It subscribes to the same SpacetimeDB rows the game writes
 * (director_log / predator / sabotage_event / player / room) and renders them:
 * current decision, a live reasoning feed, a sabotage timeline, a Canvas2D radar
 * and a derived L4D-style director-state chip.
 *
 * It NEVER calls a reducer. All model/user text (reasoning, taunt, names,
 * reason) goes through textContent — XSS-safe. Static chrome may use innerHTML.
 */
import { connectToFlocked } from '../net/connection.js';

// ---------------------------------------------------------------- constants
const DB_NAME = 'flocked';

// 8-colour bird palette (matches MenuShell / world palette exactly).
const PALETTE = [
  '#ff5a5f', '#3fa7ff', '#5ad469', '#ffd23f',
  '#b06bff', '#ff8c42', '#2ec4b6', '#f15bb5',
];

// Sabotage kind → icon + human label. Unknown kinds fall back gracefully.
const SABOTAGE = {
  wingclip: { icon: '✂️', label: 'WING CLIP' },   // ✂️
  fog:      { icon: '🌫️', label: 'FOG' },    // 🌫️
  headwind: { icon: '💨', label: 'HEADWIND' },     // 💨
  scatter:  { icon: '🎲', label: 'SCATTER' },      // 🎲
};
function sabotageMeta(kind) {
  const k = String(kind || '').toLowerCase();
  return SABOTAGE[k] || { icon: '⚡', label: (kind || 'sabotage').toUpperCase() };
}

const REASON_MAX = 40;       // prune the reasoning feed to this many rows
const SABO_MAX = 24;         // keep at most this many sabotage chips
const PERSONA = 'SKRAAH — THE HUNT';

// ---------------------------------------------------------------- helpers
/** Mirror src/net/index.js defaultUri logic (ws localhost, ?stdb override, else maincloud). */
function defaultUri() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://localhost:3000';
  const param = new URLSearchParams(location.search).get('stdb');
  return param || 'wss://maincloud.spacetimedb.com';
}

function paletteColor(idx) {
  const i = ((Number(idx) % 8) + 8) % 8;
  return PALETTE[Number.isFinite(i) ? i : 0] || '#ffffff';
}

/** ms-resolution wall clock from a SpacetimeDB Timestamp (best-effort across shapes). */
function tsToMillis(ts) {
  if (ts == null) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  } catch { /* fall through */ }
  // Common field shapes: microsSinceUnixEpoch (bigint) or __timestamp_micros_since_unix_epoch__
  const micros = ts.microsSinceUnixEpoch ?? ts.__timestamp_micros_since_unix_epoch__;
  if (micros != null) { try { return Number(micros / 1000n); } catch { return Number(micros) / 1000; } }
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts / 1000n);
  return null;
}

function clockLabel(millis) {
  if (millis == null) return '--:--:--';
  const d = new Date(millis);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ---------------------------------------------------------------- styles
const CSS = `
#hunt{max-width:1180px;margin:0 auto;padding:22px 20px 0;display:flex;flex-direction:column;gap:18px}

/* ---- header ---- */
.h-top{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
.h-brand{display:flex;flex-direction:column;gap:4px}
.h-mark{font-weight:900;letter-spacing:4px;font-size:30px;line-height:1;
  background:linear-gradient(180deg,#fff,#cdb4ff);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 0 26px rgba(176,107,255,.5)}
.h-persona{font-size:12px;letter-spacing:2.2px;text-transform:uppercase;color:#c69cff;font-weight:700}
.h-live{display:flex;align-items:center;gap:9px;font-size:12px;letter-spacing:1px;color:var(--muted);font-weight:700}
.h-dot{width:11px;height:11px;border-radius:50%;background:#5d6f95}
.h-live.on .h-dot{background:var(--blood);box-shadow:0 0 12px rgba(255,77,77,.95);animation:huntPulse 1.2s ease-in-out infinite}
@keyframes huntPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}

.h-stats{display:flex;gap:10px;flex-wrap:wrap}
.stat{background:var(--panel);border:1px solid var(--panelBorder);border-radius:14px;
  padding:10px 16px;display:flex;flex-direction:column;gap:2px;min-width:78px;backdrop-filter:blur(8px)}
.stat b{font-size:20px;font-weight:900;letter-spacing:.5px;font-variant-numeric:tabular-nums}
.stat span{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);font-weight:700}
.dstate{background:rgba(176,107,255,.14);border-color:rgba(176,107,255,.4)}
.dstate b{color:#d9c2ff}
.dstate.peak{background:rgba(255,77,77,.16);border-color:rgba(255,77,77,.5)}
.dstate.peak b{color:#ff9a9a}
.dstate.relax{background:rgba(75,227,138,.12);border-color:rgba(75,227,138,.4)}
.dstate.relax b{color:#9af0bf}

/* ---- empty state ---- */
.empty{background:var(--panel);border:1px solid var(--panelBorder);border-radius:20px;
  padding:60px 30px;text-align:center;backdrop-filter:blur(10px)}
.empty .e-eye{font-size:46px;margin-bottom:14px;filter:drop-shadow(0 0 18px rgba(176,107,255,.5))}
.empty h2{font-size:19px;font-weight:800;margin-bottom:8px}
.empty p{color:var(--muted);font-size:14px;line-height:1.6;max-width:440px;margin:0 auto}

/* ---- grid ---- */
.grid{display:grid;grid-template-columns:1.35fr 1fr;gap:18px;align-items:start}
.col{display:flex;flex-direction:column;gap:18px;min-width:0}
.card{background:var(--panel);border:1px solid var(--panelBorder);border-radius:18px;
  padding:18px 18px 16px;backdrop-filter:blur(10px);box-shadow:0 20px 60px rgba(0,0,0,.35)}
.card-h{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);
  font-weight:800;margin-bottom:12px;display:flex;align-items:center;gap:8px;justify-content:space-between}
.card-h .hint{color:var(--dim);font-weight:600;letter-spacing:.5px;text-transform:none}

/* ---- decision card ---- */
.dec-target{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.dec-lead{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);font-weight:700}
.namechip{display:inline-flex;align-items:center;gap:9px;border-radius:999px;padding:8px 16px 8px 12px;
  font-weight:800;font-size:16px;background:rgba(10,14,30,.6);border:1px solid rgba(120,140,220,.3)}
.namechip .nd{width:14px;height:14px;border-radius:50%;box-shadow:0 0 10px currentColor;flex:0 0 auto}
.dec-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.badge{display:inline-flex;align-items:center;gap:7px;border-radius:10px;padding:7px 13px;
  font-weight:800;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;
  background:rgba(127,166,255,.16);border:1px solid rgba(127,166,255,.4);color:#cfe0ff}
.badge.chase{background:rgba(255,77,77,.16);border-color:rgba(255,77,77,.45);color:#ff9a9a}
.badge.ambush{background:rgba(176,107,255,.18);border-color:rgba(176,107,255,.45);color:#d9c2ff}
.badge.intercept{background:rgba(255,140,66,.16);border-color:rgba(255,140,66,.45);color:#ffc08a}
.sab-active{background:rgba(10,14,30,.5);border:1px solid rgba(120,140,220,.2);border-radius:13px;
  padding:11px 14px;display:flex;flex-direction:column;gap:9px}
.sab-active .sa-top{display:flex;align-items:center;gap:9px;font-weight:800;font-size:13px;letter-spacing:.6px}
.sab-active .sa-ico{font-size:18px}
.sab-active .sa-mag{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.5px;margin-left:auto}
.magbar{height:8px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.magbar i{display:block;height:100%;border-radius:99px;
  background:linear-gradient(90deg,#ff8c42,#ff4d4d);box-shadow:0 0 12px rgba(255,77,77,.6);transition:width .4s ease}
.dec-none{color:var(--dim);font-size:13px;font-style:italic}

/* ---- reasoning feed (terminal of the mind) ---- */
.feed{display:flex;flex-direction:column;gap:11px;max-height:560px;overflow:auto;
  font-family:var(--mono);scroll-behavior:smooth}
.fr{border-left:2px solid rgba(176,107,255,.5);padding:2px 0 2px 12px;animation:frIn .3s ease}
@keyframes frIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.fr-meta{display:flex;gap:10px;align-items:baseline;font-size:10.5px;color:var(--dim);
  letter-spacing:.5px;margin-bottom:4px;flex-wrap:wrap}
.fr-meta .t{color:#8f7bd6;font-weight:700}
.fr-meta .b{color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.fr-meta .tgt{color:var(--ink);font-weight:700}
.fr-reason{font-size:13px;line-height:1.55;color:#d7e2f7;white-space:pre-wrap;word-break:break-word}
.fr-taunt{margin-top:6px;font-size:12.5px;line-height:1.5;color:#ff9a9a;font-style:italic;
  white-space:pre-wrap;word-break:break-word}
.fr-taunt::before{content:'\\201C'}
.fr-taunt::after{content:'\\201D'}
.feed-empty{color:var(--dim);font-size:13px;font-style:italic;font-family:var(--sans)}

/* ---- sabotage timeline ---- */
.sabo{display:flex;flex-direction:column;gap:9px;max-height:260px;overflow:auto}
.sabo-chip{display:flex;align-items:flex-start;gap:11px;background:rgba(10,14,30,.5);
  border:1px solid rgba(120,140,220,.2);border-radius:13px;padding:10px 13px;animation:frIn .3s ease}
.sabo-chip .ico{font-size:20px;line-height:1.2;flex:0 0 auto}
.sabo-chip .body{min-width:0;display:flex;flex-direction:column;gap:3px;flex:1 1 auto}
.sabo-chip .ttl{font-weight:800;font-size:12.5px;letter-spacing:.6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sabo-chip .ttl .mag{color:var(--muted);font-weight:700;font-size:11px}
.sabo-chip .rsn{font-size:12px;color:#c4d2ec;line-height:1.45;word-break:break-word}
.sabo-chip .tgt{font-size:10.5px;color:var(--dim);letter-spacing:.5px}
.sabo-empty{color:var(--dim);font-size:13px;font-style:italic}

/* ---- radar ---- */
.radar-wrap{display:flex;flex-direction:column;align-items:center;gap:10px}
#radar{border-radius:14px;background:radial-gradient(circle at 50% 50%,rgba(20,12,38,.9),rgba(8,6,18,.95));
  border:1px solid rgba(176,107,255,.25);box-shadow:inset 0 0 40px rgba(0,0,0,.5);width:100%;max-width:240px;height:auto}
.radar-legend{display:flex;gap:14px;font-size:11px;color:var(--muted);font-weight:600;flex-wrap:wrap;justify-content:center}
.radar-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}

.foot{text-align:center;color:var(--dim);font-size:11px;letter-spacing:.5px;padding:8px 0 0}
.foot b{color:var(--muted)}

@media (max-width:860px){
  .grid{grid-template-columns:1fr}
  .h-mark{font-size:24px}
  #hunt{padding:16px 14px 0}
  .feed{max-height:440px}
}
@media (prefers-reduced-motion:reduce){
  #hunt *{animation:none!important}
  .feed{scroll-behavior:auto}
}
`;

// ---------------------------------------------------------------- the app
class HuntDashboard {
  constructor(mount) {
    this.mount = mount;
    this.conn = null;
    this.connected = false;

    this.roomFilter = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase() || null;
    this.room = null;            // resolved room row
    this.roomId = 0n;

    this.sabotageEvents = [];    // captured via onInsert (EVENT table)
    this._reasonKeys = new Set();// director_log ids already in the feed
    this._lastDecisionId = null;
    this._dirty = true;          // re-render requested

    this._build();
  }

  // ---- DOM scaffolding (static chrome → innerHTML ok) -------------------
  _build() {
    if (!document.getElementById('hunt-style')) {
      const s = document.createElement('style');
      s.id = 'hunt-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    const root = el('div'); root.id = 'hunt';

    // Header
    const top = el('div', 'h-top');
    const brand = el('div', 'h-brand');
    brand.appendChild(el('div', 'h-mark', 'THE HUNT'));
    brand.appendChild(el('div', 'h-persona', PERSONA));
    top.appendChild(brand);

    const live = el('div', 'h-live'); this.elLive = live;
    live.appendChild(el('span', 'h-dot'));
    this.elLiveLabel = el('span', null, 'CONNECTING');
    live.appendChild(this.elLiveLabel);
    top.appendChild(live);
    root.appendChild(top);

    // Stat row
    this.elStats = el('div', 'h-stats');
    root.appendChild(this.elStats);

    // Body holder (swaps between empty-state and grid)
    this.elBody = el('div');
    root.appendChild(this.elBody);

    const foot = el('div', 'foot');
    foot.appendChild(document.createTextNode('Read-only · subscribes to live SpacetimeDB rows · '));
    const b = el('b', null, 'no reducers called'); foot.appendChild(b);
    foot.appendChild(document.createTextNode('. Decisions authored by Claude in real time.'));
    root.appendChild(foot);

    this.mount.innerHTML = '';
    this.mount.appendChild(root);

    this._buildGrid();
    this._renderEmpty();
  }

  _buildGrid() {
    const grid = el('div', 'grid');

    // LEFT column: decision card + reasoning feed
    const left = el('div', 'col');

    // Decision card
    const dec = el('div', 'card');
    const decH = el('div', 'card-h');
    decH.appendChild(el('span', null, 'CURRENT DECISION'));
    this.elDecHint = el('span', 'hint', '');
    decH.appendChild(this.elDecHint);
    dec.appendChild(decH);
    this.elDecBody = el('div');
    dec.appendChild(this.elDecBody);
    left.appendChild(dec);

    // Reasoning feed
    const feedCard = el('div', 'card');
    const feedH = el('div', 'card-h');
    feedH.appendChild(el('span', null, 'REASONING FEED'));
    feedH.appendChild(el('span', 'hint', 'newest first'));
    feedCard.appendChild(feedH);
    this.elFeed = el('div', 'feed');
    this.elFeed.appendChild(el('div', 'feed-empty', 'No director reasoning yet — waiting for the first decision…'));
    feedCard.appendChild(this.elFeed);
    left.appendChild(feedCard);

    grid.appendChild(left);

    // RIGHT column: radar + sabotage timeline
    const right = el('div', 'col');

    // Radar
    const radarCard = el('div', 'card');
    radarCard.appendChild((() => { const h = el('div', 'card-h'); h.appendChild(el('span', null, 'PREDATOR RADAR')); h.appendChild(el('span', 'hint', 'top-down')); return h; })());
    const rw = el('div', 'radar-wrap');
    this.elRadar = document.createElement('canvas');
    this.elRadar.id = 'radar';
    this.elRadar.width = 440; this.elRadar.height = 440; // 2x for retina; CSS scales down
    rw.appendChild(this.elRadar);
    const legend = el('div', 'radar-legend');
    const lg = (color, label) => { const s = el('span'); const i = el('i'); i.style.background = color; s.appendChild(i); s.appendChild(document.createTextNode(label)); return s; };
    legend.appendChild(lg('#ff4d4d', 'predator'));
    legend.appendChild(lg('#7fa6ff', 'birds'));
    legend.appendChild(lg('#5d6f95', 'eliminated'));
    rw.appendChild(legend);
    radarCard.appendChild(rw);
    right.appendChild(radarCard);

    // Sabotage timeline
    const saboCard = el('div', 'card');
    saboCard.appendChild((() => { const h = el('div', 'card-h'); h.appendChild(el('span', null, 'SABOTAGE TIMELINE')); h.appendChild(el('span', 'hint', 'live')); return h; })());
    this.elSabo = el('div', 'sabo');
    this.elSabo.appendChild(el('div', 'sabo-empty', 'No sabotage deployed yet.'));
    saboCard.appendChild(this.elSabo);
    right.appendChild(saboCard);

    grid.appendChild(right);
    this.elGrid = grid;
  }

  // ---- connection ------------------------------------------------------
  connect() {
    const uri = defaultUri();
    this.conn = connectToFlocked({
      uri,
      dbName: DB_NAME,
      // Distinct token key so a watcher tab never clashes with a player tab.
      // connection.js uses a fixed 'flocked.token' key, so we swap a dashboard
      // token in around the connect call to keep the dashboard identity separate.
      tokenKey: 'flockd.dashboard.token',
      onConnect: (conn) => {
        this.connected = true;
        this._setLive(true, 'LIVE');
        conn.subscriptionBuilder()
          .onApplied(() => { this._resolveRoom(); this._dirty = true; })
          .subscribe([
            'SELECT * FROM room', 'SELECT * FROM player', 'SELECT * FROM predator',
            'SELECT * FROM director_log', 'SELECT * FROM sabotage_event',
          ]);
        this._wireCallbacks(conn);
        // eslint-disable-next-line no-console
        console.log('[hunt] connected, watching for survival rooms…');
      },
      onDisconnect: () => {
        this.connected = false;
        this._setLive(false, 'DISCONNECTED');
      },
      onError: (err) => {
        this._setLive(false, 'CONNECT ERROR');
        // eslint-disable-next-line no-console
        console.warn('[hunt] connect error:', err);
      },
    });
  }

  _wireCallbacks(conn) {
    const touch = () => { this._dirty = true; };
    const onRoom = () => { this._resolveRoom(); this._dirty = true; };

    // Room set changes → may reveal a newer survival match.
    conn.db.room.onInsert(onRoom);
    conn.db.room.onUpdate(onRoom);
    conn.db.room.onDelete(onRoom);

    conn.db.player.onInsert(touch);
    conn.db.player.onUpdate(touch);
    conn.db.player.onDelete(touch);

    conn.db.predator.onInsert(touch);
    conn.db.predator.onUpdate(touch);
    conn.db.predator.onDelete(touch);

    // director_log is append-mostly; refresh the feed + decision on insert.
    conn.db.directorLog.onInsert(touch);
    conn.db.directorLog.onUpdate(touch);

    // sabotage_event is an EVENT table → rows arrive via onInsert; keep an array.
    conn.db.sabotageEvent.onInsert((_ctx, row) => {
      this.sabotageEvents.push(row);
      if (this.sabotageEvents.length > SABO_MAX * 3) {
        this.sabotageEvents = this.sabotageEvents.slice(-SABO_MAX * 3);
      }
      this._dirty = true;
    });
  }

  _setLive(on, label) {
    this.elLive.classList.toggle('on', !!on);
    this.elLiveLabel.textContent = label;
  }

  // ---- room resolution -------------------------------------------------
  _resolveRoom() {
    if (!this.conn) return;
    let chosen = null;
    for (const r of this.conn.db.room.iter()) {
      if (this.roomFilter) {
        if (String(r.code || '').toUpperCase() === this.roomFilter) { chosen = r; break; }
        continue;
      }
      // Default: most recent (highest id) survival room.
      if (r.mode !== 'survival') continue;
      if (!chosen || r.id > chosen.id) chosen = r;
    }
    const prevId = this.roomId;
    this.room = chosen;
    this.roomId = chosen ? chosen.id : 0n;
    if (chosen && chosen.id !== prevId) {
      // New room focus → reset per-match collected state.
      this.sabotageEvents = this.sabotageEvents.filter((e) => e.roomId === chosen.id);
      this._reasonKeys.clear();
      this._lastDecisionId = null;
      if (this.elFeed) {
        this.elFeed.innerHTML = '';
        this.elFeed.appendChild(el('div', 'feed-empty', 'No director reasoning yet — waiting for the first decision…'));
      }
    }
  }

  // ---- per-room data pulls --------------------------------------------
  _playersInRoom() {
    const out = [];
    if (!this.conn || this.roomId === 0n) return out;
    for (const p of this.conn.db.player.iter()) {
      if (p.roomId === this.roomId) out.push(p);
    }
    return out;
  }

  _predatorRow() {
    if (!this.conn || this.roomId === 0n) return null;
    for (const p of this.conn.db.predator.iter()) if (p.roomId === this.roomId) return p;
    return null;
  }

  /** director_log rows for this room, newest first. */
  _directorLogs() {
    const out = [];
    if (!this.conn || this.roomId === 0n) return out;
    for (const d of this.conn.db.directorLog.iter()) {
      if (d.roomId === this.roomId) out.push(d);
    }
    out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)); // bigint desc
    return out;
  }

  // ---- render ----------------------------------------------------------
  _renderEmpty() {
    this.elBody.innerHTML = '';
    const e = el('div', 'empty');
    e.appendChild(el('div', 'e-eye', '👁️')); // 👁️
    e.appendChild(el('h2', null, 'The hunt has not begun.'));
    e.appendChild(el('p', null, 'Waiting for a survival match… start one in the game. This dashboard will light up the moment SKRAAH takes flight.'));
    this.elBody.appendChild(e);
    this._showingGrid = false;
  }

  _ensureGrid() {
    if (this._showingGrid) return;
    this.elBody.innerHTML = '';
    this.elBody.appendChild(this.elGrid);
    this._showingGrid = true;
  }

  render() {
    // Header stats always reflect connection + chosen room.
    this._renderStats();

    if (!this.room) { if (this._showingGrid) this._renderEmpty(); return; }
    this._ensureGrid();

    this._renderDecision();
    this._renderFeed();
    this._renderSabotage();
    this._renderRadar();
  }

  _renderStats() {
    const players = this._playersInRoom();
    const alive = players.filter((p) => p.alive && !p.finished).length;
    const room = this.room;
    const logs = room ? this._directorLogs() : [];
    const dstate = this._directorState(logs);

    const stats = this.elStats;
    stats.innerHTML = '';
    const add = (value, label, extraCls) => {
      const s = el('div', 'stat' + (extraCls ? ' ' + extraCls : ''));
      s.appendChild(el('b', null, value));
      s.appendChild(el('span', null, label));
      stats.appendChild(s);
    };
    add(room ? String(room.code) : '—', 'room');
    add(room ? String(room.mode || '—') : '—', 'mode');
    add(room ? String(room.tick) : '—', 'tick');
    add(room ? String(alive) : '—', 'alive');
    if (room) {
      const s = el('div', 'stat dstate ' + dstate.cls);
      s.appendChild(el('b', null, dstate.label));
      s.appendChild(el('span', null, 'director'));
      stats.appendChild(s);
    }
  }

  /** L4D-style buildup/peak/relax derived from recent behavior + sabotage cadence. */
  _directorState(logs) {
    const now = Date.now();
    // Sabotage in the last 12s → PEAK pressure.
    let recentSabo = 0;
    for (const ev of this.sabotageEvents) {
      const t = tsToMillis(ev.createdAt);
      if (t != null && now - t < 12000) recentSabo++;
    }
    const pred = this._predatorRow();
    const beh = (logs[0] && logs[0].behavior) || (pred && pred.behavior) || '';
    const aggressive = /chase|ambush|intercept/i.test(beh);

    if (recentSabo >= 1 || (aggressive && pred && pred.active)) {
      return { cls: 'peak', label: 'PEAK' };
    }
    // Recent decision but calm behavior → relax window.
    if (/patrol|circle|relax|wait/i.test(beh)) return { cls: 'relax', label: 'RELAX' };
    return { cls: '', label: 'BUILD-UP' };
  }

  _renderDecision() {
    const logs = this._directorLogs();
    const latest = logs[0];
    const body = this.elDecBody;
    body.innerHTML = '';

    if (!latest) {
      body.appendChild(el('div', 'dec-none', 'No decision logged yet for this match.'));
      this.elDecHint.textContent = '';
      return;
    }
    this.elDecHint.textContent = '#' + String(latest.id);

    // TARGET — colored name chip (look up the player's palette color).
    const targetRow = (() => {
      const name = String(latest.targetName || '');
      for (const p of this._playersInRoom()) if (String(p.name) === name) return p;
      return null;
    })();
    const trow = el('div', 'dec-target');
    trow.appendChild(el('span', 'dec-lead', 'Target'));
    const chip = el('div', 'namechip');
    const dot = el('span', 'nd');
    const col = targetRow ? paletteColor(targetRow.color) : '#9fb2d8';
    dot.style.background = col; dot.style.color = col;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(latest.targetName || 'the flock'));
    trow.appendChild(chip);
    body.appendChild(trow);

    // BEHAVIOR badge + sabotage kind badge.
    const row = el('div', 'dec-row');
    const beh = String(latest.behavior || '').toLowerCase();
    const behBadge = el('span', 'badge ' + (/chase|ambush|intercept/.test(beh) ? beh.match(/chase|ambush|intercept/)[0] : ''));
    behBadge.appendChild(document.createTextNode(latest.behavior || 'unknown'));
    row.appendChild(behBadge);
    body.appendChild(row);

    // Active sabotage (kind + magnitude bar), derived from the latest sabotage event.
    const sk = String(latest.sabotageKind || '').toLowerCase();
    const lastSabo = this.sabotageEvents.length ? this.sabotageEvents[this.sabotageEvents.length - 1] : null;
    const showKind = (sk && sk !== 'none') ? sk : (lastSabo ? String(lastSabo.kind).toLowerCase() : '');
    if (showKind && showKind !== 'none') {
      const meta = sabotageMeta(showKind);
      const mag = lastSabo && String(lastSabo.kind).toLowerCase() === showKind
        ? Number(lastSabo.magnitude) : null;
      const box = el('div', 'sab-active');
      const top = el('div', 'sa-top');
      top.appendChild(el('span', 'sa-ico', meta.icon));
      top.appendChild(document.createTextNode(meta.label));
      if (mag != null && Number.isFinite(mag)) {
        const magPct = Math.max(0, Math.min(1, mag)) * 100;
        top.appendChild(el('span', 'sa-mag', 'magnitude ' + mag.toFixed(2)));
        const bar = el('div', 'magbar');
        const fill = el('i'); fill.style.width = magPct.toFixed(0) + '%';
        bar.appendChild(fill);
        box.appendChild(top);
        box.appendChild(bar);
      } else {
        box.appendChild(top);
      }
      body.appendChild(box);
    }
  }

  _renderFeed() {
    const logs = this._directorLogs(); // newest first
    if (!logs.length) return;

    // Determine which logs are new (not yet in the feed) → prepend them.
    const toAdd = [];
    for (const d of logs) {
      const key = String(d.id);
      if (!this._reasonKeys.has(key)) { toAdd.push(d); this._reasonKeys.add(key); }
    }
    if (!toAdd.length) return;

    // Remove the empty placeholder once we have content.
    const placeholder = this.elFeed.querySelector('.feed-empty');
    if (placeholder) placeholder.remove();

    // toAdd is newest-first; insert in reverse so newest ends up at top.
    const ascending = toAdd.slice().reverse();
    for (const d of ascending) {
      this.elFeed.insertBefore(this._feedRow(d), this.elFeed.firstChild);
    }

    // Prune to REASON_MAX rows.
    while (this.elFeed.children.length > REASON_MAX) {
      this.elFeed.removeChild(this.elFeed.lastChild);
    }
  }

  _feedRow(d) {
    const fr = el('div', 'fr');
    const meta = el('div', 'fr-meta');
    meta.appendChild(el('span', 't', clockLabel(tsToMillis(d.createdAt))));
    if (d.behavior) meta.appendChild(el('span', 'b', String(d.behavior)));
    if (d.targetName) {
      const tgt = el('span', 'tgt');
      tgt.appendChild(document.createTextNode('→ ' + d.targetName));
      meta.appendChild(tgt);
    }
    fr.appendChild(meta);

    const reason = el('div', 'fr-reason');
    reason.appendChild(document.createTextNode(d.reasoning || '(no reasoning recorded)'));
    fr.appendChild(reason);

    if (d.taunt && String(d.taunt).trim()) {
      const taunt = el('div', 'fr-taunt');
      taunt.appendChild(document.createTextNode(d.taunt));
      fr.appendChild(taunt);
    }
    return fr;
  }

  _renderSabotage() {
    const list = this.sabotageEvents
      .filter((e) => e.roomId === this.roomId)
      .slice()
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)) // newest first
      .slice(0, SABO_MAX);

    this.elSabo.innerHTML = '';
    if (!list.length) {
      this.elSabo.appendChild(el('div', 'sabo-empty', 'No sabotage deployed yet.'));
      return;
    }

    const players = this._playersInRoom();
    const nameFor = (identity) => {
      try {
        const hex = identity.toHexString();
        for (const p of players) if (p.identity.toHexString() === hex) return p.name;
      } catch { /* ignore */ }
      return null;
    };

    for (const ev of list) {
      const meta = sabotageMeta(ev.kind);
      const chip = el('div', 'sabo-chip');
      chip.appendChild(el('div', 'ico', meta.icon));
      const bodyEl = el('div', 'body');

      const ttl = el('div', 'ttl');
      ttl.appendChild(document.createTextNode(meta.label));
      const mag = Number(ev.magnitude);
      if (Number.isFinite(mag)) ttl.appendChild(el('span', 'mag', '· ' + mag.toFixed(2)));
      bodyEl.appendChild(ttl);

      if (ev.reason && String(ev.reason).trim()) {
        const rsn = el('div', 'rsn');
        rsn.appendChild(document.createTextNode(ev.reason));
        bodyEl.appendChild(rsn);
      }

      const tname = nameFor(ev.target);
      const tgt = el('div', 'tgt');
      const dur = Number(ev.durationMs);
      const durTxt = Number.isFinite(dur) && dur > 0 ? ' · ' + (dur / 1000).toFixed(1) + 's' : '';
      tgt.appendChild(document.createTextNode('on ' + (tname || 'flock') + durTxt + ' · ' + clockLabel(tsToMillis(ev.createdAt))));
      bodyEl.appendChild(tgt);

      chip.appendChild(bodyEl);
      this.elSabo.appendChild(chip);
    }
  }

  _renderRadar() {
    const cv = this.elRadar;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const players = this._playersInRoom();
    const pred = this._predatorRow();

    // Collect world points to auto-fit (XZ plane top-down).
    const pts = [];
    for (const p of players) pts.push({ x: p.x, z: p.z });
    if (pred) pts.push({ x: pred.x, z: pred.z });

    // Grid backdrop.
    ctx.strokeStyle = 'rgba(176,107,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const g = (i / 6) * W;
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(176,107,255,0.22)';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 6, 0, Math.PI * 2); ctx.stroke();

    if (!pts.length) {
      ctx.fillStyle = 'rgba(159,178,216,0.5)';
      ctx.font = '18px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.fillText('no signal', W / 2, H / 2);
      return;
    }

    // Auto-scale: center on the bounds, fit the largest extent into the canvas.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 60); // min span so a lone dot isn't huge
    const pad = 28;
    const scale = (W - pad * 2) / (span * 1.15);
    const toPx = (x, z) => ({
      px: W / 2 + (x - cx) * scale,
      py: H / 2 + (z - cz) * scale,
    });

    // Line predator → target.
    if (pred && pred.active) {
      let targetHex = null;
      try { targetHex = pred.targetPlayer.toHexString(); } catch { targetHex = null; }
      const target = targetHex ? players.find((p) => { try { return p.identity.toHexString() === targetHex; } catch { return false; } }) : null;
      if (target) {
        const a = toPx(pred.x, pred.z);
        const b = toPx(target.x, target.z);
        ctx.strokeStyle = 'rgba(255,77,77,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Birds.
    for (const p of players) {
      const { px, py } = toPx(p.x, p.z);
      const alive = p.alive && !p.finished;
      const color = alive ? paletteColor(p.color) : '#5d6f95';
      ctx.beginPath();
      ctx.arc(px, py, alive ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      if (alive) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Predator (red, larger, with a heading wedge).
    if (pred) {
      const { px, py } = toPx(pred.x, pred.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-(pred.yaw || 0));
      ctx.fillStyle = pred.active ? '#ff4d4d' : '#aa6666';
      ctx.shadowColor = '#ff4d4d'; ctx.shadowBlur = pred.active ? 16 : 6;
      ctx.beginPath();
      ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  // ---- run loop --------------------------------------------------------
  start() {
    this.connect();
    const tick = () => {
      if (this._dirty) { this._dirty = false; try { this.render(); } catch (e) { /* eslint-disable-next-line no-console */ console.warn('[hunt] render error', e); } }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Light periodic refresh so derived state (director state windows, radar) stays fresh.
    setInterval(() => { this._dirty = true; }, 1000);
  }
}

// ---------------------------------------------------------------- bootstrap
const mount = document.getElementById('app');
if (mount) {
  const app = new HuntDashboard(mount);
  app.start();
}
