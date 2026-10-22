import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

/**
 * Fehlerseite für GitHub Pages (public/404.html): Baut das Spiel einmal echt (vite.config.ts
 * mit Service-Worker-Plugin) in einen eigenen Ordner und prüft den Build-Output – 404.html
 * liegt im Wurzelordner, verlinkt absolut auf den Pages-Pfad und landet nicht im Cache des
 * Service Workers. Ein eigener Ordner statt dist/, damit parallele Builds (e2e) nicht stören.
 */

/** Pfad des Spiels auf GitHub Pages (https://j4nric.github.io/tree-grow-app/). */
const PAGES_BASE = '/tree-grow-app/';

// Node-Module ohne @types/node: dynamisch laden und nur das Nötige typisieren.
interface Fs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
}
const nodeModule = (name: string): Promise<any> => import(/* @vite-ignore */ name);

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
let fs: Fs;
let outDir = '';
let page = '';
let sw = '';

beforeAll(async () => {
  fs = (await nodeModule('node:fs/promises')) as Fs;
  const os = await nodeModule('node:os');
  outDir = await fs.mkdtemp(`${os.tmpdir()}/vszw-pages-404-`);
  await build({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  page = await fs.readFile(`${outDir}/404.html`, 'utf8');
  sw = await fs.readFile(`${outDir}/sw.js`, 'utf8');
}, 60_000);

afterAll(async () => {
  if (outDir) await fs.rm(outDir, { recursive: true, force: true });
});

describe('404-Seite im Build (GitHub Pages)', () => {
  it('liegt im Wurzelordner des Builds neben index.html', async () => {
    const files = await fs.readdir(outDir);
    expect(files).toContain('404.html');
    expect(files).toContain('index.html');
  });

  it('deutsch, im Spielstil, mit Link zurück zum Spiel unter dem Pages-Pfad', () => {
    expect(page).toContain('<html lang="de">');
    expect(page).toContain('Dieser Pfad ist zugewachsen');
    // absolut: GitHub Pages liefert 404.html auch unter /tree-grow-app/a/b/ aus
    expect(page).toContain(`href="${PAGES_BASE}"`);
    expect(page).toMatch(/name="viewport"/);
  });

  it('lädt nichts nach: keine Skripte, keine externen oder relativen Ressourcen', () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/<link[^>]+href=/i);
    expect(page).not.toMatch(/\bsrc=/i);
    expect(page).not.toMatch(/url\(/i);
    expect(page).not.toMatch(/@import/i);
    expect(page).not.toMatch(/https?:\/\//i);
  });

  it('der Service Worker cacht 404.html nicht, die Startseite aber schon', () => {
    const match = sw.match(/"files":(\[[^\]]*\])/);
    expect(match).not.toBeNull();
    const files = JSON.parse(match![1]!) as string[];
    expect(files).toContain('./');
    expect(files).not.toContain('404.html');
  });
});
