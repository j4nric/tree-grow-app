import type { Page } from '@playwright/test';
import { build } from 'vite';
import { expect, openGame, test } from './fixtures';

/**
 * Klang (⚙️ Einstellungen → Klang): Standard aus, Wahl bleibt nach dem Neuladen, und
 * nichts bricht – weder mit echtem Web Audio noch ganz ohne AudioContext.
 * `body[data-sound]` zeigt den Zustand der Klangkulisse (off/waiting/running/paused/unavailable).
 */

const settings = (page: Page) => page.locator('[data-ref="settings"]');
const soundGroup = (page: Page) => settings(page).locator('[data-setting="sound"]');
const soundState = (page: Page) => page.evaluate(() => document.body.dataset.sound);

async function openSettings(page: Page): Promise<void> {
  await page.locator('[data-ref="settings-open"]').click();
  await expect(settings(page)).toBeVisible();
}

test('Klang: Standard aus, umschalten per Tastatur, bleibt nach dem Neuladen', async ({ page }) => {
  await openGame(page);
  expect(await soundState(page)).toBe('off');
  await openSettings(page);
  await expect(settings(page).getByRole('group', { name: 'Klang' })).toBeVisible();
  await expect(soundGroup(page).getByLabel(/^Aus \(Standard/)).toBeChecked();

  // Tastatur: Fokus auf die gewählte Option, Pfeil nach unten wählt „Leise“.
  await soundGroup(page).getByLabel(/^Aus \(Standard/).focus();
  await page.keyboard.press('ArrowDown');
  await expect(soundGroup(page).getByLabel(/^Leise/)).toBeChecked();
  await expect.poll(() => soundState(page)).toMatch(/^(running|paused)$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tree-grow-settings') ?? '{}').sound)).toBe('quiet');

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  // Nach dem Neuladen wartet der Klang auf eine Interaktion (Autoplay-Regeln).
  expect(await soundState(page)).toBe('waiting');
  await openSettings(page);
  await expect(soundGroup(page).getByLabel(/^Leise/)).toBeChecked();
  await expect.poll(() => soundState(page)).toMatch(/^(running|paused)$/);

  await soundGroup(page).getByLabel(/^Normal/).check();
  await soundGroup(page).getByLabel(/^Aus \(Standard/).check();
  await expect.poll(() => soundState(page)).toBe('off');
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  expect(await soundState(page)).toBe('off');
});

test('Klang ohne Web Audio: keine Fehler, Einstellung bleibt wählbar', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.AudioContext;
    delete w.webkitAudioContext;
  });
  await openGame(page);
  expect(await page.evaluate(() => 'AudioContext' in window)).toBe(false);
  await openSettings(page);
  await soundGroup(page).getByLabel(/^Normal/).check();
  await expect.poll(() => soundState(page)).toBe('unavailable');
  await page.keyboard.press('Escape');
  // Spiel läuft weiter: ein paar Frames und Klicks ohne Fehler.
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  await page.mouse.click(10, 10);
  expect(await soundState(page)).toBe('unavailable');
});

test('Klang nach dem Neuladen: ein Klick blendet ihn hörbar ein', async ({ page }) => {
  // Abgriff hinter der ganzen Kette: alles, was in den Ausgang geht, auch in einen Analyser.
  await page.addInitScript(() => {
    const w = window as unknown as { __peak: number; __analyser?: AnalyserNode };
    w.__peak = 0;
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (args[0] === this.context.destination && !w.__analyser) {
        const a = this.context.createAnalyser();
        a.fftSize = 2048;
        connect.call(this, a);
        w.__analyser = a;
        const buf = new Float32Array(2048);
        setInterval(() => {
          a.getFloatTimeDomainData(buf);
          for (const v of buf) w.__peak = Math.max(w.__peak, Math.abs(v));
        }, 30);
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  });
  await openGame(page);
  await openSettings(page);
  await soundGroup(page).getByLabel(/^Normal/).check();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  expect(await soundState(page)).toBe('waiting');
  await page.mouse.click(10, 10);
  await expect.poll(() => soundState(page)).toBe('running');
  // Wind ist nie ganz still: Pegel klar über Null, aber unter −12 dBFS.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __peak: number }).__peak), { timeout: 5000 })
    .toBeGreaterThan(10 ** (-70 / 20));
  const peak = await page.evaluate(() => (window as unknown as { __peak: number }).__peak);
  expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-12);
});

/** Die Engine aus src/ui/sound.ts als Skript für die Seite (ohne Spiel drumherum). */
async function soundLabScript(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'src/ui/sound.ts', formats: ['iife'], name: 'SoundLab', fileName: 'sound-lab' } },
  });
  const result = Array.isArray(out) ? out[0] : out;
  return (result as { output: { code?: string }[] }).output[0]!.code!;
}

test('Pegel: echte Kette offline gerendert – Spitze ≤ −12 dBFS, Leise ≈ 10 dB darunter', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('about:blank');
  await page.addScriptTag({ content: await soundLabScript() });
  const result = await page.evaluate(async () => {
    type Lab = { createSound: (level: string, env: unknown) => { setLevel(l: string): void; update(v: unknown, now: number): void; cue(k: string): void } };
    const lab = (window as unknown as { SoundLab: Lab }).SoundLab;
    async function render(level: string, season: number, withEvents: boolean) {
      const sr = 48000;
      const seconds = 6;
      const off = new OfflineAudioContext(2, sr * seconds, sr);
      let oscillators = 0;
      // Für die Engine sieht der Offline-Kontext aus wie ein laufender AudioContext.
      const ctx = new Proxy(off, {
        get(target, key) {
          if (key === 'state') return 'running';
          if (key === 'resume' || key === 'suspend') return () => Promise.resolve();
          if (key === 'createOscillator') oscillators++;
          const v = Reflect.get(target, key, target) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
      const listeners = new Map<string, () => void>();
      let seed = 4242;
      const env = {
        createContext: () => ctx,
        doc: { visibilityState: 'visible', addEventListener: (t: string, fn: () => void) => listeners.set(t, fn), body: null },
        random: () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296),
      };
      const sound = lab.createSound(level, env);
      listeners.get('pointerdown')!();
      const start = 1.5;
      let chirped = false;
      void off.suspend(start).then(() => {
        // Wind und Pad auf Höchststand; ein Vogelruf und alle Ereignisse gleichzeitig.
        const before = oscillators;
        for (let i = 1; i < 20000 && !chirped; i++) {
          sound.update({ season, harmonyTier: 4 }, i);
          chirped = oscillators > before;
        }
        if (withEvents) for (const kind of ['encounter', 'achievement', 'stage']) sound.cue(kind);
        void off.resume();
      });
      const buf = await off.startRendering();
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = Math.floor(start * sr); i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
      }
      return { peakDb: 20 * Math.log10(peak), chirped };
    }
    return {
      normalAll: await render('normal', 1.6, true),
      normalSpringAll: await render('normal', 0, true),
      normalWind: await render('normal', 2, false),
      quietAll: await render('quiet', 1.6, true),
    };
  });
  console.log('Pegel (dBFS):', JSON.stringify(result));
  for (const r of Object.values(result)) {
    expect(r.chirped).toBe(true);
    expect(r.peakDb).toBeLessThanOrEqual(-12);
  }
  expect(result.normalAll.peakDb).toBeGreaterThan(-20);
  const diff = result.normalAll.peakDb - result.quietAll.peakDb;
  expect(diff).toBeGreaterThan(9);
  expect(diff).toBeLessThan(11);
});
