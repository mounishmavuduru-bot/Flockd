/**
 * Renders other players' birds from synced `player` rows.
 *
 * Each remote player picks a renderer from its synced `skin` field:
 *   - skin 'stork' (or empty)  → the original tinted BirdModel (loads its own
 *                                 Stork.glb + mixer), colored by the palette.
 *   - any other skin id        → an AvatarBird (loadAvatar) — the same 3-tier
 *                                 GLB avatar the local player uses — driven by
 *                                 the synced transform every frame.
 *
 * Both renderers consume a lightweight proxy "flight state" reconstructed from
 * the synced transform, so remote birds move with the exact orientation logic
 * the local bird uses. BirdModel smooths pos/orientation (exp lerp + slerp),
 * conveniently interpolating our ~12 Hz snapshots; AvatarBird snaps each frame
 * but the network cadence keeps it smooth enough for chase-cam viewing.
 */
import * as THREE from 'three';
import { BirdModel } from '../flight/BirdModel.js';
import { loadAvatar } from '../flight/AvatarBird.js';
import { FLIGHT_MODE } from '../constants.js';

// Per-player tint palette (matches server-assigned color index).
const PALETTE = [
  0xff5a5f, 0x3fa7ff, 0x5ad469, 0xffd23f,
  0xb06bff, 0xff8c42, 0x2ec4b6, 0xf15bb5,
];

/** Treat empty / missing / 'stork' as the default tinted-Stork path. */
function isStork(skin) { return !skin || skin === 'stork'; }

class RemoteBird {
  constructor(scene, colorIdx, skin) {
    this.scene = scene;
    this.colorIdx = colorIdx;
    this.skin = skin || 'stork';
    this._tinted = false;

    // Renderer: either a BirdModel (stork) or an AvatarBird wrapper (other skins).
    this.model = null;     // BirdModel instance (stork path)
    this.avatar = null;    // { object3D, update, setVisible, dispose, tier } (avatar path)
    this._avatarLoading = false;

    // Proxy state consumed by the renderer (mirrors FlightState fields it reads).
    this.state = {
      position: new THREE.Vector3(0, 60, 0),
      forward: new THREE.Vector3(0, 0, -1),
      up: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      yaw: Math.PI, pitch: 0, roll: 0,
      speed: 0,
      mode: FLIGHT_MODE.FLYING,
      flapPhase: 0,
      wingSpread: 1,
      landingTimer: 0,
    };

    this._initRenderer();
  }

  /** Create the renderer matching this.skin. */
  _initRenderer() {
    if (isStork(this.skin)) {
      this.model = new BirdModel(this.scene);
      return;
    }
    // Avatar skins load asynchronously; until ready, nothing renders (no flicker).
    // A load token guards against a skin change (or dispose) mid-load: when the
    // promise resolves we drop the result if it's no longer the current load.
    this._avatarLoading = true;
    const token = (this._loadToken = (this._loadToken || 0) + 1);
    const wantSkin = this.skin;
    loadAvatar(this.scene, wantSkin).then((av) => {
      if (this._disposed || token !== this._loadToken) { av.dispose?.(); return; }
      this._avatarLoading = false;
      this.avatar = av;
      this._applyAvatarTint();
    }).catch((e) => {
      if (token === this._loadToken) this._avatarLoading = false;
      console.warn('[remoteBirds] avatar load failed for skin', wantSkin, e);
    });
  }

  /**
   * Swap the renderer when a player's synced skin changes mid-session
   * (e.g. they re-pick in the locker). Disposes the old one cleanly.
   */
  _setSkin(skin) {
    const next = skin || 'stork';
    if (next === this.skin) return;
    this.skin = next;
    // Tear down whichever renderer is active.
    if (this.model) {
      if (this.model._model) this.scene.remove(this.model._model);
      this.model._mixer?.stopAllAction?.();
      this.model = null;
    }
    if (this.avatar) { this.avatar.dispose?.(); this.avatar = null; }
    this._tinted = false;
    this._initRenderer();
  }

