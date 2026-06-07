/**
 * FLOCKED multiplayer lobby overlay (creative mode).
 * Self-contained DOM + CSS. Driven by NetClient via setState().
 *
 *   const ui = new LobbyUI();
 *   ui.onSubmitPrompt = (text) => net.conn.reducers.submitPrompt({ text });
 *   ui.onForge = () => net.startBuild();
 *   ui.setState({ roomCode, mode, state, isHost, roster });
 *
 * Visual language is shared verbatim with MenuShell (the "flk2-" shell):
 * same cinematic-dark + neon tokens, glass surfaces, type scale, motion. The
 * lobby keeps its own "flk-" prefix and the root class ".flk-lobby" (main.js
 * raises its z-index by class) but reads as the same product.
 */
const PALETTE = ['#ff5a5f', '#3fa7ff', '#5ad469', '#ffd23f', '#b06bff', '#ff8c42', '#2ec4b6', '#f15bb5'];

const CSS = `
.flk-lobby{
  /* ---- shared DESIGN TOKENS ---- */
  --flk-ink:#eaf2ff;
  --flk-muted:#7f8db5;
  --flk-muted-2:#9aa7cc;
  --flk-line:rgba(130,160,235,.16);
  --flk-line-strong:rgba(130,160,235,.28);
  --flk-cyan:#54e0ff;
  --flk-violet:#8b7bff;
  --flk-success:#56d98c;
  --flk-gold:#ffd45e;
  --flk-glass:rgba(16,22,40,.55);
  --flk-glass-2:rgba(12,17,33,.62);
  --flk-ease:cubic-bezier(.2,.8,.2,1);
  --flk-t:200ms var(--flk-ease);
  --flk-shadow:0 24px 70px -24px rgba(0,0,0,.75),0 2px 8px rgba(0,0,0,.4);
  --flk-inset:inset 0 1px 0 rgba(255,255,255,.08);

  position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;
  padding:24px;background:radial-gradient(1100px 700px at 50% -10%, rgba(139,123,255,.18), transparent 60%),
    rgba(5,8,16,.66);
  backdrop-filter:blur(10px) saturate(1.2);-webkit-backdrop-filter:blur(10px) saturate(1.2);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  font-feature-settings:'tnum' 1;color:var(--flk-ink);-webkit-font-smoothing:antialiased}
.flk-lobby *{box-sizing:border-box}
.flk-lobby button{font:inherit}
.flk-ic{width:1em;height:1em;display:block;flex:0 0 auto}

.flk-card{position:relative;width:min(460px,92vw);background:var(--flk-glass);
  border:1px solid var(--flk-line);border-radius:24px;padding:26px 26px 24px;
  backdrop-filter:blur(22px) saturate(1.35);-webkit-backdrop-filter:blur(22px) saturate(1.35);
  box-shadow:var(--flk-shadow),var(--flk-inset);
  animation:flk-pop .4s var(--flk-ease) both}
.flk-card::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.05),transparent 30%)}
@keyframes flk-pop{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}

.flk-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.flk-brand{display:flex;align-items:center;gap:9px}
.flk-mark{font-size:19px;font-weight:800;letter-spacing:-.02em;
  background:linear-gradient(180deg,#fff,#bcc8f4);-webkit-background-clip:text;background-clip:text;color:transparent}
.flk-mark .flk-d{background:linear-gradient(135deg,var(--flk-cyan),var(--flk-violet));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.flk-logo{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#04101e;
  background:linear-gradient(135deg,var(--flk-cyan),var(--flk-violet));font-size:17px;
  box-shadow:0 4px 14px -4px rgba(84,224,255,.7),inset 0 1px 0 rgba(255,255,255,.5)}
.flk-code{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--flk-muted-2);
  font-weight:600;font-variant-numeric:tabular-nums;border:1px solid var(--flk-line);
  border-radius:999px;padding:6px 12px;white-space:nowrap}
.flk-sub{font-size:12.5px;color:var(--flk-muted-2);margin-bottom:16px;line-height:1.5}

.flk-label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--flk-muted);
  font-weight:600;margin-bottom:9px}

.flk-roster{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.flk-chip{display:flex;align-items:center;gap:8px;background:var(--flk-glass-2);
  border:1px solid var(--flk-line);border-radius:999px;padding:6px 12px 6px 8px;
  font-size:12.5px;font-weight:700;animation:flk-rise .4s var(--flk-ease) both}
.flk-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;
  box-shadow:0 0 8px currentColor,inset 0 1px 1px rgba(255,255,255,.5)}
.flk-you{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--flk-cyan);font-weight:700}
.flk-mine{border-color:rgba(84,224,255,.55);
  box-shadow:0 0 0 1px rgba(84,224,255,.3),0 0 18px -8px rgba(84,224,255,.7)}
@keyframes flk-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.flk-ta{width:100%;background:var(--flk-glass-2);border:1px solid var(--flk-line-strong);
  border-radius:12px;color:var(--flk-ink);padding:13px 14px;font:inherit;font-size:14px;line-height:1.5;
  resize:none;min-height:64px;outline:none;box-shadow:var(--flk-inset);
  transition:border-color var(--flk-t),box-shadow var(--flk-t)}
.flk-ta::placeholder{color:var(--flk-muted)}
.flk-ta:focus{border-color:rgba(84,224,255,.7);
  box-shadow:0 0 0 2px rgba(84,224,255,.45),0 0 22px -6px rgba(84,224,255,.6),var(--flk-inset)}

.flk-row{display:flex;gap:10px;margin-top:14px}
.flk-btn{flex:1;position:relative;border:0;border-radius:12px;padding:13px;font-size:14px;
  font-weight:700;letter-spacing:.02em;cursor:pointer;display:inline-flex;align-items:center;
  justify-content:center;gap:8px;
  transition:transform 120ms var(--flk-ease),box-shadow var(--flk-t),filter var(--flk-t),opacity var(--flk-t)}
.flk-btn .flk-ic{font-size:17px}
.flk-btn:active{transform:scale(.98)}
.flk-btn.sec{color:#cfe0ff;background:var(--flk-glass-2);border:1px solid var(--flk-line-strong);
  box-shadow:var(--flk-inset)}
.flk-btn.sec:hover{background:rgba(28,36,66,.7);border-color:rgba(150,170,255,.4)}
.flk-btn.pri{color:#04101e;background:linear-gradient(135deg,var(--flk-cyan),var(--flk-violet));
  box-shadow:0 10px 30px -8px rgba(84,224,255,.5),0 0 0 1px rgba(255,255,255,.08),inset 0 1px 0 rgba(255,255,255,.45)}
.flk-btn.pri:hover{filter:brightness(1.05);
  box-shadow:0 16px 44px -8px rgba(108,170,255,.7),0 0 0 1px rgba(255,255,255,.12),inset 0 1px 0 rgba(255,255,255,.5)}
.flk-btn:disabled{opacity:.45;cursor:not-allowed;filter:none;box-shadow:none;transform:none}
.flk-btn:disabled:hover{filter:none}

.flk-forging{text-align:center;padding:28px 8px 18px}
.flk-spin{position:relative;width:46px;height:46px;margin:0 auto 16px;border-radius:50%;
  background:conic-gradient(from 0deg,transparent,var(--flk-cyan) 70%,var(--flk-violet));
  -webkit-mask:radial-gradient(closest-side,transparent 63%,#000 65%);
  mask:radial-gradient(closest-side,transparent 63%,#000 65%);
  animation:flkspin 1s linear infinite;filter:drop-shadow(0 0 10px rgba(84,224,255,.5))}
.flk-forge-title{font-size:16px;font-weight:700;letter-spacing:.01em;color:#dce8ff}
.flk-forge-sub{font-size:12.5px;color:var(--flk-muted);margin-top:7px}
.flk-forge-dots{display:inline-flex;gap:5px;margin-top:14px}
.flk-forge-dots i{width:6px;height:6px;border-radius:50%;background:var(--flk-cyan);opacity:.5;
  animation:flkdot 1.2s var(--flk-ease) infinite}
.flk-forge-dots i:nth-child(2){animation-delay:.18s}
.flk-forge-dots i:nth-child(3){animation-delay:.36s}
@keyframes flkspin{to{transform:rotate(360deg)}}
@keyframes flkdot{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}

@media (prefers-reduced-motion:reduce){
  .flk-lobby *{animation:none!important;transition:none!important;transform:none!important}
}
`;

