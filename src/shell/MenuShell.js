/**
 * MenuShell — the front-end SHELL for FLOCKD.
 *
 * A self-contained DOM overlay that sits ON TOP of the always-running WebGL
 * canvas. Drives the pipeline:
 *   auth (callsign) -> HOME (locker: color + mode + create/join)
 *      -> game world -> leave/finish -> back to HOME -> repeat.
 *
 * All CSS classes are prefixed "flk2-" so they never collide with the in-room
 * lobby ("flk-") or anything else on the page.
 *
 * API (built to the main.js contract):
 *   new MenuShell({ palette, name, color, onCommit, onSetName, onSetColor, onLeave })
 *   mount()
 *   enterGame()
 *   returnToMenu()
 *   showConnecting(msg)
 *   setConnected(isConnected)
 *   showWaitingRoom({ code, mode, isHost, roster, onStart })
 *   setRoster(roster)
 *   showResults({ rows, onAgain })
 *   hideAll()
 *   get currentName()
 *   get currentColor()
 */

const LS_NAME = 'flockd.name';
const LS_COLOR = 'flockd.color';
const STYLE_ID = 'flk2-style';
const ROOT_ID = 'flk2-root';

const DEFAULT_PALETTE = [
  '#ff5a5f', '#3fa7ff', '#5ad469', '#ffd23f',
  '#b06bff', '#ff8c42', '#2ec4b6', '#f15bb5',
];

// Inline SVG bird silhouette (viewBox 0 0 200 160). Uses currentColor so we can
// recolor the whole shape via a CSS variable / color property.
const BIRD_SVG = `
<svg class="flk2-bird-svg" viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="flk2-birdGrad" cx="42%" cy="34%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
    </radialGradient>
  </defs>
  <g fill="currentColor">
    <!-- body -->
    <path d="M150 78
             C150 52 128 36 100 36
             C70 36 48 54 44 78
             C42 92 50 104 64 110
             C58 120 50 126 42 130
             C56 132 72 130 84 122
             C90 124 96 125 102 125
             C130 125 150 104 150 78 Z"/>
    <!-- wing -->
    <path d="M96 70
             C112 62 134 60 160 66
             C148 80 124 92 100 90
             C92 89 88 80 96 70 Z" fill="#000000" fill-opacity="0.16"/>
    <!-- tail -->
    <path d="M44 80 C30 78 16 84 6 96 C22 96 34 94 46 92 Z"/>
    <!-- beak -->
    <path d="M150 74 L176 70 L150 86 Z" fill="#ffb347"/>
  </g>
  <!-- soft sheen overlay -->
  <path d="M150 78
           C150 52 128 36 100 36
           C70 36 48 54 44 78
           C42 92 50 104 64 110
           C58 120 50 126 42 130
           C56 132 72 130 84 122
           C90 124 96 125 102 125
           C130 125 150 104 150 78 Z" fill="url(#flk2-birdGrad)"/>
  <!-- eye -->
  <circle cx="128" cy="66" r="5.5" fill="#10131c"/>
  <circle cx="130" cy="64" r="1.8" fill="#ffffff"/>
</svg>`;