  /** Apply the latest synced row to the proxy state. */
  setRow(row) {
    if ((row.skin || 'stork') !== this.skin) this._setSkin(row.skin);

    const s = this.state;
    s.position.set(row.x, row.y, row.z);
    s.yaw = row.yaw;
    s.pitch = row.pitch;
    s.roll = row.roll;
    s.speed = row.speed;

    // Forward vector from yaw/pitch — same formula as FlightState.updateVectors().
    s.forward.set(
      -Math.sin(s.yaw) * Math.cos(s.pitch),
      Math.sin(s.pitch),
      -Math.cos(s.yaw) * Math.cos(s.pitch),
    ).normalize();

    // Cheap wing-animation heuristic so remote birds don't look frozen:
    // climbing or slow → flap; steep dive → tuck; otherwise glide.
    if (s.pitch > 0.05 || s.speed < 12) {
      s.flapPhase = 1; s.wingSpread = 1;
    } else if (s.pitch < -0.15) {
      s.flapPhase = 0; s.wingSpread = 0.2;
    } else {
      s.flapPhase = 0; s.wingSpread = 1;
    }
  }

  /** Tint the Stork model once it's finished loading (GLB load is async). */
  _applyTint() {
    if (this._tinted || !this.model || !this.model._loaded || !this.model._model) return;
    const color = new THREE.Color(PALETTE[this.colorIdx % PALETTE.length]);
    this.model._model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        if (child.material.color) child.material.color.copy(color);
        child.material.needsUpdate = true;
      }
    });
    this._tinted = true;
  }

  /** Tint the avatar GLB by the player's palette color (best-effort). */
  _applyAvatarTint() {
    if (this._tinted || !this.avatar || !this.avatar.object3D) return;
    const color = new THREE.Color(PALETTE[this.colorIdx % PALETTE.length]);
    this.avatar.object3D.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        child.material = mats.map((m) => {
          const c = m.clone();
          // Multiply toward the palette color so textured skins keep their detail
          // but read as "this player's" bird. Solid-color skins just take the tint.
          if (c.color) c.color.lerp(color, 0.6);
          c.needsUpdate = true;
          return c;
        });
        if (!Array.isArray(child.material)) child.material = child.material[0];
      }
    });
    this._tinted = true;
  }

  update(dt, camera) {
    if (this.model) {
      // Stork path — unchanged behavior.
      this._applyTint();
      this.model.update(this.state, dt, camera);
    } else if (this.avatar) {
      // Avatar path — drive the wrapper from the synced transform.
      // flapStrength comes from the same flap heuristic setRow() computed.
      const flap = this.state.flapPhase > 0 ? 1 : 0;
      this.avatar.update(this.state, dt, camera, flap);
    }
    // else: avatar still loading → render nothing this frame.
  }

  dispose() {
    this._disposed = true;
    if (this.model) {
      if (this.model._model) this.scene.remove(this.model._model);
      this.model._mixer?.stopAllAction?.();
    }
    if (this.avatar) this.avatar.dispose?.();
  }
}

export class RemoteBirds {
  constructor(scene) {
    this.scene = scene;
    this.birds = new Map(); // identityHex -> RemoteBird
  }

  /**
   * Sync the set of visible remote birds to `rows` (player rows in my room,
   * excluding me), then advance their animation.
   * @param {Array} rows
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  reconcile(rows, dt, camera) {
    const seen = new Set();
    for (const row of rows) {
      const key = row.identity.toHexString();
      seen.add(key);
      let bird = this.birds.get(key);
      if (!bird) {
        bird = new RemoteBird(this.scene, row.color, row.skin);
        this.birds.set(key, bird);
      }
      bird.setRow(row);
    }
    // Remove birds that left the room / disconnected.
    for (const [key, bird] of this.birds) {
      if (!seen.has(key)) {
        bird.dispose();
        this.birds.delete(key);
      }
    }
    // Advance all remaining.
    for (const bird of this.birds.values()) bird.update(dt, camera);
  }

  count() { return this.birds.size; }

  clear() {
    for (const bird of this.birds.values()) bird.dispose();
    this.birds.clear();
  }
}
