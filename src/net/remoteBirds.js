/**
 * Renders other players' storks from synced `player` rows.
 *
 * Each remote player gets its own BirdModel (loads its own Stork.glb + mixer).
 * We feed BirdModel.update() a lightweight proxy "flight state" reconstructed
 * from the synced transform — reusing the exact orientation/animation logic the
 * local bird uses, so remote birds look identical. BirdModel already smooths
 * position (exp lerp) and orientation (quaternion slerp), which conveniently
 * interpolates between our ~12 Hz network snapshots → buttery at 60 fps.
 */
import * as THREE from 'three';
import { BirdModel } from '../flight/BirdModel.js';
import { FLIGHT_MODE } from '../constants.js';

// Per-player tint palette (matches server-assigned color index).
const PALETTE = [
  0xff5a5f, 0x3fa7ff, 0x5ad469, 0xffd23f,
  0xb06bff, 0xff8c42, 0x2ec4b6, 0xf15bb5,
];

class RemoteBird {
  constructor(scene, colorIdx) {
    this.scene = scene;
    this.colorIdx = colorIdx;
    this.model = new BirdModel(scene);
    this._tinted = false;

    // Proxy state consumed by BirdModel.update (mirrors FlightState fields it reads).
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
  }

  /** Apply the latest synced row to the proxy state. */
  setRow(row) {
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

  /** Tint the model once it's finished loading (GLB load is async). */
  _applyTint() {
    if (this._tinted || !this.model._loaded || !this.model._model) return;
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

  update(dt, camera) {
    this._applyTint();
    this.model.update(this.state, dt, camera);
  }

  dispose() {
    if (this.model && this.model._model) this.scene.remove(this.model._model);
    if (this.model && this.model._mixer) this.model._mixer.stopAllAction?.();
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
        bird = new RemoteBird(this.scene, row.color);
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
