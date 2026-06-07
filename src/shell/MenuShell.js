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
 *   new MenuShell({ palette, name, color, skin, onCommit, onSetName, onSetColor, onSetSkin, onLeave })
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
 *   get currentSkin()
 *
 *   onCommit fires with { create, code, name, color, skin, mode }.
 *   onSetSkin(id) fires on bird-picker selection (id is one of the 7 skin ids).
 *
 * Visual language: "cinematic dark + neon" — a layered glass design SYSTEM
 * shared verbatim with the in-room lobby (lobbyUI.js) so the two read as one
 * product. Tokens are declared once as CSS custom properties on #flk2-root.
 */

import { BIRDS } from '../flight/AvatarBird.js';

const LS_NAME = 'flockd.name';
const LS_COLOR = 'flockd.color';
const LS_SKIN = 'flockd.skin';
const STYLE_ID = 'flk2-style';
const ROOT_ID = 'flk2-root';

// Ordered list of selectable avatar ids (drives the locker bird picker).
const SKIN_IDS = ['stork', 'celestial', 'phoenix', 'cardinal', 'pigeon', 'grey', 'bird'];
const DEFAULT_SKIN = 'stork';

const DEFAULT_PALETTE = [
  '#ff5a5f', '#3fa7ff', '#5ad469', '#ffd23f',
  '#b06bff', '#ff8c42', '#2ec4b6', '#f15bb5',
];

// Crisp inline SVG glyphs (no emoji as primary UI). 24x24 viewBox, currentColor.
const ICON = {
  pencil: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  copy: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  check: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  arrow: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  brush: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4l6 6-7 7a3 3 0 0 1-3 .8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 14c-2.5.4-3.6 2.1-4 4.5C7.4 18.6 9.1 17.5 9.5 15" fill="currentColor" opacity=".9"/><path d="M16.5 6.5l1 1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  skull: '<svg class="flk2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a8 8 0 0 0-8 8c0 2.8 1.4 4.6 3 5.6V19a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 19v-2.4c1.6-1 3-2.8 3-5.6a8 8 0 0 0-8-8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9" cy="11" r="1.7" fill="currentColor"/><circle cx="15" cy="11" r="1.7" fill="currentColor"/><path d="M11 16h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  crown: '<svg class="flk2-ic flk2-ic-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l1.6-9 4.4 4 2-5 2 5 4.4-4L20 17z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.6 19.2h14.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

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
#${ROOT_ID}{
  /* ---- DESIGN TOKENS (declare once, reuse everywhere) ---- */
  --flk2-bg:#070b16;
  --flk2-ink:#eaf2ff;
  --flk2-muted:#7f8db5;
  --flk2-muted-2:#9aa7cc;
  --flk2-line:rgba(130,160,235,.16);
  --flk2-line-strong:rgba(130,160,235,.28);
  --flk2-cyan:#54e0ff;
  --flk2-violet:#8b7bff;
  --flk2-success:#56d98c;
  --flk2-danger:#ff5d72;
  --flk2-gold:#ffd45e;
  --flk2-glass:rgba(16,22,40,.55);
  --flk2-glass-2:rgba(12,17,33,.62);
  --flk2-radius-card:16px;
  --flk2-radius-btn:12px;
  --flk2-radius-pill:999px;
  --flk2-ease:cubic-bezier(.2,.8,.2,1);
  --flk2-t:200ms var(--flk2-ease);
  --flk2-shadow:0 24px 70px -24px rgba(0,0,0,.75),0 2px 8px rgba(0,0,0,.4);
  --flk2-inset:inset 0 1px 0 rgba(255,255,255,.08);

  position:fixed;inset:0;z-index:40;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  font-feature-settings:'tnum' 1,'ss01' 1;
  color:var(--flk2-ink);overflow:hidden;-webkit-tap-highlight-color:transparent;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
#${ROOT_ID} *{box-sizing:border-box}
#${ROOT_ID} [hidden]{display:none!important}
#${ROOT_ID} button{font:inherit}
.flk2-ic{width:1em;height:1em;display:block;flex:0 0 auto}
.flk2-num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1}

