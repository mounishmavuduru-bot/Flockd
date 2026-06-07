/**
 * SabotageFX — applies survival-mode `sabotage_event` rows to the local client.
 *
 * The server inserts a sabotage_event row (an EVENT table) when the Claude
 * director fires a sabotage. NetClient registers an onInsert callback and forwards
 * each row here via handleEvent(). We only act on / show sabotages aimed at ME:
 *  - wingclip / headwind / scatter → timed FlightPhysics debuff (applyDebuff)
 *  - fog                           → thicken scene.fog locally for the duration
 *                                    (restored in update() once it expires)
 * Either way we surface a small auto-fading toast with the director's `reason`.
 * All DOM text is written via textContent → XSS-safe even though `reason` is
 * Claude-authored and synced from the server.
 */
import * as THREE from 'three';

const CSS = `
.flk-sab-wrap{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:60;
  display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;
  font-family:system-ui,-apple-system,sans-serif}
.flk-sab{max-width:min(420px,86vw);background:rgba(28,6,8,.92);border:1px solid #7a1d22;
  border-left:4px solid #ff3b3b;border-radius:10px;padding:9px 14px;color:#ffe6e6;
  font-size:13px;font-weight:600;line-height:1.35;box-shadow:0 10px 28px rgba(0,0,0,.55);
  opacity:0;transform:translateY(8px);transition:opacity .22s ease,transform .22s ease}
.flk-sab.in{opacity:1;transform:translateY(0)}
.flk-sab b{display:block;font-size:11px;letter-spacing:1px;text-transform:uppercase;
  color:#ff6b6b;margin-bottom:2px}
`;

const TOAST_MS = 3600;

export class SabotageFX {
  /**
   * @param {THREE.Scene} scene
   * @param {() => (import('../flight/FlightPhysics.js').FlightPhysics|null)} getFlightPhysics
   */
  constructor(scene, getFlightPhysics) {
    this.scene = scene;
    this.getFlightPhysics = getFlightPhysics;

    // Local fog override bookkeeping (for kind === 'fog').
    this._fog = null;            // { prevNear, prevFar, prevDensity, expiry } or null

    this._buildDom();
  }

  _buildDom() {
    if (typeof document === 'undefined') { this.wrap = null; return; }
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'flk-sab-wrap';
    document.body.appendChild(wrap);
    this.wrap = wrap;
  }

  /**
   * Handle one sabotage_event row. Only sabotages targeting ME do anything.
   * @param {object} row             a sabotage_event row
   * @param {string} myIdentityHex   my identity hex string
   */
  handleEvent(row, myIdentityHex) {
    if (!row || !row.target) return;
    let targetHex;
    try { targetHex = row.target.toHexString(); } catch { return; }
    if (!myIdentityHex || targetHex !== myIdentityHex) return; // not mine → ignore

    const kind = String(row.kind || '');
    const magnitude = Number(row.magnitude) || 0;
    const durationMs = Number(row.durationMs) || 0;

    if (kind === 'fog') {
      this._applyFog(magnitude, durationMs);
    } else {
      const fp = this.getFlightPhysics ? this.getFlightPhysics() : null;
      if (fp && typeof fp.applyDebuff === 'function') {
        fp.applyDebuff(kind, magnitude, durationMs);
      }
    }

    this._toast(kind, String(row.reason || ''));
  }

  _applyFog(magnitude, durationMs) {
    const fog = this.scene && this.scene.fog;
    if (!fog) return;
    const mag = Math.max(0, Math.min(1, magnitude));
    const expiry = performance.now() + Math.max(0, durationMs);

    // Capture the originals once (so overlapping fog events still restore cleanly).
    if (!this._fog) {
      this._fog = {
        prevNear: fog.near,
        prevFar: fog.far,
        prevDensity: fog.density,
        expiry,
      };
    } else {
      this._fog.expiry = Math.max(this._fog.expiry, expiry);
    }

    // Thicken: exponential fog → raise density; linear fog → pull the far plane in.
    if (typeof fog.density === 'number') {
      fog.density = this._fog.prevDensity * (1 + 6 * mag);
    } else if (typeof fog.far === 'number') {
      const near = this._fog.prevNear ?? 1;
      fog.far = near + (this._fog.prevFar - near) * (1 - 0.7 * mag);
    }
  }

  _restoreFog() {
    const fog = this.scene && this.scene.fog;
    if (fog && this._fog) {
      if (typeof fog.density === 'number') fog.density = this._fog.prevDensity;
      if (typeof fog.far === 'number') fog.far = this._fog.prevFar;
      if (typeof fog.near === 'number') fog.near = this._fog.prevNear;
    }
    this._fog = null;
  }

  /** Auto-fading toast. Text via textContent only → XSS-safe. */
  _toast(kind, reason) {
    if (!this.wrap) return;
    const el = document.createElement('div');
    el.className = 'flk-sab';

    const label = document.createElement('b');
    label.textContent = kind ? `Sabotage · ${kind}` : 'Sabotage';
    el.appendChild(label);
    el.appendChild(document.createTextNode(reason || 'The hunt strikes.'));

    this.wrap.appendChild(el);
    // next frame → trigger the CSS transition
    requestAnimationFrame(() => el.classList.add('in'));

    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, TOAST_MS);
  }

  /** Per-frame: restore local fog once the thickening window expires. */
  update(dt) {
    if (this._fog && performance.now() >= this._fog.expiry) {
      this._restoreFog();
    }
  }
}
