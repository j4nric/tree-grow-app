/**
 * Erzeugt die App-Icons (PWA, Apple-Touch-Icon) prozedural im Stil der Szene: ein junger
 * Baum mit runder Laubkrone auf einem grünen Kreis. Gezeichnet wird im Canvas eines
 * Chromium aus Playwright (vorinstalliert, keine neue Abhängigkeit); die PNGs sind
 * eingecheckt, das Skript läuft nur bei Änderungen am Aussehen:
 *
 *   node --experimental-strip-types scripts/generate-icons.ts
 *
 * Farben aus src/style.css (--accent, --bg) und src/render/tree.ts (Holz, Laubtöne).
 */
import { chromium } from '@playwright/test';

interface IconSpec {
  file: string;
  size: number;
  /** Maskierbar: Hintergrund bis zum Rand, Motiv in der sicheren Zone (Kreis mit 40 % Radius). */
  maskable: boolean;
}

const ICONS: IconSpec[] = [
  { file: 'public/icons/icon-192.png', size: 192, maskable: false },
  { file: 'public/icons/icon-512.png', size: 512, maskable: false },
  { file: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
  // iOS rundet selbst ab und mag keine Transparenz: volle Fläche wie maskierbar
  { file: 'public/icons/apple-touch-icon.png', size: 180, maskable: true },
];

/** Läuft im Browser: zeichnet das Icon auf das Canvas #icon. */
function drawIcon({ size, maskable }: { size: number; maskable: boolean }): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#icon')!;
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.scale(size / 100, size / 100); // Zeichnung in Einheiten 0–100

  // Grüner Kreis (maskierbar: ganze Fläche, das System schneidet selbst zu)
  const sky = ctx.createRadialGradient(42, 34, 6, 50, 50, 62);
  sky.addColorStop(0, '#d6ecb8');
  sky.addColorStop(1, '#7fb766');
  ctx.fillStyle = sky;
  ctx.beginPath();
  if (maskable) ctx.rect(0, 0, 100, 100);
  else ctx.arc(50, 50, 48, 0, Math.PI * 2);
  ctx.fill();

  // Motiv kleiner, damit es in der sicheren Zone der maskierbaren Icons bleibt
  const k = maskable ? 0.78 : 1;
  ctx.translate(50 - 50 * k, 50 - 50 * k);
  ctx.scale(k, k);

  // Hügel mit hellem Gras, am Kreisrand abgeschnitten
  ctx.save();
  ctx.beginPath();
  if (maskable) ctx.rect(-50, -50, 200, 200);
  else ctx.arc(50, 50, 48, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#5e903e';
  ctx.beginPath();
  ctx.ellipse(50, 88, maskable ? 90 : 44, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a7934';
  ctx.beginPath();
  ctx.ellipse(50, 94, maskable ? 95 : 48, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  if (maskable) ctx.fillRect(-50, 94, 200, 60); // Boden bis zum unteren Rand
  ctx.restore();

  // Stamm mit zwei Ästen
  ctx.fillStyle = '#6b4a30';
  ctx.beginPath();
  ctx.moveTo(45, 82);
  ctx.quadraticCurveTo(47, 64, 47.5, 48);
  ctx.lineTo(52.5, 48);
  ctx.quadraticCurveTo(53, 64, 55, 82);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#6b4a30';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(49, 60);
  ctx.quadraticCurveTo(42, 54, 37, 47);
  ctx.moveTo(51, 57);
  ctx.quadraticCurveTo(58, 52, 63, 45);
  ctx.stroke();
  ctx.fillStyle = '#866244';
  ctx.fillRect(49.2, 54, 1.4, 24);

  // Laubkrone: Schatten, drei Töne, Glanzlichter (wie die Kronen in der Szene)
  const blob = (x: number, y: number, r: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const crown: [number, number, number][] = [
    [50, 34, 17],
    [35, 42, 12],
    [65, 42, 12],
    [42, 26, 11],
    [59, 27, 11],
    [50, 47, 11],
  ];
  for (const [x, y, r] of crown) blob(x, y + 2, r + 1.5, '#2c5230');
  for (const [x, y, r] of crown) blob(x, y, r, '#3a6e39');
  for (const [x, y, r] of crown) blob(x - r * 0.18, y - r * 0.2, r * 0.78, '#4d8942');
  for (const [x, y, r] of crown) blob(x - r * 0.32, y - r * 0.36, r * 0.5, '#68a14e');
  blob(40, 23, 3.2, '#a7cf7c');
  blob(31, 38, 2.4, '#a7cf7c');
  blob(55, 21, 2.2, '#a7cf7c');

  // Samenkorn am Fuß: vom Samen zum Wald
  ctx.fillStyle = '#efe6cf';
  ctx.beginPath();
  ctx.ellipse(66, 83, 3.4, 2.3, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9b7651';
  ctx.beginPath();
  ctx.ellipse(66.6, 83.4, 2.2, 1.4, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent('<body style="margin:0;background:transparent"><canvas id="icon"></canvas></body>');
  for (const icon of ICONS) {
    await page.evaluate(drawIcon, { size: icon.size, maskable: icon.maskable });
    await page.locator('#icon').screenshot({ path: icon.file, omitBackground: true });
    console.log(`${icon.file} (${icon.size} px${icon.maskable ? ', maskierbar' : ''})`);
  }
} finally {
  await browser.close();
}