const CSS = `
#${ROOT_ID}{position:fixed;inset:0;z-index:40;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  color:#eaf2ff;overflow:hidden;-webkit-tap-highlight-color:transparent}
#${ROOT_ID} *{box-sizing:border-box}
#${ROOT_ID} [hidden]{display:none!important}

/* ---------- cinematic backdrop ---------- */
.flk2-backdrop{position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(1200px 700px at 78% 8%, rgba(176,107,255,.30), transparent 60%),
    radial-gradient(1100px 800px at 12% 92%, rgba(63,167,255,.22), transparent 60%),
    linear-gradient(160deg,#0a0e22 0%,#10122e 42%,#1a0f33 100%)}
.flk2-stars{position:absolute;inset:-50% -10%;z-index:0;pointer-events:none;opacity:.7;
  background-image:
    radial-gradient(1.4px 1.4px at 20% 30%, #fff, transparent),
    radial-gradient(1.2px 1.2px at 70% 65%, #cfe0ff, transparent),
    radial-gradient(1.6px 1.6px at 40% 80%, #fff, transparent),
    radial-gradient(1px 1px at 85% 22%, #fff, transparent),
    radial-gradient(1.3px 1.3px at 55% 12%, #d7c4ff, transparent),
    radial-gradient(1px 1px at 12% 60%, #fff, transparent),
    radial-gradient(1.5px 1.5px at 92% 78%, #cfe0ff, transparent);
  background-size:520px 520px;background-repeat:repeat;
  animation:flk2-drift 120s linear infinite}
.flk2-clouds{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.5;
  background:
    radial-gradient(600px 220px at 25% 20%, rgba(120,140,255,.14), transparent 70%),
    radial-gradient(700px 260px at 80% 70%, rgba(180,120,255,.12), transparent 70%);
  animation:flk2-clouddrift 80s ease-in-out infinite alternate}
.flk2-vignette{position:absolute;inset:0;z-index:1;pointer-events:none;
  box-shadow:inset 0 0 240px 60px rgba(2,4,14,.85)}
@keyframes flk2-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-260px,-180px,0)}}
@keyframes flk2-clouddrift{from{transform:translateX(-30px)}to{transform:translateX(30px)}}

/* ---------- screen scaffolding ---------- */
.flk2-screen{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;
  opacity:0;transform:translateY(10px) scale(.995);pointer-events:none;
  transition:opacity .38s ease,transform .38s ease}
.flk2-screen.flk2-on{opacity:1;transform:none;pointer-events:auto}

/* ---------- top chrome ---------- */
.flk2-top{display:flex;align-items:center;justify-content:space-between;
  padding:22px 30px;flex:0 0 auto;gap:16px}
.flk2-wordmark{font-weight:900;letter-spacing:3px;font-size:30px;line-height:1;
  background:linear-gradient(180deg,#fff,#b9c8ff);-webkit-background-clip:text;
  background-clip:text;color:transparent;
  text-shadow:0 0 26px rgba(120,150,255,.55),0 0 60px rgba(176,107,255,.35);
  filter:drop-shadow(0 0 12px rgba(120,150,255,.35))}
.flk2-tagline{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;
  color:#8ea2cc;margin-top:6px;font-weight:600}
.flk2-status{display:flex;align-items:center;gap:9px;font-size:12px;
  color:#9fb2d8;font-weight:600;letter-spacing:.4px}
.flk2-statusdot{width:10px;height:10px;border-radius:50%;background:#f0a93f;
  box-shadow:0 0 10px rgba(240,169,63,.9);transition:background .3s,box-shadow .3s}
.flk2-statusdot.flk2-live{background:#4be38a;box-shadow:0 0 12px rgba(75,227,138,.95)}

/* ---------- HOME layout ---------- */
.flk2-home-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;
  gap:48px;padding:8px 40px 44px;min-height:0}
.flk2-panel{background:rgba(16,20,40,.62);border:1px solid rgba(120,140,220,.18);
  border-radius:24px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  box-shadow:0 30px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06)}

/* locker (left) */
.flk2-locker{width:min(420px,42vw);padding:30px 30px 34px;display:flex;
  flex-direction:column;align-items:center;text-align:center}
.flk2-callsign{display:flex;align-items:center;gap:9px;margin-bottom:6px;
  font-size:13px;color:#9fb2d8;letter-spacing:1.4px;text-transform:uppercase;font-weight:700}
.flk2-callname{font-size:22px;font-weight:800;letter-spacing:.5px;color:#fff;
  max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flk2-pencil{cursor:pointer;border:0;background:transparent;color:#7fa0e0;font-size:15px;
  padding:4px;border-radius:8px;line-height:1;transition:color .2s,transform .15s}
.flk2-pencil:hover{color:#bfd6ff;transform:scale(1.12)}
.flk2-birdstage{position:relative;width:100%;height:230px;display:flex;
  align-items:center;justify-content:center;margin:6px 0 18px}
.flk2-bird{width:74%;max-width:300px;color:var(--flk2-bird,#ff5a5f);
  filter:drop-shadow(0 18px 34px rgba(0,0,0,.55))
         drop-shadow(0 0 30px var(--flk2-glow,rgba(255,90,95,.55)));
  animation:flk2-bob 4.6s ease-in-out infinite;transition:color .35s ease,filter .35s ease}
.flk2-bird-svg{width:100%;height:auto;display:block}
.flk2-shadow{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
  width:46%;height:18px;border-radius:50%;background:rgba(0,0,0,.45);
  filter:blur(8px);animation:flk2-shadowpulse 4.6s ease-in-out infinite}
@keyframes flk2-bob{0%,100%{transform:translateY(0) rotate(-1.2deg)}
  50%{transform:translateY(-16px) rotate(1.2deg)}}
@keyframes flk2-shadowpulse{0%,100%{transform:translateX(-50%) scale(1);opacity:.5}
  50%{transform:translateX(-50%) scale(.82);opacity:.32}}
.flk2-swatches{display:flex;gap:11px;flex-wrap:wrap;justify-content:center;margin-top:4px}
.flk2-sw{width:34px;height:34px;border-radius:50%;cursor:pointer;border:2px solid rgba(255,255,255,.18);
  position:relative;transition:transform .14s ease,border-color .2s ease;outline:none}
.flk2-sw:hover{transform:scale(1.14)}
.flk2-sw.flk2-sel{border-color:#fff;transform:scale(1.16);
  box-shadow:0 0 0 3px rgba(255,255,255,.18),0 0 16px currentColor}
.flk2-sw.flk2-sel::after{content:'';position:absolute;inset:0;border-radius:50%;
  box-shadow:0 0 14px 1px currentColor}

/* action (right) */
.flk2-action{width:min(440px,46vw);padding:28px 30px 30px;display:flex;flex-direction:column;gap:16px}
.flk2-action-h{font-size:13px;letter-spacing:1.6px;text-transform:uppercase;
  color:#9fb2d8;font-weight:700;margin-bottom:2px}
.flk2-modes{display:flex;flex-direction:column;gap:12px}
.flk2-mode{display:flex;align-items:center;gap:14px;text-align:left;cursor:pointer;
  border:1.5px solid rgba(120,140,220,.22);background:rgba(10,14,30,.55);
  border-radius:16px;padding:14px 16px;color:#eaf2ff;transition:border-color .2s,
  background .2s,box-shadow .2s,transform .12s;width:100%;font:inherit}
.flk2-mode:hover{transform:translateY(-1px);border-color:rgba(150,170,255,.45)}
.flk2-mode.flk2-sel{border-color:#7fa6ff;background:rgba(48,64,120,.45);
  box-shadow:0 0 0 2px rgba(127,166,255,.35),0 12px 30px rgba(60,90,200,.25)}
.flk2-mode-emoji{font-size:30px;line-height:1;flex:0 0 auto;
  filter:drop-shadow(0 4px 10px rgba(0,0,0,.5))}
.flk2-mode-txt{display:flex;flex-direction:column;gap:3px;min-width:0}
.flk2-mode-name{font-weight:800;letter-spacing:.6px;font-size:15px}
.flk2-mode-desc{font-size:12.5px;color:#9fb2d8;line-height:1.35}

.flk2-divider{height:1px;background:linear-gradient(90deg,transparent,
  rgba(150,170,255,.28),transparent);margin:4px 0}

.flk2-btn{border:0;border-radius:14px;font:inherit;font-weight:800;letter-spacing:.6px;
  cursor:pointer;color:#06101f;padding:15px 18px;font-size:15px;
  transition:transform .12s ease,box-shadow .2s ease,filter .2s ease;width:100%}
.flk2-btn:active{transform:translateY(1px) scale(.995)}
.flk2-btn-pri{background:linear-gradient(135deg,#7ad7ff,#5a7bff);
  box-shadow:0 12px 30px rgba(70,110,255,.4),inset 0 1px 0 rgba(255,255,255,.4)}
.flk2-btn-pri:hover{filter:brightness(1.07);box-shadow:0 16px 40px rgba(70,110,255,.55)}
.flk2-btn-go{background:linear-gradient(135deg,#5ad469,#2ec4b6);
  box-shadow:0 10px 24px rgba(46,196,182,.4);flex:0 0 auto;width:auto;padding:14px 22px}
.flk2-btn-go:hover{filter:brightness(1.07)}
.flk2-btn:disabled{opacity:.45;cursor:not-allowed;filter:none;box-shadow:none}

.flk2-codebox{display:none;align-items:center;justify-content:space-between;gap:10px;
  background:rgba(10,14,30,.6);border:1.5px dashed rgba(150,170,255,.4);
  border-radius:14px;padding:12px 16px}
.flk2-codebox.flk2-on{display:flex}
.flk2-codeval{font-size:30px;font-weight:900;letter-spacing:8px;
  background:linear-gradient(180deg,#fff,#bcd0ff);-webkit-background-clip:text;
  background-clip:text;color:transparent;padding-left:6px}
.flk2-copy{border:0;background:rgba(120,140,220,.22);color:#dce8ff;border-radius:10px;
  padding:9px 13px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.6px;
  transition:background .2s,transform .12s}
.flk2-copy:hover{background:rgba(150,170,255,.4);transform:scale(1.04)}

.flk2-join{display:flex;gap:10px;align-items:stretch}
.flk2-input{flex:1 1 auto;min-width:0;background:rgba(10,14,30,.7);
  border:1.5px solid rgba(120,140,220,.3);border-radius:14px;color:#fff;
  padding:14px 16px;font-size:16px;font-weight:700;letter-spacing:3px;outline:none;
  transition:border-color .2s,box-shadow .2s;text-align:center}
.flk2-input::placeholder{color:#5d6f95;letter-spacing:2px;font-weight:600}
.flk2-input:focus{border-color:#7fa6ff;box-shadow:0 0 0 3px rgba(127,166,255,.22)}

/* ---------- AUTH ---------- */
.flk2-auth-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}
.flk2-authcard{width:min(440px,92vw);padding:40px 36px 36px;text-align:center;
  display:flex;flex-direction:column;gap:18px}
.flk2-authcard .flk2-bird{width:120px;margin:0 auto;animation:flk2-bob 4.6s ease-in-out infinite}
.flk2-auth-title{font-size:26px;font-weight:900;letter-spacing:.5px}
.flk2-auth-sub{font-size:13.5px;color:#9fb2d8;margin-top:-8px}
.flk2-auth-body .flk2-input{letter-spacing:.5px;text-align:left;font-weight:600;font-size:17px}

/* ---------- CONNECTING ---------- */
.flk2-connect-body{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:22px}
.flk2-spinner{width:54px;height:54px;border-radius:50%;
  border:4px solid rgba(127,166,255,.22);border-top-color:#7fa6ff;
  animation:flk2-spin 1s linear infinite}
.flk2-connect-msg{font-size:17px;font-weight:700;letter-spacing:.6px;color:#dce8ff}
@keyframes flk2-spin{to{transform:rotate(360deg)}}

/* ---------- WAITING ROOM ---------- */
.flk2-wait-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}
.flk2-waitcard{width:min(560px,94vw);padding:34px 34px 32px;display:flex;flex-direction:column;gap:20px}
.flk2-wait-mode{font-size:12px;letter-spacing:2px;text-transform:uppercase;
  color:#9fb2d8;font-weight:700;text-align:center}
.flk2-wait-codewrap{display:flex;align-items:center;justify-content:center;gap:14px}
.flk2-wait-code{font-size:54px;font-weight:900;letter-spacing:12px;padding-left:12px;
  background:linear-gradient(180deg,#fff,#bcd0ff);-webkit-background-clip:text;
  background-clip:text;color:transparent;text-shadow:0 0 40px rgba(120,150,255,.4)}
.flk2-roster{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;min-height:42px}
.flk2-chip{display:flex;align-items:center;gap:9px;background:rgba(10,14,30,.6);
  border:1px solid rgba(120,140,220,.25);border-radius:999px;padding:8px 14px 8px 10px;
  font-size:14px;font-weight:700}
.flk2-chip.flk2-me{border-color:#7fa6ff;box-shadow:0 0 0 1px rgba(127,166,255,.45)}
.flk2-chipdot{width:14px;height:14px;border-radius:50%;box-shadow:0 0 8px currentColor}
.flk2-crown{font-size:13px}
.flk2-wait-hint{text-align:center;font-size:13px;color:#8ea2cc}

/* ---------- RESULTS ---------- */
.flk2-res-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}
.flk2-rescard{width:min(540px,94vw);padding:32px 30px 30px;display:flex;flex-direction:column;gap:18px}
.flk2-res-title{font-size:26px;font-weight:900;text-align:center;letter-spacing:1px;
  background:linear-gradient(180deg,#fff,#ffe9a8);-webkit-background-clip:text;
  background-clip:text;color:transparent;text-shadow:0 0 30px rgba(255,210,80,.35)}
.flk2-rows{display:flex;flex-direction:column;gap:9px;max-height:46vh;overflow:auto}
.flk2-resrow{display:flex;align-items:center;gap:13px;background:rgba(10,14,30,.55);
  border:1px solid rgba(120,140,220,.2);border-radius:14px;padding:12px 16px}
.flk2-resrow.flk2-me{border-color:#7fa6ff;box-shadow:0 0 0 1px rgba(127,166,255,.4)}
.flk2-rank{font-size:20px;width:34px;text-align:center;flex:0 0 auto;font-weight:900;color:#9fb2d8}
.flk2-resname{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0;
  font-weight:800;font-size:15px}
.flk2-resname span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flk2-resscore{font-weight:900;font-size:18px;letter-spacing:.5px;color:#fff;flex:0 0 auto}
.flk2-dnf{font-size:11px;color:#8ea2cc;font-weight:600;margin-left:8px}

/* ---------- responsive ---------- */
@media (max-width:720px){
  .flk2-home-body{flex-direction:column;gap:18px;overflow:auto;align-items:stretch;
    justify-content:flex-start;padding:6px 16px 28px}
  .flk2-locker,.flk2-action{width:100%}
  .flk2-birdstage{height:180px}
  .flk2-wordmark{font-size:24px}
  .flk2-top{padding:16px 18px}
  .flk2-wait-code{font-size:40px;letter-spacing:8px}
}

@media (prefers-reduced-motion:reduce){
  #${ROOT_ID} *{animation:none!important;transition:none!important}
  .flk2-screen{opacity:1;transform:none}
}
`;