/* ---------- cinematic backdrop ---------- */
.flk2-backdrop{position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(1000px 620px at 50% -8%, rgba(139,123,255,.30), transparent 62%),
    radial-gradient(900px 640px at 84% 6%, rgba(84,224,255,.16), transparent 60%),
    radial-gradient(1100px 820px at 10% 102%, rgba(63,90,200,.14), transparent 60%),
    linear-gradient(180deg,#080d1c 0%,var(--flk2-bg) 46%,#05080f 100%)}
.flk2-stars{position:absolute;inset:-50% -10%;z-index:0;pointer-events:none;opacity:.65;
  background-image:
    radial-gradient(1.4px 1.4px at 20% 30%, #fff, transparent),
    radial-gradient(1.2px 1.2px at 70% 65%, #cfe0ff, transparent),
    radial-gradient(1.6px 1.6px at 40% 80%, #fff, transparent),
    radial-gradient(1px 1px at 85% 22%, #fff, transparent),
    radial-gradient(1.3px 1.3px at 55% 12%, #d7c4ff, transparent),
    radial-gradient(1px 1px at 12% 60%, #fff, transparent),
    radial-gradient(1.5px 1.5px at 92% 78%, #cfe0ff, transparent);
  background-size:560px 560px;background-repeat:repeat;
  animation:flk2-drift 140s linear infinite}
.flk2-aurora{position:absolute;inset:-10% -10% auto -10%;height:62%;z-index:0;pointer-events:none;opacity:.5;
  background:
    radial-gradient(620px 220px at 28% 30%, rgba(139,123,255,.18), transparent 70%),
    radial-gradient(720px 240px at 78% 18%, rgba(84,224,255,.13), transparent 70%);
  filter:blur(6px);animation:flk2-aurora 26s ease-in-out infinite alternate}
.flk2-grain{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.035;mix-blend-mode:overlay;
  background-image:radial-gradient(rgba(255,255,255,.9) .5px, transparent .5px);
  background-size:3px 3px}
.flk2-vignette{position:absolute;inset:0;z-index:1;pointer-events:none;
  box-shadow:inset 0 0 260px 70px rgba(2,4,12,.9)}
@keyframes flk2-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-280px,-200px,0)}}
@keyframes flk2-aurora{from{transform:translateX(-26px) translateY(-6px)}to{transform:translateX(26px) translateY(8px)}}

/* ---------- screen scaffolding ---------- */
.flk2-screen{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;
  opacity:0;transform:translateY(12px) scale(.994);pointer-events:none;
  transition:opacity .4s var(--flk2-ease),transform .4s var(--flk2-ease)}
.flk2-screen.flk2-on{opacity:1;transform:none;pointer-events:auto}

/* ---------- glass surface ---------- */
.flk2-panel{position:relative;background:var(--flk2-glass);
  border:1px solid var(--flk2-line);border-radius:24px;
  backdrop-filter:blur(22px) saturate(1.35);-webkit-backdrop-filter:blur(22px) saturate(1.35);
  box-shadow:var(--flk2-shadow),var(--flk2-inset)}
.flk2-panel::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.05),transparent 32%)}

/* ---------- top chrome ---------- */
.flk2-top{display:flex;align-items:flex-start;justify-content:space-between;
  padding:24px 32px;flex:0 0 auto;gap:16px}
.flk2-wordmark{font-weight:800;letter-spacing:-.02em;font-size:30px;line-height:1;
  background:linear-gradient(180deg,#ffffff,#bcc8f4);-webkit-background-clip:text;
  background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(139,123,255,.45))}
.flk2-wordmark .flk2-wm-d{background:linear-gradient(135deg,var(--flk2-cyan),var(--flk2-violet));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.flk2-tagline{font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--flk2-muted);margin-top:8px;font-weight:600}
.flk2-status{display:flex;align-items:center;gap:9px;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--flk2-muted-2);font-weight:600;
  background:var(--flk2-glass);border:1px solid var(--flk2-line);border-radius:var(--flk2-radius-pill);
  padding:8px 14px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.flk2-statusdot{width:8px;height:8px;border-radius:50%;background:var(--flk2-gold);
  box-shadow:0 0 0 3px rgba(255,212,94,.16),0 0 10px rgba(255,212,94,.9);
  transition:background var(--flk2-t),box-shadow var(--flk2-t);animation:flk2-pulse 2.4s var(--flk2-ease) infinite}
.flk2-statusdot.flk2-live{background:var(--flk2-success);
  box-shadow:0 0 0 3px rgba(86,217,140,.16),0 0 12px rgba(86,217,140,.95)}
@keyframes flk2-pulse{0%,100%{opacity:1}50%{opacity:.55}}

/* ---------- section labels ---------- */
.flk2-label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--flk2-muted);font-weight:600}

/* ---------- HOME layout ---------- */
.flk2-home-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;
  gap:24px;padding:8px 40px 48px;min-height:0}

/* locker (left) */
.flk2-locker{width:min(420px,40vw);padding:28px;display:flex;flex-direction:column;align-items:center}
.flk2-callsign{display:flex;align-items:center;gap:10px;align-self:stretch;justify-content:center;
  margin-bottom:8px}
