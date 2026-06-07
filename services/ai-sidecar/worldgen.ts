/**
 * World generation for FLOCKED creative mode.
 *
 * generateWorld(prompts, seed) → a schema-clamped LevelConfig the client renders.
 * The world/course is PURELY DETERMINISTIC from the seed via generateMock
 * (keyword themes + seeded course). No LLM call — instant, free, reproducible.
 * (The predator director + live commentary still use Claude; only the WORLD is mock.)
 *
 * The clampLevel min/max bounds double as balance guardrails — a generated
 * level is always flyable (rings reachable, gravity sane).
 */

export interface Ring { x: number; y: number; z: number; }
export interface LevelConfig {
  theme: string;
  skyColor: string;   // #rrggbb
  fogColor: string;   // #rrggbb
  waterColor: string; // #rrggbb
  gravityScale: number; // 0.6 (floaty) .. 1.4 (heavy)
  rings: Ring[];        // 8..16 course waypoints; spawn is (0,60,0)
}

const THEMES: Record<string, { skyColor: string; fogColor: string; waterColor: string }> = {
  pirate: { skyColor: '#3a4a66', fogColor: '#5b6b80', waterColor: '#1f6f7a' },
  lava:   { skyColor: '#2a1410', fogColor: '#6b2a16', waterColor: '#7a2f12' },
  ice:    { skyColor: '#bfe3ff', fogColor: '#cfe8f5', waterColor: '#7fb9d6' },
  night:  { skyColor: '#0b1026', fogColor: '#1a2348', waterColor: '#12203f' },
  sunset: { skyColor: '#ff9a5a', fogColor: '#ffb27a', waterColor: '#c96f55' },
  forest: { skyColor: '#88b06a', fogColor: '#9ec27e', waterColor: '#3f7a5a' },
  desert: { skyColor: '#e8c98a', fogColor: '#e0c089', waterColor: '#7aa0a0' },
  storm:  { skyColor: '#3b414a', fogColor: '#4a525c', waterColor: '#2f4452' },
};

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTheme(text: string): string {
  const t = text.toLowerCase();
  for (const k of Object.keys(THEMES)) if (t.includes(k)) return k;
  if (t.includes('dark') || t.includes('moon') || t.includes('space')) return 'night';
  if (t.includes('fire') || t.includes('volcano') || t.includes('hell')) return 'lava';
  if (t.includes('snow') || t.includes('frozen') || t.includes('arctic')) return 'ice';
  if (t.includes('sea') || t.includes('ocean') || t.includes('ship') || t.includes('water')) return 'pirate';
  if (t.includes('jungle') || t.includes('tree') || t.includes('green')) return 'forest';
  if (t.includes('sand') || t.includes('dune')) return 'desert';
  if (t.includes('rain') || t.includes('thunder')) return 'storm';
  return 'sunset';
}

function clampLevel(c: LevelConfig): LevelConfig {
  const hex = (s: string, fb: string) => (/^#[0-9a-fA-F]{6}$/.test(s) ? s : fb);
  const rings = (c.rings || [])
    .slice(0, 16)
    .map((r) => ({
      x: Math.max(-1500, Math.min(1500, Math.round(r.x))),
      y: Math.max(30, Math.min(130, Math.round(r.y))),
      z: Math.max(-1500, Math.min(1500, Math.round(r.z))),
    }));
  while (rings.length < 8) {
    // pad with a gentle continuation if the model under-produced
    const last = rings[rings.length - 1] || { x: 0, y: 60, z: -120 };
    rings.push({ x: last.x, y: last.y, z: last.z - 130 });
  }
  return {
    theme: (c.theme || 'sunset').slice(0, 40),
    skyColor: hex(c.skyColor, '#ff9a5a'),
    fogColor: hex(c.fogColor, '#ffb27a'),
    waterColor: hex(c.waterColor, '#c96f55'),
    gravityScale: Math.max(0.6, Math.min(1.4, c.gravityScale || 1.0)),
    rings,
  };
}

export function generateMock(prompts: string[], seed: number): LevelConfig {
  const joined = prompts.join(' ') || 'a scenic sunset flight';
  const themeKey = pickTheme(joined);
  const base = THEMES[themeKey];
  const rng = mulberry32(seed || 1);
  const lower = joined.toLowerCase();
  const hard = lower.includes('hard') || lower.includes('narrow') || lower.includes('insane') || lower.includes('extreme');
  const ringCount = hard ? 14 : 10;
  const gravityScale = lower.includes('floaty') || lower.includes('moon')
    ? 0.7
    : (lower.includes('heavy') || lower.includes('lead') ? 1.3 : 1.0);

  const rings: Ring[] = [];
  let x = 0, z = 0;
  let heading = rng() * Math.PI * 2;
  for (let i = 0; i < ringCount; i++) {
    heading += (rng() - 0.5) * 1.2;
    const step = (hard ? 100 : 130) + rng() * 80;
    x += Math.cos(heading) * step;
    z += Math.sin(heading) * step;
    const y = 45 + rng() * 60;
    rings.push({ x: Math.round(x), y: Math.round(y), z: Math.round(z) });
  }
  return clampLevel({ theme: themeKey, ...base, gravityScale, rings });
}

export async function generateWorld(prompts: string[], seed: number): Promise<LevelConfig> {
  // The world/course is purely deterministic from the seed — no LLM call.
  // (The predator director + live commentary still use Claude; the WORLD does not.)
  return generateMock(prompts, seed);
}
