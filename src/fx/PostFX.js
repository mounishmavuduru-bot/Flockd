/**
 * PostFX — TSL post-processing pipeline for the WebGPU renderer.
 *
 * Chain (in order):
 *   scene pass (MRT: output + emissive)
 *     → BLOOM on the emissive/bright buffer (glows rings, sun, bright water
 *       without washing out the whole frame)
 *     → subtle VIGNETTE (radial darkening at the edges)
 *     → gentle filmic COLOR-GRADE (slight contrast S-curve + warm tint)
 *     → light FILM GRAIN (animated noise, scaled down hard)
 *
 * The whole thing is built from three/webgpu's `PostProcessing` + three/tsl
 * nodes, so it ONLY works on a node-capable backend (WebGPU, or WebGPU's
 * WebGL2 fallback which still understands TSL). On any backend or version
 * where this isn't available, construction throws — and the caller
 * (src/main.js) wraps `createPostFX` in try/catch and leaves `postFX` null,
 * so the game just renders normally via `renderer.render(scene, camera)`.
 *
 * @three_import import { bloom } from 'three/addons/tsl/display/BloomNode.js';
 */
import { PostProcessing } from 'three/webgpu';
import {
  pass, mrt, output, emissive, uniform,
  uv, vec2, vec3, length, smoothstep, mix, clamp, dot, sin, fract, float, time,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * Build the post-processing pipeline.
 *
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @returns {{ render: () => void, setSize: (w:number, h:number) => void, enabled: boolean }}
 */
export function createPostFX(renderer, scene, camera) {
  // --- Scene pass with MRT so bloom can be selective on emissive/bright areas ---
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, emissive }));

  const scenePassColor = scenePass.getTextureNode('output');
  const emissivePass = scenePass.getTextureNode('emissive');

  // --- BLOOM (modest — glows bright/emissive areas, doesn't wash out) ---
  // Feed the emissive buffer so flat-lit terrain doesn't bloom; rings/sun/
  // bright water (which push emissive or read very bright) catch the glow.
  // strength ~0.6, radius ~0.4, threshold ~0.9.
  const bloomPass = bloom(emissivePass, 0.6, 0.4, 0.9);

  // Base image = scene color + bloom.
  const composed = scenePassColor.add(bloomPass);

  // Pull RGB out so the grade/vignette/grain operate on a vec3.
  let color = composed.rgb;

  // --- Gentle filmic COLOR-GRADE: slight contrast S-curve + warm tint ---
  const contrast = uniform(1.06);   // >1 = a touch more contrast
  const warm = uniform(vec3(1.045, 1.005, 0.955)); // mul: lift R, drop B slightly
  // Contrast pivots around mid-grey (0.5).
  color = color.sub(0.5).mul(contrast).add(0.5);
  color = color.mul(warm);

  // --- Subtle VIGNETTE (radial darkening toward the corners) ---
  const vignetteStrength = uniform(0.55); // 0 = none, 1 = strong
  // Distance from screen centre, in normalized UV space.
  const centered = uv().sub(0.5);
  const dist = length(centered.mul(vec2(1.0, 1.0)));
  // 1.0 in the centre, falling off near the edges.
  const vig = smoothstep(0.8, 0.35, dist);
  color = color.mul(mix(float(1.0), vig, vignetteStrength));

  // --- Light FILM GRAIN (animated hash noise, scaled hard down) ---
  const grainAmount = uniform(0.045);
  // Cheap per-pixel hash, animated by time so it shimmers like film.
  const grainSeed = uv().add(fract(time.mul(0.91)));
  const noise = fract(sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453));
  // Centre the noise around 0 so it both lifts and darkens.
  color = color.add(noise.sub(0.5).mul(grainAmount));

  // Keep everything in range.
  color = clamp(color, 0.0, 1.0);

  // --- Wire into PostProcessing ---
  const postProcessing = new PostProcessing(renderer);
  postProcessing.outputNode = color;

  return {
    enabled: true,
    render() {
      postProcessing.render();
    },
    setSize(w, h) {
      // PostProcessing has no setSize; the internal scene PassNode reads the
      // renderer's drawing-buffer size every frame (PassNode.updateBefore →
      // renderer.getSize) and resizes its render targets automatically. So we
      // only need the renderer itself sized. The existing Renderer.js resize
      // handler already does this, but mirror it here so this hook is correct
      // even if called independently.
      if (renderer && typeof renderer.setSize === 'function') {
        renderer.setSize(w, h);
      }
    },
  };
}