// Crisp inline SVG glyphs (static, no user input). currentColor-driven.
const ICON = {
  bird: '<svg class="flk-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14c3 .4 5-.6 6.5-2.5C8.7 14.5 9 17 12 18c4 1.3 8-1 9-5-1.4 1-3 1.2-4.5.6 1.4-.7 2.3-2 2.5-3.6-1 .9-2.2 1.3-3.6 1.1A4.2 4.2 0 0 0 8.8 8C6 8.4 4 10.8 3 14z" fill="currentColor"/></svg>',
  send: '<svg class="flk-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-4 15-3.5-5L4 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  spark: '<svg class="flk-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4L12 3z" fill="currentColor"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" fill="currentColor" opacity=".8"/></svg>',
};

export class LobbyUI {
  constructor() {
    this.onSubmitPrompt = null;
    this.onForge = null;
    this._submitted = false;
    this._build();
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'flk-lobby';
    root.style.display = 'none';
    // Static chrome only (no user input) -> innerHTML is safe here.
    root.innerHTML = `
      <div class="flk-card">
        <div class="flk-h">
          <div class="flk-brand">
            <div class="flk-logo">${ICON.bird}</div>
            <div class="flk-mark">FLOCK<span class="flk-d">D</span></div>
          </div>
          <div class="flk-code" data-code></div>
        </div>
        <div class="flk-sub" data-sub>Creative — co-author the world, then race it together.</div>
        <div class="flk-label">Flock</div>
        <div class="flk-roster" data-roster></div>
        <div data-lobbybody>
          <div class="flk-label">Add to the world</div>
          <textarea class="flk-ta" data-prompt placeholder="e.g. a stormy pirate cove with narrow gaps and glowing buoys"></textarea>
          <div class="flk-row">
            <button class="flk-btn sec" data-submit type="button">${ICON.send}<span>Submit prompt</span></button>
            <button class="flk-btn pri" data-forge type="button">${ICON.spark}<span>Forge world</span></button>
          </div>
        </div>
        <div class="flk-forging" data-forging style="display:none">
          <div class="flk-spin"></div>
          <div class="flk-forge-title">Forging your world…</div>
          <div class="flk-forge-sub">Claude is fusing the flock's prompts into a level.</div>
          <div class="flk-forge-dots"><i></i><i></i><i></i></div>
        </div>
      </div>`;
    document.body.appendChild(root);

    this.root = root;
    this.elCode = root.querySelector('[data-code]');
    this.elSub = root.querySelector('[data-sub]');
    this.elRoster = root.querySelector('[data-roster]');
    this.elBody = root.querySelector('[data-lobbybody]');
    this.elForging = root.querySelector('[data-forging]');
    this.elPrompt = root.querySelector('[data-prompt]');
    this.btnSubmit = root.querySelector('[data-submit]');
    this.btnForge = root.querySelector('[data-forge]');
    this.elSubmitLabel = this.btnSubmit.querySelector('span');

    this.btnSubmit.addEventListener('click', () => {
      const text = this.elPrompt.value.trim();
      if (!text) return;
      this.onSubmitPrompt?.(text);
      this._submitted = true;
      if (this.elSubmitLabel) this.elSubmitLabel.textContent = 'Update prompt';
    });
    this.btnForge.addEventListener('click', () => this.onForge?.());
    // Don't let game key handlers steal typing.
    this.elPrompt.addEventListener('keydown', (e) => e.stopPropagation());
    this.elPrompt.addEventListener('keyup', (e) => e.stopPropagation());
    this.elPrompt.addEventListener('keypress', (e) => e.stopPropagation());
  }

