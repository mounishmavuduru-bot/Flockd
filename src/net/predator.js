/**
 * Renders the survival-mode hunt as a TRIO of Lobster Hunters flying off the
 * single synced `predator` row.
 *
 * One director brain drives one predator transform (position + yaw). We render
 * three hunter models in a yaw-aligned V around it: a lead and two wingmen.
 * Sabotage, collisions, and the radar all key off the center transform
 * (`getPosition()`), so this is purely how the hunt LOOKS — a client-only change
 * with no schema or sidecar work.
 *
 * The hunter is a meshopt-compressed GLB (gitignored → Vercel Blob in prod, local
 * public/ in dev). It loads once and is cloned per slot (shared geometry). The
 * model ships without animation; we apply a procedural bob until the rigged
 * flight animation arrives, at which point an AnimationMixer slots in here.
 *
 * The trio is hidden whenever there is no active predator row.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
const BLOB_LOBSTER = 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/lobster-6Meh5vaNzhoA6q3dpTAQKpeF5l28zO.glb';
function isProd() {
  return typeof location !== 'undefined' && !!location.hostname
    && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
}
function hunterUrl() { return isProd() ? BLOB_LOBSTER : (BASE + 'birds/lobster.glb'); }

const TARGET_SIZE = 46;   // tallest model dimension, in world units
const YAW_OFFSET = Math.PI; // flip if the model faces away from travel (model-dependent)
const EMISSIVE = new THREE.Color(0x551014); // faint menace glow on top of its own texture

// Formation slots in (right, up, forward) units relative to the flight heading.
// Lead sits slightly ahead; the two wingmen trail and flank. Bob phases differ
// so the three don't beat in lockstep.
const SLOTS = [
  { right: 0, up: 0, fwd: 26, scale: 1.0, bob: 0.0 },     // lead
  { right: -40, up: -6, fwd: -22, scale: 0.85, bob: 0.33 }, // left wing
  { right: 40, up: 6, fwd: -22, scale: 0.85, bob: 0.66 },   // right wing
];

export class Predator {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this._pos = new THREE.Vector3(0, 80, 0);
    this._yaw = Math.PI;
    this._initialized = false;
    this._visible = false;
    this._loaded = false;

    this._fwd = new THREE.Vector3(0, 0, -1);
    this._right = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);

    this.slots = SLOTS.map((slot) => ({ slot, obj: null, recoil: 0 }));
    this._loadHunter();
  }

  /** Kick a recoil impulse on one hunter slot (0..2) — called when it fires. */
  fire(slotIdx) {
    const h = this.slots[slotIdx % this.slots.length];
    if (h) h.recoil = 1;
  }

  _loadHunter() {
    const loader = new GLTFLoader();
    try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (e) { /* decoder optional */ }
    loader.load(hunterUrl(), (gltf) => {
      const src = gltf.scene;
      src.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = true;
          o.castShadow = false;
          o.receiveShadow = false;
          if (o.material) {
            o.material = o.material.clone();
            if (o.material.emissive) {
              o.material.emissive.copy(EMISSIVE);
              if (o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 0.45;
            }
            o.material.needsUpdate = true;
          }
        }
      });

      // Normalize: scale tallest dim → TARGET_SIZE, recenter the bbox on the origin
      // so the formation offsets place each hunter cleanly.
      const box = new THREE.Box3().setFromObject(src);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = TARGET_SIZE / maxDim;
      src.scale.setScalar(scale);
      src.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

      const template = new THREE.Group();
      template.add(src);

      for (let i = 0; i < this.slots.length; i++) {
        const obj = (i === 0) ? template : template.clone(true);
        obj.scale.multiplyScalar(this.slots[i].slot.scale);
        this.group.add(obj);
        this.slots[i].obj = obj;
      }
      this._loaded = true;
      this.group.visible = this._visible;
    }, undefined, (err) => console.warn('[predator] lobster hunter load failed', err));
  }

  _setVisible(v) {
    if (this._visible === v) return;
    this._visible = v;
    this.group.visible = v;
  }

  /**
   * Reconcile the trio against the latest predator row.
   * @param {object|null} row  the synced predator row for my room (or null/inactive)
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  reconcile(row, dt, camera) {
    if (!row || !row.active) {
      this._setVisible(false);
      return;
    }
    this._setVisible(true);
    if (!this._loaded) return;

    const targetPos = new THREE.Vector3(row.x, row.y, row.z);
    const targetYaw = row.yaw;

    if (!this._initialized) {
      this._pos.copy(targetPos);
      this._yaw = targetYaw;
      this._initialized = true;
    }

    const rate = 1 - Math.exp(-5.0 * dt);
    this._pos.lerp(targetPos, rate);

    let dyaw = targetYaw - this._yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    this._yaw += dyaw * rate;

    this._fwd.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw)).normalize();
    this._right.set(Math.cos(this._yaw), 0, -Math.sin(this._yaw)).normalize();

    const tNow = performance.now() / 1000;
    for (const h of this.slots) {
      if (!h.obj) continue;
      if (h.recoil > 0) h.recoil = Math.max(0, h.recoil - dt * 5.0); // ~0.2s kick
      h.obj.position.copy(this._pos)
        .addScaledVector(this._right, h.slot.right)
        .addScaledVector(this._up, h.slot.up)
        .addScaledVector(this._fwd, h.slot.fwd)
        .addScaledVector(this._fwd, -h.recoil * 14);        // recoil kicks it backward
      // Procedural bob (no rig yet) + slight bank so the trio reads as alive.
      h.obj.position.y += Math.sin((tNow + h.slot.bob) * 3.0) * 3.0;
      h.obj.rotation.set(
        Math.sin((tNow + h.slot.bob) * 2.0) * 0.06 - h.recoil * 0.25, // pitch waver + muzzle climb
        this._yaw + YAW_OFFSET,
        Math.sin((tNow + h.slot.bob) * 2.5) * 0.10,         // gentle roll/bank
      );
    }
  }

  /** Smoothed world position of the hunt center (THREE.Vector3). */
  getPosition() {
    return this._pos;
  }

  dispose() {
    if (this.group) this.scene.remove(this.group);
    this.group?.traverse?.((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
        else m?.dispose?.();
      }
    });
  }
}