.flk2-callsign .flk2-label{opacity:.85}
.flk2-callname{font-size:22px;font-weight:800;letter-spacing:-.01em;color:#fff;
  max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flk2-pencil{cursor:pointer;border:1px solid var(--flk2-line);background:rgba(255,255,255,.03);
  color:var(--flk2-muted-2);font-size:15px;width:30px;height:30px;display:grid;place-items:center;
  border-radius:10px;line-height:0;transition:color var(--flk2-t),transform 120ms var(--flk2-ease),
  border-color var(--flk2-t),background var(--flk2-t)}
.flk2-pencil:hover{color:#dbe6ff;transform:translateY(-1px);border-color:var(--flk2-line-strong);
  background:rgba(139,123,255,.12)}
.flk2-pencil:active{transform:scale(.95)}

.flk2-birdstage{position:relative;width:100%;height:236px;display:flex;
  align-items:center;justify-content:center;margin:8px 0 20px}
.flk2-birdstage::after{content:'';position:absolute;inset:6% 12% 0;border-radius:50%;pointer-events:none;
  background:radial-gradient(60% 50% at 50% 42%,var(--flk2-glow,rgba(255,90,95,.4)),transparent 70%);
  filter:blur(22px);opacity:.7;transition:background .35s var(--flk2-ease)}
.flk2-bird{position:relative;z-index:1;width:74%;max-width:300px;color:var(--flk2-bird,#ff5a5f);
  filter:drop-shadow(0 16px 30px rgba(0,0,0,.55))
         drop-shadow(0 0 34px var(--flk2-glow,rgba(255,90,95,.6)));
  animation:flk2-bob 4.6s var(--flk2-ease) infinite;transition:color .35s var(--flk2-ease),filter .35s var(--flk2-ease)}
.flk2-bird-svg{width:100%;height:auto;display:block}
.flk2-shadow{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
  width:44%;height:16px;border-radius:50%;background:rgba(0,0,0,.5);
  filter:blur(9px);animation:flk2-shadowpulse 4.6s var(--flk2-ease) infinite}
@keyframes flk2-bob{0%,100%{transform:translateY(0) rotate(-1.2deg)}
  50%{transform:translateY(-16px) rotate(1.2deg)}}
@keyframes flk2-shadowpulse{0%,100%{transform:translateX(-50%) scale(1);opacity:.5}
  50%{transform:translateX(-50%) scale(.8);opacity:.3}}

.flk2-swatch-wrap{display:flex;flex-direction:column;gap:12px;align-items:center;align-self:stretch}
.flk2-swatches{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.flk2-sw{width:34px;height:34px;border-radius:50%;cursor:pointer;padding:0;
  border:1px solid rgba(255,255,255,.14);position:relative;outline:none;
  background-image:radial-gradient(60% 55% at 32% 28%, rgba(255,255,255,.65), transparent 60%);
  transition:transform 140ms var(--flk2-ease),box-shadow var(--flk2-t)}
.flk2-sw::before{content:'';position:absolute;inset:0;border-radius:50%;
  background:var(--flk2-c);z-index:-1}
.flk2-sw:hover{transform:translateY(-2px) scale(1.08)}
.flk2-sw:active{transform:scale(.95)}
.flk2-sw:focus-visible{box-shadow:0 0 0 2px var(--flk2-cyan),0 0 14px -2px var(--flk2-cyan)}
.flk2-sw.flk2-sel{transform:translateY(-3px) scale(1.1);
  box-shadow:0 0 0 2px rgba(7,11,22,1),0 0 0 4px rgba(255,255,255,.9),0 6px 18px var(--flk2-c)}

/* bird / avatar picker (compact chip row in the locker) */
.flk2-birds{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.flk2-birdchip{cursor:pointer;padding:7px 12px;border-radius:var(--flk2-radius-pill);
  border:1px solid var(--flk2-line);background:var(--flk2-glass-2);color:var(--flk2-muted-2);
  font-size:12px;font-weight:700;letter-spacing:.02em;line-height:1;outline:none;
  transition:color var(--flk2-t),border-color var(--flk2-t),background var(--flk2-t),
  transform 120ms var(--flk2-ease),box-shadow var(--flk2-t)}
.flk2-birdchip:hover{color:#dbe6ff;transform:translateY(-1px);border-color:var(--flk2-line-strong);
  background:rgba(139,123,255,.12)}
.flk2-birdchip:active{transform:scale(.96)}
.flk2-birdchip:focus-visible{box-shadow:0 0 0 2px var(--flk2-cyan)}
.flk2-birdchip.flk2-sel{color:#06101f;border-color:transparent;
  background:linear-gradient(135deg,var(--flk2-cyan),var(--flk2-violet));
  box-shadow:0 6px 18px -6px rgba(84,224,255,.6),inset 0 1px 0 rgba(255,255,255,.4)}

/* action (right) */
.flk2-action{width:min(456px,46vw);padding:26px 28px 28px;display:flex;flex-direction:column;gap:18px}
.flk2-section{display:flex;flex-direction:column;gap:12px}
.flk2-modes{display:flex;flex-direction:column;gap:10px}
.flk2-mode{position:relative;display:flex;align-items:center;gap:14px;text-align:left;cursor:pointer;
  border:1px solid var(--flk2-line);background:var(--flk2-glass-2);
  border-radius:var(--flk2-radius-card);padding:14px 16px;color:var(--flk2-ink);width:100%;
  transition:border-color var(--flk2-t),background var(--flk2-t),box-shadow var(--flk2-t),transform 120ms var(--flk2-ease)}
.flk2-mode:hover{transform:translateY(-2px);border-color:var(--flk2-line-strong);
  box-shadow:0 12px 30px -12px rgba(0,0,0,.7),0 0 0 1px rgba(139,123,255,.2)}
.flk2-mode:active{transform:scale(.99)}
.flk2-mode.flk2-sel{border-color:transparent;background:rgba(34,42,78,.5);
  box-shadow:0 0 0 1.5px rgba(84,224,255,.55),0 0 26px -6px rgba(84,224,255,.5),
  inset 0 0 24px -10px rgba(139,123,255,.7)}
.flk2-mode-ic{width:42px;height:42px;border-radius:12px;flex:0 0 auto;display:grid;place-items:center;
  font-size:22px;color:#dce8ff;background:rgba(255,255,255,.04);border:1px solid var(--flk2-line);
  transition:color var(--flk2-t),background var(--flk2-t)}
.flk2-mode.flk2-sel .flk2-mode-ic{color:#fff;
  background:linear-gradient(135deg,rgba(84,224,255,.22),rgba(139,123,255,.22))}
.flk2-mode-txt{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.flk2-mode-name{font-weight:800;letter-spacing:.02em;font-size:14px}
.flk2-mode-desc{font-size:12.5px;color:var(--flk2-muted-2);line-height:1.35}
.flk2-mode-check{width:20px;height:20px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;
  color:#06101f;font-size:13px;background:linear-gradient(135deg,var(--flk2-cyan),var(--flk2-violet));
  opacity:0;transform:scale(.6);transition:opacity var(--flk2-t),transform var(--flk2-t);
  box-shadow:0 0 12px rgba(84,224,255,.6)}
.flk2-mode.flk2-sel .flk2-mode-check{opacity:1;transform:scale(1)}

.flk2-divider{height:1px;border:0;margin:2px 0;
  background:linear-gradient(90deg,transparent,var(--flk2-line-strong),transparent)}

/* ---------- buttons ---------- */
.flk2-btn{position:relative;border:0;border-radius:var(--flk2-radius-btn);font-weight:700;
  letter-spacing:.02em;cursor:pointer;padding:15px 18px;font-size:14px;width:100%;
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
  transition:transform 120ms var(--flk2-ease),box-shadow var(--flk2-t),filter var(--flk2-t),opacity var(--flk2-t)}
.flk2-btn .flk2-ic{font-size:18px}
.flk2-btn:active{transform:scale(.98)}
.flk2-btn-pri{color:#04101e;
  background:linear-gradient(135deg,var(--flk2-cyan),var(--flk2-violet));
  box-shadow:0 10px 30px -8px rgba(84,224,255,.5),0 0 0 1px rgba(255,255,255,.08),
  inset 0 1px 0 rgba(255,255,255,.45)}
.flk2-btn-pri:hover{filter:brightness(1.05);
  box-shadow:0 16px 44px -8px rgba(108,170,255,.7),0 0 0 1px rgba(255,255,255,.12),
  inset 0 1px 0 rgba(255,255,255,.5)}
.flk2-btn-go{width:auto;flex:0 0 auto;padding:15px 22px;color:#04150f;
  background:linear-gradient(135deg,var(--flk2-success),#2ec4b6);
  box-shadow:0 10px 26px -8px rgba(86,217,140,.5),inset 0 1px 0 rgba(255,255,255,.4)}
.flk2-btn-go:hover{filter:brightness(1.06);box-shadow:0 14px 34px -8px rgba(86,217,140,.65),inset 0 1px 0 rgba(255,255,255,.45)}
.flk2-btn-sec{color:#cfe0ff;background:var(--flk2-glass-2);border:1px solid var(--flk2-line-strong);
  box-shadow:var(--flk2-inset)}
.flk2-btn-sec:hover{background:rgba(28,36,66,.7);border-color:rgba(150,170,255,.4)}
.flk2-btn:disabled{opacity:.45;cursor:not-allowed;filter:none;box-shadow:none;transform:none}
.flk2-btn:disabled:hover{filter:none}
.flk2-btn.flk2-pending{opacity:.7;cursor:progress;animation:flk2-glowpulse 1.1s var(--flk2-ease) infinite}

/* ---------- code chip (create) ---------- */
.flk2-codebox{display:none;align-items:center;justify-content:space-between;gap:12px;
  background:var(--flk2-glass-2);border:1px solid var(--flk2-line-strong);
  border-radius:var(--flk2-radius-card);padding:12px 14px 12px 18px;
  box-shadow:var(--flk2-inset),inset 0 0 30px -14px rgba(84,224,255,.7);
  animation:flk2-popin .35s var(--flk2-ease)}
.flk2-codebox.flk2-on{display:flex}
@keyframes flk2-popin{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.flk2-codemeta{display:flex;flex-direction:column;gap:4px;min-width:0}
.flk2-codeval{font-size:30px;font-weight:800;letter-spacing:.14em;line-height:1;
  background:linear-gradient(135deg,#fff,#bcd0ff);-webkit-background-clip:text;
  background-clip:text;color:transparent;font-variant-numeric:tabular-nums}
.flk2-copy{border:1px solid var(--flk2-line);background:rgba(255,255,255,.04);color:#dce8ff;
  border-radius:10px;padding:9px 12px;font-size:11px;font-weight:700;cursor:pointer;
  letter-spacing:.1em;text-transform:uppercase;display:inline-flex;align-items:center;gap:7px;
  transition:background var(--flk2-t),transform 120ms var(--flk2-ease),color var(--flk2-t),border-color var(--flk2-t)}
.flk2-copy .flk2-ic{font-size:15px}
.flk2-copy:hover{background:rgba(139,123,255,.16);border-color:var(--flk2-line-strong);transform:translateY(-1px)}
.flk2-copy:active{transform:scale(.96)}
.flk2-copy.flk2-done{color:var(--flk2-success);border-color:rgba(86,217,140,.5);background:rgba(86,217,140,.12)}

/* ---------- inputs ---------- */
.flk2-join{display:flex;gap:10px;align-items:stretch}
.flk2-input{flex:1 1 auto;min-width:0;background:var(--flk2-glass-2);
  border:1px solid var(--flk2-line-strong);border-radius:var(--flk2-radius-btn);color:#fff;
  padding:14px 16px;font-size:16px;font-weight:700;letter-spacing:.22em;outline:none;
  box-shadow:var(--flk2-inset);text-align:center;
  transition:border-color var(--flk2-t),box-shadow var(--flk2-t)}
.flk2-input::placeholder{color:var(--flk2-muted);letter-spacing:.16em;font-weight:600}
.flk2-input:focus{border-color:rgba(84,224,255,.7);
  box-shadow:0 0 0 2px rgba(84,224,255,.45),0 0 22px -6px rgba(84,224,255,.6),var(--flk2-inset)}

/* ---------- AUTH ---------- */
.flk2-auth-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}
.flk2-authcard{width:min(460px,92vw);padding:40px 38px 36px;text-align:center;
  display:flex;flex-direction:column;gap:18px;align-items:center}
.flk2-authbirdstage{position:relative;width:140px;height:120px;display:grid;place-items:center}
.flk2-authbirdstage::after{content:'';position:absolute;inset:14% 8% 4%;border-radius:50%;
  background:radial-gradient(60% 50% at 50% 45%,var(--flk2-glow,rgba(255,90,95,.45)),transparent 70%);
  filter:blur(18px);opacity:.75}
.flk2-authcard .flk2-bird{position:relative;z-index:1;width:130px;animation:flk2-bob 4.6s var(--flk2-ease) infinite}
.flk2-auth-title{font-size:26px;font-weight:800;letter-spacing:-.02em}
.flk2-auth-sub{font-size:13.5px;color:var(--flk2-muted-2);margin-top:-10px;line-height:1.5}
.flk2-auth-field{align-self:stretch;display:flex;flex-direction:column;gap:8px;text-align:left}
.flk2-auth-body .flk2-input{letter-spacing:.01em;text-align:left;font-weight:600;font-size:17px;padding:15px 16px}
.flk2-authcard .flk2-btn{align-self:stretch}

/* ---------- CONNECTING ---------- */
.flk2-connect-body{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:24px}
.flk2-spinner{position:relative;width:56px;height:56px;border-radius:50%;
  background:conic-gradient(from 0deg,transparent,var(--flk2-cyan) 70%,var(--flk2-violet));
  -webkit-mask:radial-gradient(closest-side,transparent 64%,#000 66%);
  mask:radial-gradient(closest-side,transparent 64%,#000 66%);
  animation:flk2-spin 1s linear infinite;filter:drop-shadow(0 0 10px rgba(84,224,255,.5))}
.flk2-connect-msg{font-size:16px;font-weight:700;letter-spacing:.01em;color:#dce8ff}
@keyframes flk2-spin{to{transform:rotate(360deg)}}

/* ---------- WAITING ROOM ---------- */
.flk2-wait-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}
.flk2-waitcard{width:min(560px,94vw);padding:32px 34px;display:flex;flex-direction:column;gap:22px;align-items:center}
.flk2-wait-mode{display:inline-flex;align-items:center;gap:9px;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--flk2-muted-2);font-weight:600;
  border:1px solid var(--flk2-line);border-radius:var(--flk2-radius-pill);padding:7px 14px}
.flk2-wait-mode .flk2-ic{font-size:15px;color:var(--flk2-cyan)}
.flk2-wait-codewrap{display:flex;align-items:center;gap:14px}
.flk2-wait-code{font-size:54px;font-weight:800;letter-spacing:.14em;line-height:1;
  background:linear-gradient(180deg,#fff,#bcd0ff);-webkit-background-clip:text;
  background-clip:text;color:transparent;font-variant-numeric:tabular-nums;
  filter:drop-shadow(0 0 30px rgba(108,150,255,.45))}
.flk2-roster{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;min-height:42px;align-self:stretch}
.flk2-chip{display:flex;align-items:center;gap:9px;background:var(--flk2-glass-2);
  border:1px solid var(--flk2-line);border-radius:var(--flk2-radius-pill);padding:8px 14px 8px 10px;
  font-size:13.5px;font-weight:700;animation:flk2-rise .4s var(--flk2-ease) both}
.flk2-chip.flk2-me{border-color:rgba(84,224,255,.55);box-shadow:0 0 0 1px rgba(84,224,255,.3),0 0 18px -8px rgba(84,224,255,.7)}
.flk2-chipdot{width:13px;height:13px;border-radius:50%;flex:0 0 auto;
  box-shadow:0 0 8px currentColor,inset 0 1px 1px rgba(255,255,255,.5)}
.flk2-crown{color:var(--flk2-gold);font-size:15px;line-height:0;filter:drop-shadow(0 0 6px rgba(255,212,94,.6))}
.flk2-me-tag{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--flk2-cyan);font-weight:700}
.flk2-wait-hint{text-align:center;font-size:13px;color:var(--flk2-muted);line-height:1.5}
.flk2-waitcard .flk2-btn-pri{align-self:stretch;animation:flk2-glowpulse 2.6s var(--flk2-ease) infinite}
@keyframes flk2-glowpulse{0%,100%{box-shadow:0 10px 30px -8px rgba(84,224,255,.5),0 0 0 1px rgba(255,255,255,.08),inset 0 1px 0 rgba(255,255,255,.45)}
  50%{box-shadow:0 16px 44px -8px rgba(108,170,255,.75),0 0 0 1px rgba(255,255,255,.12),inset 0 1px 0 rgba(255,255,255,.5)}}
@keyframes flk2-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ---------- RESULTS ---------- */
.flk2-res-body{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}
.flk2-rescard{width:min(540px,94vw);padding:30px 30px 28px;display:flex;flex-direction:column;gap:18px}
.flk2-res-title{font-size:24px;font-weight:800;text-align:center;letter-spacing:-.01em;
  background:linear-gradient(180deg,#fff,#ffe9a8);-webkit-background-clip:text;
  background-clip:text;color:transparent;filter:drop-shadow(0 0 22px rgba(255,212,94,.35))}
.flk2-rows{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto}
.flk2-resrow{display:flex;align-items:center;gap:14px;background:var(--flk2-glass-2);
  border:1px solid var(--flk2-line);border-radius:14px;padding:11px 16px;
  animation:flk2-rise .4s var(--flk2-ease) both}
.flk2-resrow.flk2-me{border-color:rgba(84,224,255,.5);box-shadow:0 0 0 1px rgba(84,224,255,.3),0 0 18px -8px rgba(84,224,255,.7)}
.flk2-rank{width:34px;text-align:center;flex:0 0 auto;font-weight:800;font-size:15px;
  color:var(--flk2-muted-2);font-variant-numeric:tabular-nums}
.flk2-medal{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;
  font-size:13px;font-weight:800;color:#1a1206;
  box-shadow:inset 0 1px 1px rgba(255,255,255,.7),inset 0 -2px 4px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.4)}
.flk2-medal-1{background:radial-gradient(circle at 34% 28%,#fff3c4,#ffcf3f 55%,#d99a1e)}
.flk2-medal-2{background:radial-gradient(circle at 34% 28%,#fbfdff,#cdd6e2 55%,#9aa6b8)}
.flk2-medal-3{background:radial-gradient(circle at 34% 28%,#f7cfa6,#d18a4e 55%,#9c5f2c);color:#fff}
.flk2-resname{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0;
  font-weight:800;font-size:14.5px}
.flk2-resname>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flk2-resscore{font-weight:800;font-size:18px;letter-spacing:.01em;color:#fff;flex:0 0 auto;
  font-variant-numeric:tabular-nums}
.flk2-dnf{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--flk2-danger);
  font-weight:700;border:1px solid rgba(255,93,114,.35);border-radius:6px;padding:2px 6px;margin-left:6px}
.flk2-rescard .flk2-btn-pri{margin-top:4px}

/* ---------- responsive ---------- */
@media (max-width:760px){
  .flk2-home-body{flex-direction:column;gap:16px;overflow:auto;align-items:stretch;
    justify-content:flex-start;padding:6px 16px 28px}
  .flk2-locker,.flk2-action{width:100%}
  .flk2-birdstage{height:180px}
  .flk2-wordmark{font-size:24px}
  .flk2-top{padding:16px 18px}
  .flk2-wait-code{font-size:40px}
}

@media (prefers-reduced-motion:reduce){
  #${ROOT_ID} *{animation:none!important;transition:none!important}
  #${ROOT_ID} *{transform:none!important}
  .flk2-screen{opacity:1}
}
`;

export class MenuShell {
  constructor({ palette, name, color, skin, onCommit, onSetName, onSetColor, onSetSkin, onLeave } = {}) {
    this.palette = (Array.isArray(palette) && palette.length === 8) ? palette.slice() : DEFAULT_PALETTE.slice();
    this.onCommit = typeof onCommit === 'function' ? onCommit : () => {};
    this.onSetName = typeof onSetName === 'function' ? onSetName : () => {};
    this.onSetColor = typeof onSetColor === 'function' ? onSetColor : () => {};
    this.onSetSkin = typeof onSetSkin === 'function' ? onSetSkin : () => {};
    this.onLeave = typeof onLeave === 'function' ? onLeave : () => {};

    // resolve persisted defaults
    let storedName = null;
    let storedColor = null;
    let storedSkin = null;
    try {
      storedName = localStorage.getItem(LS_NAME);
      const c = localStorage.getItem(LS_COLOR);
      if (c != null) storedColor = parseInt(c, 10);
      storedSkin = localStorage.getItem(LS_SKIN);
    } catch (_) { /* localStorage may be unavailable */ }

    this._name = (name != null ? name : storedName) || '';
    let resolvedColor = (color != null ? color : storedColor);
    if (typeof resolvedColor !== 'number' || Number.isNaN(resolvedColor)) resolvedColor = 0;
    this._color = ((resolvedColor % 8) + 8) % 8;

    let resolvedSkin = (skin != null ? skin : storedSkin);
    this._skin = SKIN_IDS.includes(resolvedSkin) ? resolvedSkin : DEFAULT_SKIN;

    this._mode = 'creative';
    this._pendingCode = null;     // auto-generated code awaiting Create
    this._mounted = false;
    this._onStart = null;
    this._onAgain = null;
    this._connected = false;      // last-known net connection state
    this._isHost = false;         // am I the host of the current waiting room?
    this._pendingStart = false;   // host pressed Start before connect → fire on connect
    this._rosterSig = null;       // signature of the roster currently rendered (diffing)
    this.el = {};                 // element refs
  }

  // ---- public getters ----
  get currentName() { return this._name; }
  get currentColor() { return this._color; }
  get currentSkin() { return this._skin; }

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
      '<div class="flk2-aurora"></div>' +
      '<div class="flk2-stars"></div>' +
      '<div class="flk2-grain"></div>' +
      '<div class="flk2-vignette"></div>';
    while (chrome.firstChild) root.appendChild(chrome.firstChild);

    // Collect status chips fresh on each (re)build so setConnected() can sync all of them.
    this._statusDots = [];
    this._statusLabels = [];

    this._buildAuth();
    this._buildHome();
    this._buildConnecting();
    this._buildWaiting();
    this._buildResults();

    this._mounted = true;
    this._syncBird();
    this._syncSwatches();
    this._syncBirdChips();

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

    const stage = document.createElement('div');
    stage.className = 'flk2-authbirdstage';
    const bird = document.createElement('div');
    bird.className = 'flk2-bird';
    bird.innerHTML = BIRD_SVG;
    stage.appendChild(bird);
    card.appendChild(stage);
    this.el.authBird = bird;

    const title = document.createElement('div');
    title.className = 'flk2-auth-title';
    title.textContent = 'Choose your callsign';
    card.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'flk2-auth-sub';
    sub.textContent = 'The flock will know you by this name.';
    card.appendChild(sub);

    const field = document.createElement('div');
    field.className = 'flk2-auth-field';
    const flabel = document.createElement('div');
    flabel.className = 'flk2-label';
    flabel.textContent = 'Callsign';
    field.appendChild(flabel);

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
    field.appendChild(input);
    card.appendChild(field);

    const btn = document.createElement('button');
    btn.className = 'flk2-btn flk2-btn-pri';
    btn.type = 'button';
    const btnTxt = document.createElement('span');
    btnTxt.textContent = 'Continue';
    btn.appendChild(btnTxt);
    btn.insertAdjacentHTML('beforeend', ICON.arrow);
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
    // Static chrome -> innerHTML is safe (no user input). Accent on final glyph.
    mark.innerHTML = 'FLOCK<span class="flk2-wm-d">D</span>';
    const tag = document.createElement('div');
    tag.className = 'flk2-tagline';
    tag.textContent = 'co-author worlds · outfly the hunt';
    brand.appendChild(mark);
    brand.appendChild(tag);
    top.appendChild(brand);

    if (withStatus) {
      const status = document.createElement('div');
      status.className = 'flk2-status';
      const dot = document.createElement('span');
      dot.className = 'flk2-statusdot';
      const label = document.createElement('span');
      label.textContent = this._connected ? 'connected' : 'connecting';
      if (this._connected) dot.classList.add('flk2-live');
      status.appendChild(dot);
      status.appendChild(label);
      top.appendChild(status);
      // _topBar is built once per screen (connecting/waiting/results), so collect
      // EVERY status chip and update them all — otherwise setConnected() only
      // touches the last-built one and the visible chip stays stuck.
      this.el.statusDot = dot;
      this.el.statusLabel = label;
      (this._statusDots || (this._statusDots = [])).push(dot);
      (this._statusLabels || (this._statusLabels = [])).push(label);
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
    cTag.className = 'flk2-label';
    cTag.textContent = 'Callsign';
    const cName = document.createElement('span');
    cName.className = 'flk2-callname';
    const pencil = document.createElement('button');
    pencil.className = 'flk2-pencil';
    pencil.type = 'button';
    pencil.title = 'Edit callsign';
    pencil.setAttribute('aria-label', 'Edit callsign');
    pencil.innerHTML = ICON.pencil;
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

    const swatchWrap = document.createElement('div');
    swatchWrap.className = 'flk2-swatch-wrap';
    const swLabel = document.createElement('div');
    swLabel.className = 'flk2-label';
    swLabel.textContent = 'Plumage';
    swatchWrap.appendChild(swLabel);

    const swatches = document.createElement('div');
    swatches.className = 'flk2-swatches';
    this.el.swatches = [];
    for (let i = 0; i < 8; i++) {
      const sw = document.createElement('button');
      sw.className = 'flk2-sw';
      sw.type = 'button';
      const col = this._swatchColor(i);
      sw.style.setProperty('--flk2-c', col);
      sw.title = `Color ${i + 1}`;
      sw.setAttribute('aria-label', `Bird color ${i + 1}`);
      sw.addEventListener('click', () => this._selectColor(i));
      swatches.appendChild(sw);
      this.el.swatches.push(sw);
    }
    swatchWrap.appendChild(swatches);
    locker.appendChild(swatchWrap);

    // ---- BIRD / avatar picker (compact chip row) ----
    const birdWrap = document.createElement('div');
    birdWrap.className = 'flk2-swatch-wrap';
    const birdLabel = document.createElement('div');
    birdLabel.className = 'flk2-label';
    birdLabel.textContent = 'Bird';
    birdWrap.appendChild(birdLabel);

    const birds = document.createElement('div');
    birds.className = 'flk2-birds';
    this.el.birdChips = {};
    for (const id of SKIN_IDS) {
      const chip = document.createElement('button');
      chip.className = 'flk2-birdchip' + (id === this._skin ? ' flk2-sel' : '');
      chip.type = 'button';
      // BIRDS labels (XSS-safe via textContent), fall back to the id itself.
      const label = (BIRDS[id] && BIRDS[id].label) || id;
      chip.textContent = label;
      chip.title = label;
      chip.setAttribute('aria-label', `Bird ${label}`);
      chip.addEventListener('click', () => this._selectSkin(id));
      birds.appendChild(chip);
      this.el.birdChips[id] = chip;
    }
    birdWrap.appendChild(birds);
    locker.appendChild(birdWrap);

    body.appendChild(locker);

    // ---------------- ACTION (right) ----------------
    const action = document.createElement('div');
    action.className = 'flk2-panel flk2-action';

    // -- MODE section --
    const modeSec = document.createElement('div');
    modeSec.className = 'flk2-section';
    const mh = document.createElement('div');
    mh.className = 'flk2-label';
    mh.textContent = 'Choose your flight';
    modeSec.appendChild(mh);

    const modes = document.createElement('div');
    modes.className = 'flk2-modes';
    this.el.modeCards = {};
    const defs = [
      { id: 'creative', icon: ICON.brush, name: 'CREATIVE', desc: 'Co-author the level, then race it together.' },
      { id: 'survival', icon: ICON.skull, name: 'SURVIVAL', desc: 'Battle royale — an AI predator hunts the leader.' },
    ];
    for (const d of defs) {
      const card = document.createElement('button');
      card.className = 'flk2-mode' + (d.id === this._mode ? ' flk2-sel' : '');
      card.type = 'button';
      const ic = document.createElement('span');
      ic.className = 'flk2-mode-ic';
      ic.innerHTML = d.icon;
      const txt = document.createElement('div');
      txt.className = 'flk2-mode-txt';
      const nm = document.createElement('div');
      nm.className = 'flk2-mode-name';
      nm.textContent = d.name;
      const ds = document.createElement('div');
      ds.className = 'flk2-mode-desc';
      ds.textContent = d.desc;
      txt.appendChild(nm); txt.appendChild(ds);
      const check = document.createElement('span');
      check.className = 'flk2-mode-check';
      check.innerHTML = ICON.check;
      card.appendChild(ic); card.appendChild(txt); card.appendChild(check);
      card.addEventListener('click', () => this._selectMode(d.id));
      modes.appendChild(card);
      this.el.modeCards[d.id] = card;
    }
    modeSec.appendChild(modes);
    action.appendChild(modeSec);

    action.appendChild(this._divider());

    // -- CREATE section --
    const createSec = document.createElement('div');
    createSec.className = 'flk2-section';
    const ch = document.createElement('div');
    ch.className = 'flk2-label';
    ch.textContent = 'Start a flock';
    createSec.appendChild(ch);

    const createBtn = document.createElement('button');
    createBtn.className = 'flk2-btn flk2-btn-pri';
    createBtn.type = 'button';
    this._setBtn(createBtn, 'Create room', ICON.plus);
    createSec.appendChild(createBtn);

    const codebox = document.createElement('div');
    codebox.className = 'flk2-codebox';
    const codeMeta = document.createElement('div');
    codeMeta.className = 'flk2-codemeta';
    const codeLabel = document.createElement('div');
    codeLabel.className = 'flk2-label';
    codeLabel.textContent = 'Room code';
    const codeVal = document.createElement('div');
    codeVal.className = 'flk2-codeval';
    codeMeta.appendChild(codeLabel);
    codeMeta.appendChild(codeVal);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'flk2-copy';
    copyBtn.type = 'button';
    this._setCopy(copyBtn, 'Copy', ICON.copy);
    codebox.appendChild(codeMeta);
    codebox.appendChild(copyBtn);
    createSec.appendChild(codebox);
    this.el.createCodeBox = codebox;
    this.el.createCodeVal = codeVal;
    this.el.createCopy = copyBtn;

    copyBtn.addEventListener('click', () => this._copy(this._pendingCode, copyBtn));

    createBtn.addEventListener('click', () => {
      if (!this._pendingCode) {
        // first click: generate + reveal the code
        this._pendingCode = this._randomCode();
        this._text(codeVal, this._pendingCode);
        codebox.classList.add('flk2-on');
        this._setBtn(createBtn, 'Launch room', ICON.arrow);
        return;
      }
      // second click: commit
      this.onCommit({
        create: true,
        code: this._pendingCode,
        name: this._name,
        color: this._color,
        skin: this._skin,
        mode: this._mode,
      });
    });
    this.el.createBtn = createBtn;
    action.appendChild(createSec);

    action.appendChild(this._divider());

    // -- JOIN section --
    const joinSec = document.createElement('div');
    joinSec.className = 'flk2-section';
    const joinH = document.createElement('div');
    joinH.className = 'flk2-label';
    joinH.textContent = 'Join a flock';
    joinSec.appendChild(joinH);

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
    goBtn.type = 'button';
    this._setBtn(goBtn, 'Go', ICON.arrow);

    const doJoin = () => {
      const code = joinInput.value.trim().toUpperCase().slice(0, 8);
      if (!code) { joinInput.focus(); return; }
      this.onCommit({
        create: false,
        code,
        name: this._name,
        color: this._color,
        skin: this._skin,
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
    joinSec.appendChild(join);
    action.appendChild(joinSec);

    body.appendChild(action);
    screen.appendChild(body);
    this.root.appendChild(screen);
    this.el.home = screen;

    this._refreshCallsign();
  }

  // Build a button label (text node) + trailing icon, XSS-safe for the label.
  _setBtn(btn, label, iconHtml) {
    btn.textContent = '';
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    if (iconHtml) btn.insertAdjacentHTML('beforeend', iconHtml);
  }

  _setCopy(btn, label, iconHtml) {
    btn.textContent = '';
    if (iconHtml) btn.insertAdjacentHTML('beforeend', iconHtml);
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
  }

  _divider() {
    const d = document.createElement('hr');
    d.className = 'flk2-divider';
    return d;
  }

  // ============================================================= CONNECTING
  _buildConnecting() {
    const screen = document.createElement('div');
    screen.className = 'flk2-screen';
    screen.hidden = true;
    screen.appendChild(this._topBar(true));
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
    this._setCopy(copy, 'Copy', ICON.copy);
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
    startBtn.type = 'button';
    this._setBtn(startBtn, 'Start match', ICON.arrow);
    card.appendChild(startBtn);
    this.el.waitStart = startBtn;

    const hint = document.createElement('div');
    hint.className = 'flk2-wait-hint';
    card.appendChild(hint);
    this.el.waitHint = hint;

    startBtn.addEventListener('click', () => {
      if (!this._isHost) return;
      if (!this._connected) {
        // Not connected yet: queue the Start and fire it on connect.
        this._pendingStart = true;
        this._syncStartBtn();
        return;
      }
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
    title.textContent = 'Flight results';
    card.appendChild(title);

    const rows = document.createElement('div');
    rows.className = 'flk2-rows';
    card.appendChild(rows);
    this.el.resRows = rows;

    const again = document.createElement('button');
    again.className = 'flk2-btn flk2-btn-pri';
    again.type = 'button';
    this._setBtn(again, 'Play again', ICON.arrow);
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

  _selectSkin(id) {
    this._skin = SKIN_IDS.includes(id) ? id : DEFAULT_SKIN;
    try { localStorage.setItem(LS_SKIN, this._skin); } catch (_) {}
    this._syncBirdChips();
    this.onSetSkin(this._skin);
  }

  _selectMode(id) {
    this._mode = (id === 'survival') ? 'survival' : 'creative';
    for (const key of Object.keys(this.el.modeCards || {})) {
      this.el.modeCards[key].classList.toggle('flk2-sel', key === this._mode);
    }
  }

  _syncBird() {
    const col = this._swatchColor(this._color);
    const glow = this._hexToRgba(col, 0.55);
    const apply = (el) => {
      if (!el) return;
      el.style.setProperty('--flk2-bird', col);
      el.style.setProperty('--flk2-glow', glow);
      const stage = el.parentElement;
      if (stage) stage.style.setProperty('--flk2-glow', glow);
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

  _syncBirdChips() {
    if (!this.el.birdChips) return;
    for (const id of Object.keys(this.el.birdChips)) {
      this.el.birdChips[id].classList.toggle('flk2-sel', id === this._skin);
    }
  }

  _refreshCallsign() {
    if (this.el.callName) this._text(this.el.callName, this._name || '—');
  }

  _copy(value, btn) {
    if (!value) return;
    const done = () => {
      if (!btn) return;
      const prevHtml = btn.innerHTML;
      this._setCopy(btn, 'Copied', ICON.check);
      btn.classList.add('flk2-done');
      setTimeout(() => { btn.innerHTML = prevHtml; btn.classList.remove('flk2-done'); }, 1300);
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
  // Stable signature of a roster so we only rebuild the DOM (and re-trigger the
  // entrance animation) when the membership/order/host/color/you actually change.
  _rosterSignature(list) {
    if (!Array.isArray(list) || !list.length) return 'empty';
    return list
      .map((p) => [
        (p && p.name) || 'bird',
        typeof (p && p.color) === 'number' ? p.color : 0,
        p && p.host ? 1 : 0,
        p && p.me ? 1 : 0,
      ].join(':'))
      .join('|');
  }

  _renderRoster(container, roster) {
    if (!container) return;
    const list = Array.isArray(roster) ? roster : [];
    // Diff: skip the full rebuild (and animation restart) when nothing changed.
    const sig = this._rosterSignature(list);
    if (container.__rosterSig === sig) return;
    container.__rosterSig = sig;
    container.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'flk2-wait-hint';
      empty.textContent = 'Waiting for birds to arrive…';
      container.appendChild(empty);
      return;
    }
    list.forEach((p, i) => {
      const chip = document.createElement('div');
      chip.className = 'flk2-chip' + (p && p.me ? ' flk2-me' : '');
      chip.style.animationDelay = (i * 0.045) + 's';
      const dot = document.createElement('span');
      dot.className = 'flk2-chipdot';
      const col = this._swatchColor(typeof p.color === 'number' ? p.color : 0);
      dot.style.background = col;
      dot.style.color = col;
      chip.appendChild(dot);
      if (p && p.host) {
        const crown = document.createElement('span');
        crown.className = 'flk2-crown';
        crown.innerHTML = ICON.crown;
        chip.appendChild(crown);
      }
      const nm = document.createElement('span');
      this._text(nm, (p && p.name) || 'bird');
      chip.appendChild(nm);
      if (p && p.me) {
        const tag = document.createElement('span');
        tag.className = 'flk2-me-tag';
        tag.textContent = 'you';
        chip.appendChild(tag);
      }
      container.appendChild(chip);
    });
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
    if (this.el.createBtn) this._setBtn(this.el.createBtn, 'Create room', ICON.plus);
    if (this.el.createCodeVal) this._text(this.el.createCodeVal, '');
    if (this.el.createCopy) { this._setCopy(this.el.createCopy, 'Copy', ICON.copy); this.el.createCopy.classList.remove('flk2-done'); }
    this._onStart = null;
    this._refreshCallsign();
    this._syncBird();
    this._syncSwatches();
    this._syncBirdChips();
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
    const next = !!isConnected;
    const changed = next !== this._connected;
    this._connected = next;
    // Update EVERY status chip (one per screen top bar), not just the last-built.
    const dots = this._statusDots || (this.el.statusDot ? [this.el.statusDot] : []);
    const labels = this._statusLabels || (this.el.statusLabel ? [this.el.statusLabel] : []);
    for (const d of dots) d.classList.toggle('flk2-live', next);
    for (const l of labels) l.textContent = next ? 'connected' : 'connecting';
    // Keep the waiting-room START button in sync with the live connection state.
    this._syncStartBtn();
    // If the host pressed Start before we were connected, fire it now.
    if (next && changed && this._pendingStart) {
      this._pendingStart = false;
      if (typeof this._onStart === 'function') this._onStart();
    }
  }

  // Reflect host + connection state onto the waiting-room START button.
  _syncStartBtn() {
    const btn = this.el.waitStart;
    if (!btn) return;
    if (!this._isHost) { btn.style.display = 'none'; btn.disabled = true; return; }
    btn.style.display = 'inline-flex';
    const ready = this._connected;
    const wantPending = this._pendingStart && !ready;
    btn.disabled = !ready;
    btn.classList.toggle('flk2-pending', wantPending || !ready);
    this._setBtn(btn, wantPending ? 'Starting…' : (ready ? 'Start match' : 'Connecting…'), ICON.arrow);
  }

  showWaitingRoom({ code, mode, isHost, roster, onStart } = {}) {
    if (!this._mounted) this.mount();
    this._onStart = typeof onStart === 'function' ? onStart : null;

    const safeCode = (code || '').toString().toUpperCase();
    this._text(this.el.waitCode, safeCode);
    // mode pill: crisp glyph + label (textContent for the label, XSS-safe)
    if (this.el.waitMode) {
      this.el.waitMode.innerHTML = (mode === 'survival') ? ICON.skull : ICON.brush;
      const ml = document.createElement('span');
      ml.textContent = (mode === 'survival') ? 'Survival — outfly the hunt' : 'Creative — co-author the world';
      this.el.waitMode.appendChild(ml);
    }

    // copy wiring (rebind each time so it copies the current code)
    if (this.el.waitCopy) {
      this._setCopy(this.el.waitCopy, 'Copy', ICON.copy);
      this.el.waitCopy.classList.remove('flk2-done');
      this.el.waitCopy.onclick = () => this._copy(safeCode, this.el.waitCopy);
    }

    // Fresh waiting room → force a roster rebuild even if the signature matches
    // a stale value left over from a previous match.
    if (this.el.waitRoster) this.el.waitRoster.__rosterSig = null;
    this._renderRoster(this.el.waitRoster, roster);

    this._isHost = !!isHost;
    // A fresh waiting room starts with no queued Start.
    this._pendingStart = false;
    this._syncStartBtn();
    if (this.el.waitHint) {
      this._text(this.el.waitHint, isHost
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
      list.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'flk2-resrow' + (p && p.me ? ' flk2-me' : '');
        row.style.animationDelay = (i * 0.05) + 's';

        // rank / medal
        if (i < 3) {
          const medal = document.createElement('div');
          medal.className = 'flk2-medal flk2-medal-' + (i + 1);
          medal.textContent = String(i + 1);
          row.appendChild(medal);
        } else {
          const rank = document.createElement('div');
          rank.className = 'flk2-rank';
          rank.textContent = String(i + 1);
          row.appendChild(rank);
        }

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