export class MenuShell {
  constructor({ palette, name, color, onCommit, onSetName, onSetColor, onLeave } = {}) {
    this.palette = (Array.isArray(palette) && palette.length === 8) ? palette.slice() : DEFAULT_PALETTE.slice();
    this.onCommit = typeof onCommit === 'function' ? onCommit : () => {};
    this.onSetName = typeof onSetName === 'function' ? onSetName : () => {};
    this.onSetColor = typeof onSetColor === 'function' ? onSetColor : () => {};
    this.onLeave = typeof onLeave === 'function' ? onLeave : () => {};

    // resolve persisted defaults
    let storedName = null;
    let storedColor = null;
    try {
      storedName = localStorage.getItem(LS_NAME);
      const c = localStorage.getItem(LS_COLOR);
      if (c != null) storedColor = parseInt(c, 10);
    } catch (_) { /* localStorage may be unavailable */ }

    this._name = (name != null ? name : storedName) || '';
    let resolvedColor = (color != null ? color : storedColor);
    if (typeof resolvedColor !== 'number' || Number.isNaN(resolvedColor)) resolvedColor = 0;
    this._color = ((resolvedColor % 8) + 8) % 8;

    this._mode = 'creative';
    this._pendingCode = null;     // auto-generated code awaiting Create
    this._mounted = false;
    this._onStart = null;
    this._onAgain = null;
    this.el = {};                 // element refs
  }

