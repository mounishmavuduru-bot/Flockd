/**
 * ShotFX — renders the hunters' gunfire from `shot_event` rows.
 *
 * Each shot draws a bright tracer from the firing hunter to the target plus a
 * muzzle flash at the origin; a hit adds an impact flash at the target. All
 * additive, depth-write off, and short-lived so they read as snappy gunfire.
 * The accuracy + damage are decided server-side — this is purely the visual.
 */
import * as THREE from 'three';

export class ShotFX {
  constructor(scene) {
    this.scene = scene;
    this._group = new THREE.Group();
    this._group.name = 'shot-fx';
    scene.add(this._group);
    this.tracers = [];
    this.flashes = [];
  }

  /** @param o {x,y,z} origin (hunter)  @param t {x,y,z} target  @param hit bool */
  spawn(o, t, hit) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(o.x, o.y, o.z),
      new THREE.Vector3(t.x, t.y, t.z),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: hit ? 0xfff1a8 : 0xff6a3c,
      transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this._group.add(line);
    this.tracers.push({ line, mat, life: 0, ttl: 0.14 });

    this._flash(o, hit ? 0xffd27a : 0xffae70, 9, 26, 0.12);   // muzzle
    if (hit) this._flash(t, 0xff7048, 5, 24, 0.22);            // impact
  }

  _flash(p, color, s0, s1, ttl) {
    const mat = new THREE.SpriteMaterial({
      color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.set(p.x, p.y, p.z);
    spr.scale.setScalar(s0);
    this._group.add(spr);
    this.flashes.push({ mesh: spr, mat, life: 0, ttl, s0, s1 });
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life += dt;
      const k = tr.life / tr.ttl;
      tr.mat.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this._group.remove(tr.line);
        tr.line.geometry.dispose(); tr.mat.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life += dt;
      const k = f.life / f.ttl;
      f.mesh.scale.setScalar(f.s0 + (f.s1 - f.s0) * k);
      f.mat.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this._group.remove(f.mesh);
        f.mat.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  clear() {
    for (const tr of this.tracers) { this._group.remove(tr.line); tr.line.geometry.dispose(); tr.mat.dispose(); }
    for (const f of this.flashes) { this._group.remove(f.mesh); f.mat.dispose(); }
    this.tracers.length = 0;
    this.flashes.length = 0;
  }
}
