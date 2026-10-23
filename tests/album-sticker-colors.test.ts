import { beforeAll, describe, expect, it } from 'vitest';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { GENERA, PLANT_GROUPS } from '../src/content/types';
import { VISITORS } from '../src/content/visitors';

/**
 * Zuordnung Gattung → Sticker-Farbe (docs/ALBUM_UI.md, D.4 und E.1): Jede Gattung und jede
 * Pflanzengruppe hat eine eigene Grundfarbe in sticker.css, und die Farbe ist in tokens.css
 * definiert. Eine neue Gattung fiele sonst still auf den weißen Grund zurück.
 */

/** `.sticker[data-family='x']` → Wert von `--sticker-bg` (auch bei Regeln mit mehreren Selektoren). */
function familyColors(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, selectors, body] of css.matchAll(rule)) {
    const bg = /--sticker-bg:\s*([^;]+);/.exec(body!)?.[1]?.trim();
    if (!bg) continue;
    for (const [, family] of selectors!.matchAll(/\.sticker\[data-family='([a-z-]+)'\]/g)) out.set(family!, bg);
  }
  return out;
}

/** Alle in tokens.css definierten CSS-Variablen mit Wert. */
function tokens(css: string): Map<string, string> {
  return new Map([...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));
}

// CSS als Text lesen (Vitest verarbeitet CSS-Importe nicht); Node-Module ohne @types/node.
const nodeModule = (name: string): Promise<any> => import(/* @vite-ignore */ name);
const albumDir = decodeURIComponent(new URL('../src/ui/album/', import.meta.url).pathname);
let colors = new Map<string, string>();
let defined = new Map<string, string>();

beforeAll(async () => {
  const fs = (await nodeModule('node:fs/promises')) as { readFile(path: string, encoding: 'utf8'): Promise<string> };
  colors = familyColors(await fs.readFile(`${albumDir}sticker.css`, 'utf8'));
  defined = tokens(await fs.readFile(`${albumDir}tokens.css`, 'utf8'));
});

describe('Sticker-Farbe je Gattung', () => {
  it('jede Gattung hat eine eigene, in tokens.css definierte Grundfarbe', () => {
    const seen = new Set<string>();
    for (const genus of GENERA) {
      const bg = colors.get(genus);
      expect(bg, genus).toMatch(/^var\(--fam-[a-z]+\)$/);
      const token = /^var\((--[a-z-]+)\)$/.exec(bg!)![1]!;
      expect(defined.get(token), `${genus}: ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      seen.add(defined.get(token)!.toLowerCase());
    }
    // Gattungen unterscheiden sich in der Farbe.
    expect(seen.size).toBe(GENERA.length);
  });

  it('jede Pflanzengruppe hat eine Grundfarbe aus den Gattungsfarben', () => {
    for (const group of PLANT_GROUPS) {
      const bg = colors.get(group);
      expect(bg, group).toMatch(/^var\(--fam-[a-z]+\)$/);
      expect(defined.has(/^var\((--[a-z-]+)\)$/.exec(bg!)![1]!), group).toBe(true);
    }
  });

  it('alle Arten, Gäste und Pflanzen aus content/ landen auf einer Farbe', () => {
    for (const s of [...SPECIES, ...VISITORS]) expect(colors.has(s.genus), s.id).toBe(true);
    for (const p of PLANTS) expect(colors.has(p.group), p.id).toBe(true);
  });

  it('keine Regel für eine Gattung, die es nicht gibt (Tippfehler)', () => {
    const known = new Set<string>([...GENERA, ...PLANT_GROUPS]);
    for (const family of colors.keys()) expect(known.has(family), family).toBe(true);
  });
});