  // ---- public getters ----
  get currentName() { return this._name; }
  get currentColor() { return this._color; }

  // ---- escaping helpers (XSS-safe) ----
  _text(node, value) { node.textContent = value == null ? '' : String(value); }

  _swatchColor(idx) {
    const i = ((idx % 8) + 8) % 8;
    return this.palette[i] || DEFAULT_PALETTE[i] || '#ffffff';
  }

  _hexToRgba(hex, a) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  _randomCode() {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let out = '';
    for (let i = 0; i < 4; i++) out += A[Math.floor(Math.random() * A.length)];
    return out;
  }

  // Prevent the game (window keydown: SPACE flap, WASD, etc.) from reacting
  // while the user types in any shell field.
  _guard(input) {
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
  }

  // ============================================================= mount
  mount() {
    if (this._mounted) {
      // idempotent: show the right starting screen and bail
      if (this._name) this.returnToMenu(); else this._show('auth');
      return;
    }

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    this.root = root;
    root.innerHTML = '';

    // backdrop chrome (static -> innerHTML is safe)
    const chrome = document.createElement('div');
    chrome.innerHTML =
      '<div class="flk2-backdrop"></div>' +
      '<div class="flk2-clouds"></div>' +
      '<div class="flk2-stars"></div>' +
      '<div class="flk2-vignette"></div>';
    while (chrome.firstChild) root.appendChild(chrome.firstChild);

    this._buildAuth();
    this._buildHome();
    this._buildConnecting();
    this._buildWaiting();
    this._buildResults();

    this._mounted = true;
    this._syncBird();
    this._syncSwatches();

    if (this._name) this.returnToMenu();
    else this._show('auth');
  }

