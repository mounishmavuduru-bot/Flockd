/**
 * FLOCKED multiplayer lobby overlay (creative mode).
 * Self-contained DOM + CSS. Driven by NetClient via setState().
 *
 *   const ui = new LobbyUI();
 *   ui.onSubmitPrompt = (text) => net.conn.reducers.submitPrompt({ text });
 *   ui.onForge = () => net.startBuild();
 *   ui.setState({ roomCode, mode, state, isHost, roster });
 */
const PALETTE = ['#ff5a5f', '#3fa7ff', '#5ad469', '#ffd23f', '#b06bff', '#ff8c42', '#2ec4b6', '#f15bb5'];

const CSS = `
.flk-lobby{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
  background:rgba(8,12,22,.72);backdrop-filter:blur(6px);font-family:system-ui,-apple-system,sans-serif;color:#eaf2ff}
.flk-card{width:min(440px,92vw);background:#121a2b;border:1px solid #243352;border-radius:16px;
  padding:22px 22px 20px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.flk-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px}
.flk-title{font-size:20px;font-weight:800;letter-spacing:.3px}
.flk-code{font-size:13px;color:#8fb0e0;font-weight:600}
.flk-sub{font-size:12px;color:#7d90b3;margin-bottom:14px}
.flk-roster{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px}
.flk-chip{display:flex;align-items:center;gap:6px;background:#0d1424;border:1px solid #223252;
  border-radius:999px;padding:4px 10px 4px 6px;font-size:12px}
.flk-dot{width:11px;height:11px;border-radius:50%}
.flk-label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#7d90b3;margin-bottom:6px}
.flk-ta{width:100%;box-sizing:border-box;background:#0d1424;border:1px solid #2a3c61;border-radius:10px;
  color:#eaf2ff;padding:10px 12px;font-size:14px;resize:none;min-height:52px;outline:none}
.flk-ta:focus{border-color:#3fa7ff}
.flk-row{display:flex;gap:10px;margin-top:12px}
.flk-btn{flex:1;border:0;border-radius:10px;padding:11px;font-size:14px;font-weight:700;cursor:pointer;color:#06101f}
.flk-btn.sec{background:#243352;color:#cfe0ff}
.flk-btn.pri{background:linear-gradient(135deg,#48d1ff,#3a8bff)}
.flk-btn:disabled{opacity:.45;cursor:not-allowed}
.flk-forging{text-align:center;padding:24px 8px}
.flk-spin{width:34px;height:34px;margin:0 auto 14px;border:3px solid #243352;border-top-color:#48d1ff;
  border-radius:50%;animation:flkspin 1s linear infinite}
@keyframes flkspin{to{transform:rotate(360deg)}}
.flk-mine{outline:1px solid #48d1ff}
`;

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
    root.innerHTML = `
      <div class="flk-card">
        <div class="flk-h"><div class="flk-title">🐦 FLOCKED</div><div class="flk-code" data-code></div></div>
        <div class="flk-sub" data-sub>Creative — co-author the world, then race it together.</div>
        <div class="flk-label">Flock</div>
        <div class="flk-roster" data-roster></div>
        <div data-lobbybody>
          <div class="flk-label">Add to the world</div>
          <textarea class="flk-ta" data-prompt placeholder="e.g. a stormy pirate cove with narrow gaps"></textarea>
          <div class="flk-row">
            <button class="flk-btn sec" data-submit>Submit prompt</button>
            <button class="flk-btn pri" data-forge>Forge world</button>
          </div>
        </div>
        <div class="flk-forging" data-forging style="display:none">
          <div class="flk-spin"></div>
          <div>Forging your world…</div>
          <div class="flk-sub" style="margin-top:6px">Claude is fusing the flock's prompts.</div>
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

    this.btnSubmit.addEventListener('click', () => {
      const text = this.elPrompt.value.trim();
      if (!text) return;
      this.onSubmitPrompt?.(text);
      this._submitted = true;
      this.btnSubmit.textContent = 'Update prompt';
    });
    this.btnForge.addEventListener('click', () => this.onForge?.());
    // Don't let game key handlers steal typing.
    this.elPrompt.addEventListener('keydown', (e) => e.stopPropagation());
  }

  show() { this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; }

  setState({ roomCode, mode, state, isHost, roster }) {
    this.elCode.textContent = roomCode ? `room ${roomCode}` : '';
    const building = state === 'building';
    this.elBody.style.display = building ? 'none' : 'block';
    this.elForging.style.display = building ? 'block' : 'none';

    // roster chips
    this.elRoster.innerHTML = '';
    (roster || []).forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'flk-chip' + (p.me ? ' flk-mine' : '');
      const dot = document.createElement('span');
      dot.className = 'flk-dot';
      dot.style.background = PALETTE[(p.color ?? 0) % PALETTE.length];
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(p.name + (p.me ? ' (you)' : '')));
      this.elRoster.appendChild(chip);
    });

    this.btnForge.style.display = isHost ? 'block' : 'none';
    this.btnForge.disabled = !isHost;
    this.elSub.textContent = isHost
      ? 'Creative — submit prompts, then Forge the world for the flock.'
      : 'Creative — submit a prompt. The host forges the world.';
  }
}
