/**
 * GlbWorld — load a Sketchfab .glb as a playable FLOCKD map.
 *
 * Sketchfab models arrive at arbitrary scale/orientation, so we:
 *  - load (meshopt-decoded — the maps are compressed with gltf-transform/meshopt),
 *  - normalize: scale so the longest horizontal span = TARGET_SPAN, recenter on
 *    the origin, drop the floor to y=0,
 *  - add fill lighting (museum models are often unlit/dark),
 *  - expose groundHeight(x,z) via a downward raycast for flight physics,
 *  - expose a spawn point safely above the model.
 *
 * Maps are LAZY-loaded (only the selected one) — each is ~20-35MB.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const TARGET_SPAN = 1700; // longest horizontal dimension, in world units

/** Registry of the shipped maps. id → { file, label }. */
export const WORLDS = {
  sydney:         { file: 'sydney.glb',         label: 'Sydney Opera House' },
  niagara:        { file: 'niagara.glb',        label: 'Niagara Falls' },
  himeji:         { file: 'himeji.glb',         label: 'Himeji Castle · Japan' },
  christredeemer: { file: 'christredeemer.glb', label: 'Christ the Redeemer · Rio' },
  pantheon:       { file: 'pantheon.glb',       label: 'Pantheon · Rome' },
  riomaggiore:    { file: 'riomaggiore.glb',    label: 'Riomaggiore · Italy' },
  ducalpalace:    { file: 'ducalpalace.glb',    label: 'Ducal Palace · Urbino' },
  indy500:        { file: 'indy500.glb',        label: 'Indy 500 Speedway' },
};

export function worldUrl(id, base) {
  const w = WORLDS[id];
  if (!w) return null;
  return (base || (import.meta.env && import.meta.env.BASE_URL) || '/') + 'worlds/' + w.file;
}

/**
 * Load + normalize a GLB world and add it to the scene.
 * @returns {{ group, groundHeight:(x:number,z:number)=>number, spawn:{x,y,z}, bbox:THREE.Box3, dispose:()=>void }}
 */
export async function loadGlbWorld(scene, renderer, url, onProgress) {
  const loader = new GLTFLoader();
  try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (e) { /* decoder optional */ }

  const gltf = await loader.loadAsync(url, (e) => {
    if (onProgress && e.total) onProgress(e.loaded / e.total);
  });
  const model = gltf.scene;

  // --- normalize scale: longest horizontal span → TARGET_SPAN ---
  let box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); box.getSize(size);
  const span = Math.max(size.x, size.z) || 1;
  model.scale.setScalar(TARGET_SPAN / span);

  // --- recenter horizontally + floor at y=0 ---
  box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3(); box.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = true;
      o.castShadow = false;
      o.receiveShadow = false;
      // museum exports sometimes ship double-sided-needed geometry as single
      if (o.material && o.material.side === THREE.FrontSide) o.material.side = THREE.DoubleSide;
    }
  });
  scene.add(model);

  // --- fill lighting so the map reads even if unlit ---
  const lights = new THREE.Group();
  lights.name = 'glb-world-lights';
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2a2f3a, 1.15);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(0.6, 1.0, 0.35).multiplyScalar(TARGET_SPAN);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
  fill.position.set(-0.5, 0.6, -0.4).multiplyScalar(TARGET_SPAN);
  lights.add(hemi, key, fill);
  scene.add(lights);

  // --- ground = flat sea level (the model is floored at y=0) ---
  // Per-frame raycasting a 30MB mesh tanks the framerate, and a fly-around-the-
  // landmark game doesn't need mesh-accurate terrain following — the bird soars
  // above/around the monument. A flat floor is correct and free.
  box = new THREE.Box3().setFromObject(model);
  function groundHeight() { return 0; }

  const spawn = { x: 0, y: box.max.y + 220, z: Math.max(size.z * 0.0, TARGET_SPAN * 0.35) };

  function dispose() {
    scene.remove(model); scene.remove(lights);
    model.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
        else m?.dispose?.();
      }
    });
  }

  return { group: model, groundHeight, spawn, bbox: box, dispose };
}