  // ============================================================= screen switching
  _show(which) {
    const screens = ['auth', 'home', 'connecting', 'waiting', 'results'];
    for (const s of screens) {
      const el = this.el[s];
      if (!el) continue;
      if (s === which) {
        el.hidden = false;
        // force reflow so the transition plays
        void el.offsetWidth;
        el.classList.add('flk2-on');
      } else {
        el.classList.remove('flk2-on');
        el.hidden = true;
      }
    }
    if (this.root) this.root.style.display = '';
    this._current = which;
  }

  // ============================================================= AUTH screen
  _buildAuth() {
    const screen = document.createElement('div');
    screen.className = 'flk2-screen';
    screen.hidden = true;

    const top = this._topBar(false);
    screen.appendChild(top);

    const body = document.createElement('div');
    body.className = 'flk2-auth-body';

    const card = document.createElement('div');
    card.className = 'flk2-panel flk2-authcard';

    const bird = document.createElement('div');
    bird.className = 'flk2-bird';
    bird.innerHTML = BIRD_SVG;
    card.appendChild(bird);
    this.el.authBird = bird;

    const title = document.createElement('div');
    title.className = 'flk2-auth-title';
    title.textContent = 'Choose your callsign';
    card.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'flk2-auth-sub';
    sub.textContent = 'The flock will know you by this name.';
    card.appendChild(sub);

    const input = document.createElement('input');
    input.className = 'flk2-input';
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'e.g. SkyWraith';
    input.value = this._name || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    this._guard(input);
    this.el.authInput = input;
    card.appendChild(input);

    const btn = document.createElement('button');
    btn.className = 'flk2-btn flk2-btn-pri';
    btn.textContent = 'CONTINUE';
    card.appendChild(btn);

    const submit = () => {
      const v = input.value.trim().slice(0, 24);
      if (!v) { input.focus(); return; }
      this._name = v;
      try { localStorage.setItem(LS_NAME, v); } catch (_) {}
      this.onSetName(v);
      this._refreshCallsign();
      this.returnToMenu();
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
    });