  show() { this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; }

  setState({ roomCode, mode, state, isHost, roster }) {
    this.elCode.textContent = roomCode ? `Room ${roomCode}` : '';
    const building = state === 'building';
    this.elBody.style.display = building ? 'none' : 'block';
    this.elForging.style.display = building ? 'block' : 'none';

    // roster chips (XSS-safe: names via createTextNode)
    this.elRoster.innerHTML = '';
    (roster || []).forEach((p, i) => {
      const chip = document.createElement('div');
      chip.className = 'flk-chip' + (p.me ? ' flk-mine' : '');
      chip.style.animationDelay = (i * 0.045) + 's';
      const dot = document.createElement('span');
      dot.className = 'flk-dot';
      const col = PALETTE[(p.color ?? 0) % PALETTE.length];
      dot.style.background = col;
      dot.style.color = col;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(p.name));
      if (p.me) {
        const you = document.createElement('span');
        you.className = 'flk-you';
        you.textContent = 'you';
        chip.appendChild(you);
      }
      this.elRoster.appendChild(chip);
    });

    this.btnForge.style.display = isHost ? 'inline-flex' : 'none';
    this.btnForge.disabled = !isHost;
    this.elSub.textContent = isHost
      ? 'Creative — submit prompts, then Forge the world for the flock.'
      : 'Creative — submit a prompt. The host forges the world.';
  }
}
