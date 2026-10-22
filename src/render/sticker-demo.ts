/**
 * Sticker-Tafel der Render-Demo (nicht Teil des Spiels): alle Arten und Gäste als
 * Album-Sticker in den drei Varianten. Aufruf: /src/render/demo.html?stickers=1
 *
 *  ss    Sticker-Größe in CSS-Pixeln (Standard 64)
 *  dpr   Pixeldichte (Standard: die des Geräts)
 *
 * Misst die Zeit für das erste Zeichnen aller Sticker je Variante (kalter Cache) und legt
 * sie in `window.__stickers` ab.
 */

import type { AnimalFamily } from './animals';
import { clearStickerCache, renderSpeciesSticker, stickerKind, type StickerVariant } from './sticker';

declare global {
  interface Window {
    __stickers?: { ids: number; size: number; dpr: number; ms: Record<StickerVariant, number>; warmMs: number; perSticker: number };
  }
}

const VARIANTS: readonly StickerVariant[] = ['color', 'muted', 'silhouette'];

export function showStickerSheet(entries: readonly [string, AnimalFamily | undefined][], params: URLSearchParams): void {
  const size = Math.max(16, Math.min(256, Number(params.get('ss') ?? 64) || 64));
  const dpr = Number(params.get('dpr') ?? window.devicePixelRatio) || 1;

  // Messung: erstes Zeichnen aller Arten je Variante (kalter Cache), dann ein warmer Durchlauf.
  clearStickerCache();
  const ms = { color: 0, muted: 0, silhouette: 0 } as Record<StickerVariant, number>;
  for (const variant of VARIANTS) {
    const t0 = performance.now();
    for (const [id, family] of entries) renderSpeciesSticker(id, size, { dpr, variant, family });
    ms[variant] = performance.now() - t0;
  }
  const t1 = performance.now();
  for (const variant of VARIANTS) for (const [id, family] of entries) renderSpeciesSticker(id, size, { dpr, variant, family });
  const warmMs = performance.now() - t1;
  const total = ms.color + ms.muted + ms.silhouette;
  window.__stickers = { ids: entries.length, size, dpr, ms, warmMs, perSticker: total / (entries.length * VARIANTS.length) };

  document.body.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = `
    html, body { background: #f4ecd8; color: #3b3a36; height: auto; overflow: auto; }
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(${size * 3 + 44}px, 1fr)); gap: 10px 14px; padding: 12px; }
    .sheet h1 { grid-column: 1 / -1; font: 600 15px system-ui; margin: 0; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .row { display: flex; gap: 6px; }
    .slot { width: ${size}px; height: ${size}px; border-radius: 50%; background: #fffaf0;
      box-shadow: 0 0 0 3px #fff, 0 1px 4px rgba(59, 58, 54, 0.35); position: relative; }
    .slot.empty { background: #efe6d2; box-shadow: 0 0 0 2px #fff, inset 0 0 0 1px rgba(59,58,54,0.3); }
    .slot canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .slot.guide::after { content: ''; position: absolute; inset: 10%; outline: 1px dashed rgba(200, 60, 60, 0.45); }
    .label { font: 11px system-ui; }
  `;
  document.head.append(style);
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const h1 = document.createElement('h1');
  h1.textContent =
    `Album-Sticker · ${entries.length} Arten/Gäste · ${size} px @${dpr}x · erstes Zeichnen: ` +
    VARIANTS.map((v) => `${v} ${ms[v].toFixed(1)} ms`).join(', ') +
    ` · je Sticker ${window.__stickers.perSticker.toFixed(2)} ms · aus dem Cache ${warmMs.toFixed(2)} ms`;
  sheet.append(h1);
  const guide = params.get('guide') === '1';
  for (const [id, family] of entries) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const row = document.createElement('div');
    row.className = 'row';
    for (const variant of VARIANTS) {
      const slot = document.createElement('div');
      slot.className = `slot${variant === 'silhouette' ? ' empty' : ''}${guide ? ' guide' : ''}`;
      // Wie der spätere StickerSlot: eigenes kleines Canvas, ein drawImage aus dem Cache.
      const own = document.createElement('canvas');
      const src = renderSpeciesSticker(id, size, { dpr, variant, family });
      own.width = src.width;
      own.height = src.height;
      own.getContext('2d')!.drawImage(src, 0, 0);
      slot.append(own);
      row.append(slot);
    }
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `${id} → ${stickerKind(id, family) ?? '–'}`;
    cell.append(row, label);
    sheet.append(cell);
  }
  document.body.append(sheet);
}
