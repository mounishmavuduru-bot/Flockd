/**
 * Applies a synced world_config (from the AI sidecar) to the live Three.js scene:
 *  - recolors sky / fog / water from the generated palette
 *  - spawns the ring course players race through
 *
 * Kept deliberately decoupled from birdybird's RingRush so multiplayer worlds
 * don't fight the single-player mode's spawner.
 */
import * as THREE from 'three';

export function applyPalette(scene, cfg) {
  try {
    if (cfg.fogColor && scene.fog && scene.fog.color) scene.fog.color.set(cfg.fogColor);
    if (cfg.skyColor && scene.background && scene.background.isColor) scene.background.set(cfg.skyColor);
  } catch (e) { /* non-fatal */ }
}

const RING_PASS_RADIUS = 16;

export class RingCourse {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.rings = [];
    this.index = 0;
    this.finished = false;
    this._passedMat = new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.45 });
  }

  build(cfg) {
    this.dispose();
    this.index = 0;
    this.finished = false;

    const group = new THREE.Group();
    group.name = 'flocked-course';
    const ringColor = new THREE.Color(cfg.skyColor || '#ffffff').offsetHSL(0, 0.1, 0.25);
    const baseMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.92 });
    const geo = new THREE.TorusGeometry(12, 1.6, 10, 32);

    const list = Array.isArray(cfg.rings) ? cfg.rings : [];
    list.forEach((r, i) => {
      const mesh = new THREE.Mesh(geo, baseMat.clone());
      mesh.position.set(r.x, r.y, r.z);
      const next = list[i + 1];
      if (next) mesh.lookAt(next.x, next.y, next.z);
      group.add(mesh);
      this.rings.push(mesh);
    });

    this.scene.add(group);
    this.group = group;
  }

  /**
   * Sequential ring-pass detection.
   * @returns {{justFinished:boolean, index:number, total:number}}
   */
  update(pos) {
    const total = this.rings.length;
    if (this.finished || this.index >= total) return { justFinished: false, index: this.index, total };
    const ring = this.rings[this.index];
    if (pos.distanceTo(ring.position) < RING_PASS_RADIUS) {
      ring.material = this._passedMat;
      this.index++;
      if (this.index >= total) {
        this.finished = true;
        return { justFinished: true, index: this.index, total };
      }
    }
    return { justFinished: false, index: this.index, total };
  }

  /** Direction hint to the next ring (for a future HUD arrow). */
  nextRingPosition() {
    return this.index < this.rings.length ? this.rings[this.index].position : null;
  }

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
      this.group = null;
    }
    this.rings = [];
  }
}
