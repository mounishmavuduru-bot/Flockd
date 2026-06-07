/**
 * AvatarBird — the 3-tier flight-animated avatar loader, used for BOTH the local
 * player's bird and every remote bird. One wrapper conforms ANY .glb to the game's
 * Stork-equivalent size + orientation + a believable wing-beat.
 *
 * Why 3 tiers (see docs/BIRD_ANIMATION.md): the avatars come from many different
 * Sketchfab rigs. Retargeting one shared clip onto all of them is unreliable, so we
 * pick the best available motion per model at load time:
 *
 *   Tier 1 — embedded clip: gltf has animations → AnimationMixer, play a fly/flap/
 *            idle clip (else clip 0), advance speed scaled by flapStrength.
 *   Tier 2 — procedural wing-bone flap: no clips but the model has bones
 *            (SkinnedMesh) → find wing bones by name and oscillate their local
 *            rotation with a sine wave whose amplitude+frequency rise with flap.
 *   Tier 3 — whole-model pseudo-flight: static mesh → no wing motion, a gentle body
 *            bob (y sine) that pulses on flap + a slight nose-up pitch on flap. Bank/
 *            pitch come from the orientation we set every frame (same as the Stork).
 *
 * Normalization (all tiers): scale so the model's largest dimension ≈ the Stork's
 * in-game largest dimension (~7.5 world units — Stork.glb raw ~196u × scale 0.04),
 * recenter on the body, and orient the nose to FORWARD = -Z (the game's forward;
 * FlightState.forward = (-sin yaw·cos pitch, sin pitch, -cos yaw·cos pitch)). Some
 * birds face +X or +Z, so we rotate so the long (beak→tail) horizontal axis runs
 * along Z with the nose pointing -Z. A per-skin yawOffset can override if needed.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FLIGHT_MODE } from '../constants.js';

// Target largest dimension in world units — matches the Stork (Stork.glb longest
// raw span ~196.8u × its in-game scale 0.04 ≈ 7.87u). We aim a touch under so no
// avatar reads bigger than the reference bird.
const TARGET_SIZE = 7.5;

/**
 * Avatar registry. id → { file, label, yawOffset? }.
 *   file: null  → the built-in Stork (handled by the existing BirdModel; the
 *                 locker still lists it, but loadAvatar('stork') falls through to a
 *                 generic load of models/Stork.glb so callers that ONLY use
 *                 AvatarBird get a working stork too).
 *   yawOffset:   extra Y rotation (radians) applied AFTER auto-orientation, for the
 *                rare model whose nose can't be inferred from its bounding box.
 */
export const BIRDS = {
  stork:     { file: null,            label: 'Stork' },
  celestial: { file: 'celestial.glb', label: 'Celestial' },
  phoenix:   { file: 'phoenix.glb',   label: 'Phoenix' },
  cardinal:  { file: 'cardinal.glb',  label: 'Cardinal' },
  pigeon:    { file: 'pigeon.glb',    label: 'Pigeon' },
  grey:      { file: 'grey.glb',      label: 'Fledgling' },
  bird:      { file: 'bird.glb',      label: 'Heron' },
};

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
// Heavy bird GLBs are gitignored → Vercel Blob (random-suffixed CDN URLs) in prod,
// local public dir in dev. Stork is small + committed → loads locally everywhere.
const BLOB_BIRDS = {
  celestial: 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/celestial-gImKfHh8eK4b4ve4GFiHKBpjlZ168W.glb',
  phoenix: 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/phoenix-yJ1iOL36b2GZmZe2Bbt4R4mX5MHnDo.glb',
  cardinal: 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/cardinal-XOyJjeoJtmRDqFvdhDgwOSFVRPuSM2.glb',
  pigeon: 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/pigeon-Po9AUwLVvBVojQGrENfAHdDEtm1M6S.glb',
  grey: 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/grey-gIqFXzoQTxPN0ZfqV0CCO4bDmOneeu.glb',
  bird: 'https://xsnfwnaeoex0fdre.public.blob.vercel-storage.com/birds/bird-oEuQnohEJugezW6wkOBoiey3yMdvqK.glb',
};
function isProd() {
  return typeof location !== 'undefined' && !!location.hostname
    && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
}

/** Resolve a skin id to its hosted .glb url (null for the built-in stork file path). */
function avatarUrl(skinId) {
  const entry = BIRDS[skinId] || BIRDS.stork;
  // Stork ships under models/ (committed) — load locally everywhere.
  if (!entry.file) return BASE + 'models/Stork.glb';
  if (isProd() && BLOB_BIRDS[skinId]) return BLOB_BIRDS[skinId];
  return BASE + 'birds/' + entry.file;
}

const WING_BONE_RE = /wing|arm|feather|pinion|hand|l_?up|r_?up|left|right/i;

