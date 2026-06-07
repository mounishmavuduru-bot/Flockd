/**
 * Renders the survival-mode hunt as a TRIO of hunters flying off the single
 * synced `predator` row.
 *
 * One director brain drives one predator transform (position + yaw). We render
 * three hunter models in a yaw-aligned V around that transform: a lead and two
 * wingmen. They share the brain — sabotage, collisions, and the radar all key
 * off the center transform (`getPosition()`), so this is purely how the hunt
 * LOOKS, not how it decides. That keeps the trio a client-only change with no
 * schema or sidecar work.
 *
 * Each hunter reuses the player BirdModel scaled up and tinted dark/red. To drop
 * in real hunter art later, give each formation slot its own GLB: load it in the
 * constructor instead of `new BirdModel(scene)` and keep the per-slot state.
 *
 * The trio is hidden whenever there is no active predator row.
 */
import * as THREE from 'three';
import { BirdModel } from '../flight/BirdModel.js';
import { FLIGHT_MODE } from '../constants.js';

const PREDATOR_SCALE = 1.8;
const TINT = new THREE.Color(0x1a0608);     // near-black body
const EMISSIVE = new THREE.Color(0xb01818); // angry red glow

// Formation slots in (right, up, forward) units relative to the flight heading.
// Lead sits slightly ahead; the two wingmen trail and flank. Flap phases are
// offset so the three don't beat in lockstep.
const SLOTS = [
  { right: 0, up: 0, fwd: 24, scale: 1.0, flap: 0.0 },    // lead
  { right: -34, up: -5, fwd: -20, scale: 0.9, flap: 0.33 }, // left wing
  { right: 34, up: 5, fwd: -20, scale: 0.9, flap: 0.66 },   // right wing
];

export class Predator {
  constructor(scene) {
    this.scene = scene;

    // Smoothed center transform (exp lerp, mirrors RemoteBirds / BirdModel).
    this._pos = new THREE.Vector3(0, 80, 0);
    this._yaw = Math.PI;
    this._initialized = false;
    this._visible = false;

    // Reusable basis vectors (rebuilt from yaw each frame).
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._right = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);

    // One hunter per slot, each with its own model + proxy flight state.
    this.hunters = SLOTS.map((slot) => ({
      slot,
      model: new BirdModel(scene),
      scaled: false,
      tinted: false,
      state: {
        position: new THREE.Vector3(0, 80, 0),
        forward: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0),
        yaw: Math.PI, pitch: 0, roll: 0,
        speed: 0,
        mode: FLIGHT_MODE.FLYING,
        flapPhase: 0,
        wingSpread: 1,
        landingTimer: 0,
      },
    }));
  }

  /** Scale up + apply the dark/red tint to a hunter's loaded model (once). */
  _applyLook(h) {
    if (!h.model._loaded || !h.model._model) return;
    if (!h.scaled) {
      h.model._model.scale.multiplyScalar(PREDATOR_SCALE * h.slot.scale);
      h.scaled = true;
    }
    if (h.tinted) return;
    h.model._model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        if (child.material.color) child.material.color.copy(TINT);
        if (child.material.emissive) {
          child.material.emissive.copy(EMISSIVE);
          if (child.material.emissiveIntensity !== undefined) child.material.emissiveIntensity = 0.6;
        }
        child.material.needsUpdate = true;
      }
    });
    h.tinted = true;
  }

  _setVisible(v) {
    if (this._visible === v) return;
    this._visible = v;
    for (const h of this.hunters) if (h.model._model) h.model._model.visible = v;
  }

  /**
   * Reconcile the trio against the latest predator row.
   * @param {object|null} row  the synced predator row for my room (or null/inactive)
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  reconcile(row, dt, camera) {
    for (const h of this.hunters) this._applyLook(h);

    if (!row || !row.active) {
      this._setVisible(false);
      return;
    }
    this._setVisible(true);

    const targetPos = new THREE.Vector3(row.x, row.y, row.z);
    const targetYaw = row.yaw;

    if (!this._initialized) {
      this._pos.copy(targetPos);
      this._yaw = targetYaw;
      this._initialized = true;
    }

    // Exponential smoothing of the center (same form as BirdModel/RemoteBirds).
    const rate = 1 - Math.exp(-5.0 * dt);
    this._pos.lerp(targetPos, rate);

    let dyaw = targetYaw - this._yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    this._yaw += dyaw * rate;

    // Rebuild the heading basis once for the whole formation.
    this._fwd.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw)).normalize();
    this._right.set(Math.cos(this._yaw), 0, -Math.sin(this._yaw)).normalize();

    const tNow = performance.now() / 1000;
    for (const h of this.hunters) {
      const s = h.state;
      // World position = center + right*r + up*u + forward*f.
      s.position.copy(this._pos)
        .addScaledVector(this._right, h.slot.right)
        .addScaledVector(this._up, h.slot.up)
        .addScaledVector(this._fwd, h.slot.fwd);
      s.yaw = this._yaw;
      s.speed = row.speed;
      s.forward.copy(this._fwd);
      s.right.copy(this._right);
      // Beating wings, slightly out of phase per slot so the trio looks alive.
      s.flapPhase = 1;
      s.wingSpread = 0.92 + 0.08 * Math.sin((tNow + h.slot.flap) * 6.0);
      h.model.update(s, dt, camera);
    }
  }

  /** Smoothed world position of the hunt center (THREE.Vector3). */
  getPosition() {
    return this._pos;
  }

  dispose() {
    for (const h of this.hunters) {
      if (h.model && h.model._model) this.scene.remove(h.model._model);
      if (h.model && h.model._mixer) h.model._mixer.stopAllAction?.();
    }
  }
}
