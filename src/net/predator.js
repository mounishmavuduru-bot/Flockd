/**
 * Renders the survival-mode predator hawk from the synced `predator` row.
 *
 * Reuses the same BirdModel the players use, but scaled up ~1.8x and tinted
 * dark/red so it reads as menacing. Position + yaw are interpolated with the
 * same exponential smoothing approach RemoteBirds uses, so the predator glides
 * between the sidecar's ~6 Hz steering snapshots → smooth at 60 fps.
 *
 * The predator is hidden whenever there is no active predator row (e.g. the
 * room hasn't spawned one yet, or it's been despawned / marked inactive).
 */
import * as THREE from 'three';
import { BirdModel } from '../flight/BirdModel.js';
import { FLIGHT_MODE } from '../constants.js';

const PREDATOR_SCALE = 1.8;
const TINT = new THREE.Color(0x1a0608);   // near-black body
const EMISSIVE = new THREE.Color(0xb01818); // angry red glow

export class Predator {
  constructor(scene) {
    this.scene = scene;
    this.model = new BirdModel(scene);
    this._tinted = false;
    this._scaled = false;
    this._visible = false;

    // Smoothed position + yaw (exp lerp, mirrors RemoteBirds / BirdModel).
    this._pos = new THREE.Vector3(0, 80, 0);
    this._yaw = Math.PI;
    this._initialized = false;

    // Proxy "flight state" consumed by BirdModel.update (same shape RemoteBird uses).
    this.state = {
      position: this._pos,
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

  /** Scale the loaded model up + apply a dark/red material tint (clone, like remoteBirds). */
  _applyLook() {
    if (!this.model._loaded || !this.model._model) return;
    if (!this._scaled) {
      this.model._model.scale.multiplyScalar(PREDATOR_SCALE);
      this._scaled = true;
    }
    if (this._tinted) return;
    this.model._model.traverse((child) => {
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
    this._tinted = true;
  }

  _setVisible(v) {
    if (this._visible === v) return;
    this._visible = v;
    if (this.model._model) this.model._model.visible = v;
  }

  /**
   * Reconcile against the latest predator row.
   * @param {object|null} row  the synced predator row for my room (or null/inactive)
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  reconcile(row, dt, camera) {
    this._applyLook();

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

    // Exponential smoothing (same form as BirdModel/RemoteBirds: 1 - e^(-k·dt)).
    const rate = 1 - Math.exp(-5.0 * dt);
    this._pos.lerp(targetPos, rate);

    // Shortest-arc yaw interpolation.
    let dyaw = targetYaw - this._yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    this._yaw += dyaw * rate;

    const s = this.state;
    s.yaw = this._yaw;
    s.speed = row.speed;
    s.forward.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw)).normalize();
    // Always flap hard so it reads as an active, beating-winged hunter.
    s.flapPhase = 1; s.wingSpread = 1;

    this.model.update(s, dt, camera);
  }

  /** Smoothed world position of the predator (THREE.Vector3). */
  getPosition() {
    return this._pos;
  }

  dispose() {
    if (this.model && this.model._model) this.scene.remove(this.model._model);
    if (this.model && this.model._mixer) this.model._mixer.stopAllAction?.();
  }
}