    body.appendChild(card);
    screen.appendChild(body);
    this.root.appendChild(screen);
    this.el.auth = screen;
  }

  // ============================================================= HOME screen
  _topBar(withStatus = true) {
    const top = document.createElement('div');
    top.className = 'flk2-top';

    const brand = document.createElement('div');
    const mark = document.createElement('div');
    mark.className = 'flk2-wordmark';
    mark.textContent = 'FLOCKD';
    const tag = document.createElement('div');
    tag.className = 'flk2-tagline';
    tag.textContent = 'co-author worlds. outfly the hunt.';
    brand.appendChild(mark);
    brand.appendChild(tag);
    top.appendChild(brand);

    if (withStatus) {
      const status = document.createElement('div');
      status.className = 'flk2-status';
      const dot = document.createElement('span');
      dot.className = 'flk2-statusdot';
      const label = document.createElement('span');
      label.textContent = 'connecting';
      status.appendChild(dot);
      status.appendChild(label);
      top.appendChild(status);
      this.el.statusDot = dot;
      this.el.statusLabel = label;
    }
    return top;
  }

  _buildHome() {
    const screen = document.createElement('div');
    screen.className = 'flk2-screen';
    screen.hidden = true;

    screen.appendChild(this._topBar(true));

    const body = document.createElement('div');
    body.className = 'flk2-home-body';

    // ---------------- LOCKER (left) ----------------
    const locker = document.createElement('div');
    locker.className = 'flk2-panel flk2-locker';

    const callsign = document.createElement('div');
    callsign.className = 'flk2-callsign';
    const cTag = document.createElement('span');
    cTag.textContent = 'CALLSIGN';
    cTag.style.opacity = '.7';
    const cName = document.createElement('span');
    cName.className = 'flk2-callname';
    const pencil = document.createElement('button');
    pencil.className = 'flk2-pencil';
    pencil.type = 'button';
    pencil.title = 'Edit callsign';
    pencil.textContent = '✏️';
    pencil.addEventListener('click', () => {
      this.el.authInput.value = this._name || '';
      this._show('auth');
      setTimeout(() => { try { this.el.authInput.focus(); this.el.authInput.select(); } catch (_) {} }, 60);
    });
    callsign.appendChild(cTag);
    callsign.appendChild(cName);
    callsign.appendChild(pencil);
    locker.appendChild(callsign);
    this.el.callName = cName;

    const stage = document.createElement('div');
    stage.className = 'flk2-birdstage';
    const shadow = document.createElement('div');
    shadow.className = 'flk2-shadow';
    const bird = document.createElement('div');
    bird.className = 'flk2-bird';
    bird.innerHTML = BIRD_SVG;
    stage.appendChild(shadow);
    stage.appendChild(bird);
    locker.appendChild(stage);
    this.el.homeBird = bird;

    const swatches = document.createElement('div');
    swatches.className = 'flk2-swatches';
    this.el.swatches = [];
    for (let i = 0; i < 8; i++) {
      const sw = document.createElement('button');
      sw.className = 'flk2-sw';
      sw.type = 'button';
      const col = this._swatchColor(i);
      sw.style.background = col;
      sw.style.color = col; // for the glow (currentColor)
      sw.title = `Color ${i + 1}`;
      sw.setAttribute('aria-label', `Bird color ${i + 1}`);
      sw.addEventListener('click', () => this._selectColor(i));
      swatches.appendChild(sw);
      this.el.swatches.push(sw);
    }
    locker.appendChild(swatches);
    body.appendChild(locker);

    // ---------------- ACTION (right) ----------------
    const action = document.createElement('div');
    action.className = 'flk2-panel flk2-action';

    const mh = document.createElement('div');
    mh.className = 'flk2-action-h';
    mh.textContent = 'Choose your flight';
    action.appendChild(mh);

    const modes = document.createElement('div');
    modes.className = 'flk2-modes';
    this.el.modeCards = {};
    const defs = [
      { id: 'creative', emoji: '🎨', name: 'CREATIVE', desc: 'co-author the level, race it together' },
      { id: 'survival', emoji: '💀', name: 'SURVIVAL', desc: 'battle royale; an AI predator hunts the leader' },
    ];
    for (const d of defs) {
      const card = document.createElement('button');
      card.className = 'flk2-mode' + (d.id === this._mode ? ' flk2-sel' : '');
      card.type = 'button';
      const em = document.createElement('span');
      em.className = 'flk2-mode-emoji';
      em.textContent = d.emoji;
      const txt = document.createElement('div');
      txt.className = 'flk2-mode-txt';
      const nm = document.createElement('div');
      nm.className = 'flk2-mode-name';
      nm.textContent = d.name;
      const ds = document.createElement('div');
      ds.className = 'flk2-mode-desc';
      ds.textContent = d.desc;
      txt.appendChild(nm); txt.appendChild(ds);
      card.appendChild(em); card.appendChild(txt);
      card.addEventListener('click', () => this._selectMode(d.id));
      modes.appendChild(card);
      this.el.modeCards[d.id] = card;
    }
    action.appendChild(modes);

    action.appendChild(this._divider());

    // CREATE
    const createBtn = document.createElement('button');
    createBtn.className = 'flk2-btn flk2-btn-pri';
    createBtn.textContent = 'CREATE ROOM';
    action.appendChild(createBtn);

    const codebox = document.createElement('div');
    codebox.className = 'flk2-codebox';
    const codeVal = document.createElement('div');
    codeVal.className = 'flk2-codeval';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'flk2-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = 'COPY';
    codebox.appendChild(codeVal);
    codebox.appendChild(copyBtn);
    action.appendChild(codebox);
    this.el.createCodeBox = codebox;
    this.el.createCodeVal = codeVal;

    copyBtn.addEventListener('click', () => this._copy(this._pendingCode, copyBtn));

    createBtn.addEventListener('click', () => {
      if (!this._pendingCode) {
        // first click: generate + reveal the code
        this._pendingCode = this._randomCode();
        this._text(codeVal, this._pendingCode);
        codebox.classList.add('flk2-on');
        createBtn.textContent = 'LAUNCH ROOM →';
        return;
      }
      // second click: commit
      this.onCommit({
        create: true,
        code: this._pendingCode,
        name: this._name,
        color: this._color,
        mode: this._mode,
      });
    });
    this.el.createBtn = createBtn;

    action.appendChild(this._divider());

    // JOIN
    const joinH = document.createElement('div');
    joinH.className = 'flk2-action-h';
    joinH.textContent = 'Join a flock';
    action.appendChild(joinH);

    const join = document.createElement('div');
    join.className = 'flk2-join';
    const joinInput = document.createElement('input');
    joinInput.className = 'flk2-input';
    joinInput.type = 'text';
    joinInput.maxLength = 8;
    joinInput.placeholder = 'CODE';
    joinInput.autocomplete = 'off';
    joinInput.spellcheck = false;
    joinInput.addEventListener('input', () => {
      const up = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (joinInput.value !== up) joinInput.value = up;
    });
    this._guard(joinInput);
    this.el.joinInput = joinInput;

    const goBtn = document.createElement('button');
    goBtn.className = 'flk2-btn flk2-btn-go';
    goBtn.textContent = 'GO';

    const doJoin = () => {
      const code = joinInput.value.trim().toUpperCase().slice(0, 8);
      if (!code) { joinInput.focus(); return; }
      this.onCommit({
        create: false,
        code,
        name: this._name,
        color: this._color,
        mode: this._mode,
      });
    };
    goBtn.addEventListener('click', doJoin);
    joinInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') doJoin();
    });

    join.appendChild(joinInput);
    join.appendChild(goBtn);
    action.appendChild(join);

    body.appendChild(action);
    screen.appendChild(body);
    this.root.appendChild(screen);
    this.el.home = screen;

    this._refreshCallsign();
  }

  _divider() {
    const d = document.createElement('div');
    d.className = 'flk2-divider';
    return d;
  }

  // ============================================================= CONNECTING
  _buildConnecting() {
    const screen = document.createElement('div');
    screen.className = 'flk2-screen';
    screen.hidden = true;
    const body = document.createElement('div');
    body.className = 'flk2-connect-body';
    const spin = document.createElement('div');
    spin.className = 'flk2-spinner';
    const msg = document.createElement('div');
    msg.className = 'flk2-connect-msg';
    msg.textContent = 'Connecting…';
    body.appendChild(spin);
    body.appendChild(msg);
    screen.appendChild(body);
    this.root.appendChild(screen);
    this.el.connecting = screen;
    this.el.connectMsg = msg;
  }

  // ============================================================= WAITING ROOM
  _buildWaiting() {
    const screen = document.createElement('div');
    screen.className = 'flk2-screen';
    screen.hidden = true;
    screen.appendChild(this._topBar(true));

    const body = document.createElement('div');
    body.className = 'flk2-wait-body';
    const card = document.createElement('div');
    card.className = 'flk2-panel flk2-waitcard';

    const mode = document.createElement('div');
    mode.className = 'flk2-wait-mode';
    card.appendChild(mode);
    this.el.waitMode = mode;

    const codewrap = document.createElement('div');
    codewrap.className = 'flk2-wait-codewrap';
    const code = document.createElement('div');
    code.className = 'flk2-wait-code';
    const copy = document.createElement('button');
    copy.className = 'flk2-copy';
    copy.type = 'button';
    copy.textContent = 'COPY';
    codewrap.appendChild(code);
    codewrap.appendChild(copy);
    card.appendChild(codewrap);
    this.el.waitCode = code;
    this.el.waitCopy = copy;

    const roster = document.createElement('div');
    roster.className = 'flk2-roster';
    card.appendChild(roster);
    this.el.waitRoster = roster;

    const startBtn = document.createElement('button');
    startBtn.className = 'flk2-btn flk2-btn-pri';
    startBtn.textContent = 'START MATCH';
    card.appendChild(startBtn);
    this.el.waitStart = startBtn;

    const hint = document.createElement('div');
    hint.className = 'flk2-wait-hint';
    card.appendChild(hint);
    this.el.waitHint = hint;

    startBtn.addEventListener('click', () => {
      if (typeof this._onStart === 'function') this._onStart();
    });

    body.appendChild(card);
    screen.appendChild(body);
    this.root.appendChild(screen);
    this.el.waiting = screen;
  }

  // ============================================================= RESULTS
  _buildResults() {
    const screen = document.createElement('div');
    screen.className = 'flk2-screen';
    screen.hidden = true;
    screen.appendChild(this._topBar(true));

    const body = document.createElement('div');
    body.className = 'flk2-res-body';
    const card = document.createElement('div');
    card.className = 'flk2-panel flk2-rescard';

    const title = document.createElement('div');
    title.className = 'flk2-res-title';
    title.textContent = 'FLIGHT RESULTS';
    card.appendChild(title);

    const rows = document.createElement('div');
    rows.className = 'flk2-rows';
    card.appendChild(rows);
    this.el.resRows = rows;

    const again = document.createElement('button');
    again.className = 'flk2-btn flk2-btn-pri';
    again.textContent = 'PLAY AGAIN';
    card.appendChild(again);
    this.el.resAgain = again;

    again.addEventListener('click', () => {
      const cb = this._onAgain;
      this._onAgain = null;
      if (typeof cb === 'function') cb();
      this.returnToMenu();
    });

    body.appendChild(card);
    screen.appendChild(body);
    this.root.appendChild(screen);
    this.el.results = screen;
  }

  // ============================================================= selection helpers
  _selectColor(idx) {
    this._color = ((idx % 8) + 8) % 8;
    try { localStorage.setItem(LS_COLOR, String(this._color)); } catch (_) {}
    this._syncBird();
    this._syncSwatches();
    this.onSetColor(this._color);
  }

  _selectMode(id) {
    this._mode = (id === 'survival') ? 'survival' : 'creative';
    for (const key of Object.keys(this.el.modeCards || {})) {
      this.el.modeCards[key].classList.toggle('flk2-sel', key === this._mode);
    }
  }

  _syncBird() {
    const col = this._swatchColor(this._color);
    const glow = this._hexToRgba(col, 0.6);
    const apply = (el) => {
      if (!el) return;
      el.style.setProperty('--flk2-bird', col);
      el.style.setProperty('--flk2-glow', glow);
    };
    apply(this.el.homeBird);
    apply(this.el.authBird);
  }

  _syncSwatches() {
    if (!this.el.swatches) return;
    this.el.swatches.forEach((sw, i) => {
      sw.classList.toggle('flk2-sel', i === this._color);
    });
  }

  _refreshCallsign() {
    if (this.el.callName) this._text(this.el.callName, this._name || '—');
  }

  _copy(value, btn) {
    if (!value) return;
    const done = () => {
      if (!btn) return;
      const prev = btn.textContent;
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, () => done());
        return;
      }
    } catch (_) {}
    // fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (_) {}
  }

  // ============================================================= roster rendering
  _renderRoster(container, roster) {
    if (!container) return;
    container.innerHTML = '';
    const list = Array.isArray(roster) ? roster : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'flk2-wait-hint';
      empty.textContent = 'Waiting for birds to arrive…';
      container.appendChild(empty);
      return;
    }
    for (const p of list) {
      const chip = document.createElement('div');
      chip.className = 'flk2-chip' + (p && p.me ? ' flk2-me' : '');
      const dot = document.createElement('span');
      dot.className = 'flk2-chipdot';
      const col = this._swatchColor(typeof p.color === 'number' ? p.color : 0);
      dot.style.background = col;
      dot.style.color = col;
      chip.appendChild(dot);
      const nm = document.createElement('span');
      this._text(nm, (p && p.name) || 'bird');
      chip.appendChild(nm);
      if (p && p.host) {
        const crown = document.createElement('span');
        crown.className = 'flk2-crown';
        crown.textContent = '👑';
        chip.appendChild(crown);
      }
      container.appendChild(chip);
    }
  }

  // ============================================================= PUBLIC API
  enterGame() {
    // hide EVERY overlay so canvas gets all pointer/key events
    const screens = ['auth', 'home', 'connecting', 'waiting', 'results'];
    for (const s of screens) {
      const el = this.el[s];
      if (el) { el.classList.remove('flk2-on'); el.hidden = true; }
    }
    if (this.root) this.root.style.display = 'none';
    this._current = 'game';
  }

  returnToMenu() {
    if (!this._mounted) { this.mount(); return; }
    // reset transient create state
    this._pendingCode = null;
    if (this.el.createCodeBox) this.el.createCodeBox.classList.remove('flk2-on');
    if (this.el.createBtn) this.el.createBtn.textContent = 'CREATE ROOM';
    if (this.el.createCodeVal) this._text(this.el.createCodeVal, '');
    this._onStart = null;
    this._refreshCallsign();
    this._syncBird();
    this._syncSwatches();
    if (this.root) this.root.style.display = '';
    this._show('home');
  }

  showConnecting(msg) {
    if (!this._mounted) this.mount();
    if (this.el.connectMsg) this._text(this.el.connectMsg, msg || 'Connecting…');
    if (this.root) this.root.style.display = '';
    this._show('connecting');
  }

  setConnected(isConnected) {
    if (this.el.statusDot) this.el.statusDot.classList.toggle('flk2-live', !!isConnected);
    if (this.el.statusLabel) this.el.statusLabel.textContent = isConnected ? 'connected' : 'connecting';
  }

  showWaitingRoom({ code, mode, isHost, roster, onStart } = {}) {
    if (!this._mounted) this.mount();
    this._onStart = typeof onStart === 'function' ? onStart : null;

    const safeCode = (code || '').toString().toUpperCase();
    this._text(this.el.waitCode, safeCode);
    const m = (mode === 'survival') ? '💀 SURVIVAL — outfly the hunt' : '🎨 CREATIVE — co-author the world';
    this._text(this.el.waitMode, m);

    // copy wiring (rebind each time so it copies the current code)
    if (this.el.waitCopy) {
      this.el.waitCopy.onclick = () => this._copy(safeCode, this.el.waitCopy);
    }

    this._renderRoster(this.el.waitRoster, roster);

    const host = !!isHost;
    if (this.el.waitStart) {
      this.el.waitStart.style.display = host ? 'block' : 'none';
      this.el.waitStart.disabled = !host;
    }
    if (this.el.waitHint) {
      this._text(this.el.waitHint, host
        ? 'You are the host. Launch when the flock is ready.'
        : 'Waiting for the host to start the match…');
    }

    if (this.root) this.root.style.display = '';
    this._show('waiting');
  }

  setRoster(roster) {
    // update whichever roster is currently shown (waiting room)
    this._renderRoster(this.el.waitRoster, roster);
  }

  showResults({ rows, onAgain } = {}) {
    if (!this._mounted) this.mount();
    this._onAgain = typeof onAgain === 'function' ? onAgain : null;

    const container = this.el.resRows;
    if (container) {
      container.innerHTML = '';
      const list = Array.isArray(rows) ? rows.slice() : [];
      // contract says rows arrive sorted desc; sort defensively anyway
      list.sort((a, b) => (b.score || 0) - (a.score || 0));
      const medals = ['🥇', '🥈', '🥉'];
      list.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'flk2-resrow' + (p && p.me ? ' flk2-me' : '');

        const rank = document.createElement('div');
        rank.className = 'flk2-rank';
        rank.textContent = i < 3 ? medals[i] : String(i + 1);
        row.appendChild(rank);

        const name = document.createElement('div');
        name.className = 'flk2-resname';
        const dot = document.createElement('span');
        dot.className = 'flk2-chipdot';
        const col = this._swatchColor(typeof p.color === 'number' ? p.color : 0);
        dot.style.background = col;
        dot.style.color = col;
        name.appendChild(dot);
        const nm = document.createElement('span');
        this._text(nm, (p && p.name) || 'bird');
        name.appendChild(nm);
        if (p && p.finished === false) {
          const dnf = document.createElement('span');
          dnf.className = 'flk2-dnf';
          dnf.textContent = 'DNF';
          name.appendChild(dnf);
        }
        row.appendChild(name);

        const score = document.createElement('div');
        score.className = 'flk2-resscore';
        const sv = (p && typeof p.score === 'number') ? p.score : 0;
        this._text(score, sv);
        row.appendChild(score);

        container.appendChild(row);
      });
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'flk2-wait-hint';
        empty.textContent = 'No scores recorded.';
        container.appendChild(empty);
      }
    }

    if (this.root) this.root.style.display = '';
    this._show('results');
  }

  hideAll() {
    const screens = ['auth', 'home', 'connecting', 'waiting', 'results'];
    for (const s of screens) {
      const el = this.el[s];
      if (el) { el.classList.remove('flk2-on'); el.hidden = true; }
    }
    if (this.root) this.root.style.display = 'none';
    this._current = 'none';
  }
}

export default MenuShell;