/**
 * Load + normalize an avatar and add it to the scene. Robust: on any failure it
 * returns a tiny fallback box wrapper with the SAME api, so nothing crashes.
 *
 * @param {THREE.Scene} scene
 * @param {string} skinId  one of BIRDS' keys (unknown ids fall back to 'stork')
 * @returns {Promise<{
 *   object3D: THREE.Object3D,
 *   update(flightState:object, dt:number, camera?:THREE.Camera, flapStrength?:number):void,
 *   setVisible(b:boolean):void,
 *   dispose():void
 * }>}
 */
export async function loadAvatar(scene, skinId) {
  const entry = BIRDS[skinId] ? skinId : 'stork';
  const url = avatarUrl(entry);
  const yawOffset = (BIRDS[entry] && BIRDS[entry].yawOffset) || 0;

  try {
    const loader = new GLTFLoader();
    // Bird GLBs may be meshopt-compressed (celestial is); decoder is harmless otherwise.
    try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (e) { /* decoder optional */ }

    const gltf = await loader.loadAsync(url);
    const model = gltf.scene || gltf.scenes?.[0];
    if (!model) throw new Error('glb has no scene');
    model.name = 'avatar-' + entry;

    // --- material hygiene (mirror BirdModel/GlbWorld): drop env maps, smooth shade,
    //     two-side single-sided exports so thin wings don't vanish edge-on. ---
    let hasSkin = false;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false; // a few-unit bird near the camera shouldn't pop out
        if (o.isSkinnedMesh) hasSkin = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          m.envMap = null;
          if (m.metalness !== undefined) m.metalness = 0;
          if (m.side === THREE.FrontSide) m.side = THREE.DoubleSide;
          m.needsUpdate = true;
        }
      }
    });

    // --- normalize: scale so largest dim ≈ TARGET_SIZE, recenter on the body ---
    // Wrap the model in a group so our normalization (centering offset) is independent
    // of the orientation we set on the outer object3D each frame.
    const inner = new THREE.Group();
    inner.add(model);

    let box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const largest = Math.max(size.x, size.y, size.z) || 1;
    const s = TARGET_SIZE / largest;
    model.scale.multiplyScalar(s);

    // recompute after scaling, then center the model on its bbox center (body)
    box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3(); box.getCenter(center);
    model.position.sub(center);

    // --- orient nose to -Z. The long horizontal axis is the beak→tail axis. ---
    // After scaling, decide which horizontal axis (x or z) is longest and rotate the
    // INNER group so that length runs along Z. We don't know which END is the nose,
    // so we pick a consistent convention (nose -Z) — yawOffset lets a skin flip 180°.
    box = new THREE.Box3().setFromObject(model);
    const dim = new THREE.Vector3(); box.getSize(dim);
    if (dim.x > dim.z) {
      // length runs along X → rotate -90° about Y so it runs along Z, nose toward -Z
      inner.rotation.y = -Math.PI / 2;
    }
    inner.rotation.y += yawOffset;

    // Outer object: this is what we move/orient every frame (like BirdModel._model).
    const object3D = new THREE.Group();
    object3D.name = 'avatar-root-' + entry;
    object3D.add(inner);
    scene.add(object3D);

    // --- choose animation tier ---
    let mixer = null;
    let action = null;
    const wingBones = [];

    if (gltf.animations && gltf.animations.length > 0) {
      // Tier 1 — embedded clip.
      mixer = new THREE.AnimationMixer(model);
      const clip =
        gltf.animations.find((c) => /fly|flap|wing|idle/i.test(c.name || '')) ||
        gltf.animations[0];
      action = mixer.clipAction(clip);
      action.play();
    } else if (hasSkin) {
      // Tier 2 — procedural wing-bone flap. Collect wing-ish bones to oscillate.
      model.traverse((o) => {
        if (o.isBone && WING_BONE_RE.test(o.name || '')) {
          wingBones.push({ bone: o, baseRot: o.rotation.clone() });
        }
      });
      // If the heuristic found nothing, Tier 2 degrades gracefully to Tier 3 motion.
    }
    // else: Tier 3 — static mesh, whole-model pseudo-flight (no setup needed).

    const tier = mixer ? 1 : (wingBones.length ? 2 : 3);

    // ── shared per-frame transform (mirror BirdModel.update orientation) ──
    const _tmpForward = new THREE.Vector3();
    const _lookTarget = new THREE.Vector3();
    const _tmpObj = new THREE.Object3D();
    let _clock = 0; // accumulates dt for the procedural sines

    function applyTransform(st, dt, flap) {
      _clock += dt;

      // Position straight from the flight state / synced transform.
      object3D.position.copy(st.position);

      // Forward: prefer st.forward; else derive from yaw/pitch like FlightState.
      if (st.forward) {
        _tmpForward.copy(st.forward);
      } else {
        const yaw = st.yaw || 0, pitch = st.pitch || 0;
        _tmpForward.set(
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        );
      }
      _tmpForward.normalize();

      // Orientation: lookAt(position+forward), then bank via roll about forward axis —
      // identical to BirdModel so the avatar sits/flies exactly like the Stork.
      _lookTarget.copy(object3D.position).add(_tmpForward);
      _tmpObj.position.copy(object3D.position);
      _tmpObj.up.set(0, 1, 0);
      _tmpObj.lookAt(_lookTarget);
      _tmpObj.rotateZ(-(st.roll || 0));

      const grounded = st.mode === FLIGHT_MODE.GROUNDED;
      const landing = st.mode === FLIGHT_MODE.LANDING;
      if (grounded) {
        _tmpObj.rotateX(-0.95); // ~55° nose-up stand
      } else if (landing) {
        const progress = Math.min((st.landingTimer || 0) / 1.5, 1);
        _tmpObj.rotateX(-0.95 * progress);
      }

      object3D.quaternion.copy(_tmpObj.quaternion);
    }

    function update(st, dt, _camera, flapStrength) {
      if (!st || !st.position) return;
      const flap = Math.max(0, Math.min(1.5, flapStrength != null ? flapStrength : (st.flapPhase > 0 ? 1 : 0)));

      applyTransform(st, dt, flap);

      if (tier === 1 && mixer) {
        // Advance the embedded clip; faster when flapping harder.
        mixer.update(dt * (0.8 + flap));
      } else if (tier === 2) {
        // Procedural wing-beat: amplitude + frequency rise with flap strength.
        const freq = 6 + flap * 8;          // Hz-ish: 6 gliding → ~18 at full flap
        const amp = 0.18 + flap * 0.55;     // radians of wing swing
        const phase = Math.sin(_clock * freq);
        for (let i = 0; i < wingBones.length; i++) {
          const wb = wingBones[i];
          const name = wb.bone.name || '';
          // Mirror left vs right so the two wings beat together (down on the same beat).
          const sideSign = /right|_r\b|r_|\.r\b|\br\b/i.test(name) ? -1 : 1;
          // Most bird rigs flap about local Z (or X). Bias to Z; small X for a folding feel.
          wb.bone.rotation.z = wb.baseRot.z + phase * amp * sideSign;
          wb.bone.rotation.x = wb.baseRot.x + phase * amp * 0.25;
        }
      } else {
        // Tier 3 — whole-model pseudo-flight: gentle body bob + a touch of nose-up on flap.
        // No wing motion (static mesh); bank/pitch already come from the orientation above.
        const bob = Math.sin(_clock * 5) * (0.06 + flap * 0.22);
        object3D.position.y += bob;
        if (flap > 0.01) {
          // brief nose-up pulse on a flap, layered on top of the flight orientation
          object3D.rotateX(-0.05 * flap);
        }
      }
    }

    function setVisible(b) { object3D.visible = !!b; }

    function dispose() {
      if (mixer) mixer.stopAllAction?.();
      scene.remove(object3D);
      object3D.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
          else m?.dispose?.();
        }
      });
    }

    return { object3D, update, setVisible, dispose, tier };
  } catch (err) {
    console.warn('[AvatarBird] failed to load "' + entry + '" (' + url + '):', err);
    return makeFallback(scene);
  }
}

/**
 * Tiny visible box that honors the same api, so a failed load never crashes the
 * caller — the bird just shows as a small placeholder cube that still flies around.
 */
function makeFallback(scene) {
  const geo = new THREE.BoxGeometry(3, 1.2, 5);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffcc44, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  const object3D = new THREE.Group();
  object3D.name = 'avatar-fallback';
  object3D.add(mesh);
  scene.add(object3D);

  const _fwd = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _obj = new THREE.Object3D();

  function update(st) {
    if (!st || !st.position) return;
    object3D.position.copy(st.position);
    if (st.forward) _fwd.copy(st.forward);
    else {
      const yaw = st.yaw || 0, pitch = st.pitch || 0;
      _fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    }
    _fwd.normalize();
    _look.copy(object3D.position).add(_fwd);
    _obj.position.copy(object3D.position);
    _obj.up.set(0, 1, 0);
    _obj.lookAt(_look);
    _obj.rotateZ(-(st.roll || 0));
    object3D.quaternion.copy(_obj.quaternion);
  }
  function setVisible(b) { object3D.visible = !!b; }
  function dispose() {
    scene.remove(object3D);
    geo.dispose();
    mat.dispose();
  }
  return { object3D, update, setVisible, dispose, tier: 0 };
}
