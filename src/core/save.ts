import { COMMUNITIES_BY_ID } from '../content/communities';
import { CARDS_PER_ENCOUNTER, MAX_PENDING_ENCOUNTERS } from '../content/encounters';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY, V1_KEEPSAKE_MIN_ENERGY, V1_KEEPSAKE_MIN_STAGE } from '../content/memory';
import { PLANTS_BY_ID } from '../content/plants';
import { SPECIES_BY_ID } from '../content/species';
import { NICHE_IDS } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import {
  nicheSlots,
  plantCost,
  plantSlots,
  regularSlots,
  slotEffects,
  stageForWaypoint,
  thresholdFor,
  waypointsForGrowth,
} from './formulas';
import { isValidRngState, normalizeSeed } from './rng';
import { recordDiscoveries } from './tick';
import {
  MAX_FOREST_MEMORY,
  SAVE_VERSION,
  createCycle,
  createInitialState,
  type GameState,
  type PendingEncounter,
} from './state';

export const SAVE_KEY = 'tree-grow-save';

/** Obergrenze für die Zyklus-Nummer beim Laden (Schutz vor kaputten Ständen). */
export const MAX_CYCLE_NUMBER = 1e9;

/**
 * v2 → v3: Prototyp-Stände (ohne Pflanzen) hatten keine Samen-Senke und bringen oft
 * Tausende 🌰 mit. Beim Laden wird der Bestand auf die Kosten der ersten zwei Pflanzen
 * begrenzt (20 + 38 = 58 🌰), damit niemand mit einem Schlag den Pflanzring füllt
 * (Empfehlung DESIGN_V2.md 15.4).
 */
export const V2_SEED_CAP = plantCost(0) + plantCost(1);

/** Ergebnis des Ladens: der Spielstand und ob er aus einem v1-Stand neu angelegt wurde. */
export interface LoadResult {
  state: GameState;
  /** Der gespeicherte Stand war v1 (Wasser/Licht/Energie) und wurde durch einen Neustart ersetzt. */
  migratedFromV1: boolean;
  /** Andenken „Die alte Eiche“ (+5 Waldgedächtnis) wurde vergeben. */
  keepsake: boolean;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Liest einen gespeicherten Stand. Unbekannte oder kaputte Felder werden durch
 * Startwerte ersetzt, damit ein alter Spielstand das Spiel nie zum Absturz bringt.
 * Gibt null zurück, wenn gar nichts Brauchbares vorliegt.
 */
export function loadGame(raw: string | null, now: number): LoadResult | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const version = typeof data.version === 'number' && Number.isFinite(data.version) ? data.version : 1;
  if (version < 2) return migrateV1(data, now);
  const state = loadV2(data, now, version);
  if (version < 3) migrateV2(state);
  if (version < 4) migrateV3(state);
  // Erst nach der Migration: sie verwirft z. B. Pflanzen, die v2 nicht kannte. Führt
  // auch H_max nach (die aktuelle Harmonie zählt schon für diesen Zyklus).
  recordDiscoveries(state);
  return { state, migratedFromV1: false, keepsake: false };
}

/** Wie loadGame, aber nur der Spielstand. */
export function deserialize(raw: string | null, now: number): GameState | null {
  return loadGame(raw, now)?.state ?? null;
}

/**
 * v1 → v2: sauberer Neustart (Wasser/Licht/Energie/Upgrades haben keine Entsprechung).
 * Wer in v1 mindestens „Junger Baum“ erreicht hat, bekommt das Andenken „Die alte
 * Eiche“: +5 Waldgedächtnis. Keine Offline-Zeit – die Uhr startet jetzt.
 */
function migrateV1(data: Record<string, unknown>, now: number): LoadResult {
  const oldLastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now, now + oldLastTick);
  const keepsake =
    finiteOr(data.stage, 0) >= V1_KEEPSAKE_MIN_STAGE || finiteOr(data.totalEnergy, 0) >= V1_KEEPSAKE_MIN_ENERGY;
  if (keepsake) {
    state.meta.forestMemory += V1_KEEPSAKE_MEMORY;
    state.meta.journal.keepsakes.push(V1_KEEPSAKE_ID);
  }
  return { state, migratedFromV1: true, keepsake };
}

/** Wegpunkt-Kurve der v2-Stände (Prototyp ohne Pflanzen): Wegpunkt k bei 4 · k^3,2. */
export const V2_WAYPOINT_BASE = 4;
export const V2_WAYPOINT_POWER = 3.2;

function v2Threshold(k: number): number {
  return k <= 0 ? 0 : Math.round(V2_WAYPOINT_BASE * Math.pow(k, V2_WAYPOINT_POWER));
}

/** Erreichte Wegpunkte auf einer (früheren) Kurve. */
function waypointsOnCurve(growth: number, threshold: (k: number) => number): number {
  let k = 0;
  while (k < WAYPOINT_COUNT && growth >= threshold(k + 1)) k++;
  return k;
}

/**
 * Bildet Gesamt-Wachstum von einer früheren Wegpunkt-Kurve auf dieselbe Stelle der
 * aktuellen Kurve ab: gleicher Wegpunkt, gleicher Bruchteil bis zum nächsten. So bleibt
 * die Stufe erhalten (kein Zurückstufen, keine entlassenen Tiere, keine doppelten
 * Wegpunkte). Hinter dem letzten Wegpunkt wird im Verhältnis der beiden Kurven skaliert.
 */
function growthToCurrentCurve(growth: number, threshold: (k: number) => number): number {
  if (!(growth > 0)) return 0;
  const k = waypointsOnCurve(growth, threshold);
  if (k >= WAYPOINT_COUNT) {
    const scaled = thresholdFor(WAYPOINT_COUNT) * (growth / threshold(WAYPOINT_COUNT));
    return Math.min(Number.MAX_VALUE, scaled);
  }
  const from = threshold(k);
  const to = threshold(k + 1);
  const fraction = Math.min(1, Math.max(0, (growth - from) / (to - from)));
  const newFrom = thresholdFor(k);
  const result = newFrom + fraction * (thresholdFor(k + 1) - newFrom);
  // Rundung darf nie unter den erreichten Wegpunkt fallen.
  return Math.max(newFrom, result);
}

/** v2-Stand (4 · k^3,2) → aktuelle Kurve (siehe growthToCurrentCurve). */
export function v2GrowthToV3(growth: number): number {
  return growthToCurrentCurve(growth, v2Threshold);
}

/** v2 → v3: noch keine Pflanzen; Samen-Bestand begrenzen (siehe V2_SEED_CAP). */
function migrateV2(state: GameState): void {
  state.plants = [];
  state.seeds = Math.min(state.seeds, V2_SEED_CAP);
}

/**
 * v3 → v4 (Neuer Zyklus): Vor v4 gab es keinen Zyklusstart, also läuft noch der erste
 * Zyklus – alle Arten im Tagebuch wurden in ihm entdeckt und zählen fürs Waldgedächtnis.
 * H_max ergänzt loadGame aus dem aktuellen Ökosystem; Stammgäste gibt es noch keine.
 */
function migrateV3(state: GameState): void {
  state.cycle = createCycle(1);
  state.cycle.newSpecies = [...state.meta.journal.species];
  state.meta.regulars = [];
}

/**
 * Robustes Laden eines Stands ab v2 (DESIGN_V2.md, 12.3). Felder, die es in v2 noch
 * nicht gab (Pflanzen), fehlen dort einfach und bleiben leer.
 */
function loadV2(data: Record<string, unknown>, now: number, version: number): GameState {
  const lastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now);
  state.version = SAVE_VERSION;
  state.lastTick = lastTick;
  // ±Infinity (z. B. „1e400“ im JSON) wird auf den größten endlichen Wert begrenzt.
  state.totalGrowth = clampedOr(data.totalGrowth, 0, 0, Number.MAX_VALUE);
  // v2 rechnete mit einer anderen Wegpunkt-Kurve: erst auf die neue umrechnen, dann ableiten.
  if (version < 3) state.totalGrowth = v2GrowthToV3(state.totalGrowth);
  state.seeds = clampedOr(data.seeds, 0, 0, Number.MAX_VALUE);
  // Wegpunkt und Stufe immer aus dem Gesamt-Wachstum ableiten.
  state.waypoint = waypointsForGrowth(state.totalGrowth);
  state.stage = stageForWaypoint(state.waypoint);

  // Nischen: unbekannte Arten und Duplikate verwerfen, jede Art in ihre eigene Nische,
  // auf die aktuelle Platzzahl kürzen. Fehlende Nischen (z. B. „hollows“ aus älteren
  // v2-Ständen) bleiben leer. Arten, die Plätze schaffen (Borkenkäfer → Höhlen, Schwarzspecht), ziehen
  // zuerst ein, damit ihre Plätze beim Kürzen schon zählen; danach gilt wieder die
  // gespeicherte Reihenfolge.
  const niches = isRecord(data.niches) ? data.niches : {};
  const candidates: string[] = [];
  for (const nicheId of NICHE_IDS) {
    for (const id of stringArray(niches[nicheId])) if (SPECIES_BY_ID.has(id) && !candidates.includes(id)) candidates.push(id);
  }
  const createsSlots = (id: string) => slotEffects(SPECIES_BY_ID.get(id)!).length > 0;
  // Alle gespeicherten Arten haben hier gelebt – auch gekürzte bleiben im Tagebuch.
  const seen = new Set<string>(candidates);
  for (const id of [...candidates.filter(createsSlots), ...candidates.filter((x) => !createsSlots(x))]) {
    const sp = SPECIES_BY_ID.get(id)!;
    if (state.niches[sp.niche].length >= nicheSlots(state.stage, state.niches)[sp.niche]) continue;
    state.niches[sp.niche].push(id);
  }
  for (const nicheId of NICHE_IDS) {
    state.niches[nicheId].sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  }
  // Sicherheitsnetz: Kürzen kann Platz-Schaffer entfernt haben – überzählige Tiere von hinten entlassen.
  for (let changed = true; changed; ) {
    changed = false;
    const slots = nicheSlots(state.stage, state.niches);
    for (const nicheId of NICHE_IDS) {
      if (state.niches[nicheId].length > slots[nicheId]) {
        state.niches[nicheId].pop();
        changed = true;
        break;
      }
    }
  }

  // Begleitpflanzen: unbekannte IDs verwerfen (Duplikate sind erlaubt), auf den Pflanzring kürzen.
  state.plants = stringArray(data.plants)
    .filter((id) => PLANTS_BY_ID.has(id))
    .slice(0, plantSlots(state.stage));

  // Offene Begegnungen: ungültige Karten entfernen, leere verwerfen, höchstens 3.
  // Pflanzen-Begegnungen („Etwas keimt“) haben Pflanzen-IDs als Karten; alles andere
  // (auch fehlender Typ) gilt als Tierbegegnung. Unbekannte Typen aus späteren
  // Versionen verlieren so ihre Karten und fallen weg.
  if (Array.isArray(data.pendingEncounters)) {
    for (const raw of data.pendingEncounters) {
      if (state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS) break;
      if (!isRecord(raw)) continue;
      const type = raw.type === 'plant' ? 'plant' : 'animal';
      // Pflanzenkarten müssen auf dieser Stufe freigeschaltet sein.
      const valid =
        type === 'plant'
          ? (id: string) => (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= state.stage
          : (id: string) => SPECIES_BY_ID.has(id);
      const cards = unique(stringArray(raw.cards).filter(valid)).slice(0, CARDS_PER_ENCOUNTER);
      if (cards.length === 0) continue;
      const encounter: PendingEncounter = {
        type,
        cards,
        rerolls: Math.max(0, Math.floor(finiteOr(raw.rerolls, 0))),
      };
      state.pendingEncounters.push(encounter);
    }
  }

  state.rngState = isValidRngState(data.rngState) ? data.rngState : normalizeSeed(lastTick);

  const meta = isRecord(data.meta) ? data.meta : {};
  state.meta.forestMemory = clampedOr(meta.forestMemory, 0, 0, MAX_FOREST_MEMORY);
  const journal = isRecord(meta.journal) ? meta.journal : {};
  state.meta.journal.species = unique(stringArray(journal.species).filter((id) => SPECIES_BY_ID.has(id)));
  for (const id of seen) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  state.meta.journal.keepsakes = unique(stringArray(journal.keepsakes));
  // Pflanzen und Lebensgemeinschaften im Tagebuch (seit Schritt 2.3, ohne neue Version):
  // fehlen sie (ältere Stände), ergänzt loadGame sie per recordDiscoveries aus dem Ökosystem.
  state.meta.journal.plants = unique(stringArray(journal.plants).filter((id) => PLANTS_BY_ID.has(id)));
  state.meta.journal.communities = unique(stringArray(journal.communities).filter((id) => COMMUNITIES_BY_ID.has(id)));

  // Seit v4: laufender Zyklus und Stammgäste (ältere Stände: migrateV3 setzt sie).
  const discovered = new Set(state.meta.journal.species);
  const cycle = isRecord(data.cycle) ? data.cycle : {};
  state.cycle = createCycle(Math.floor(clampedOr(cycle.number, 1, 1, MAX_CYCLE_NUMBER)));
  state.cycle.maxHarmony = clampedOr(cycle.maxHarmony, 0, 0, Number.MAX_VALUE);
  state.cycle.newSpecies = unique(stringArray(cycle.newSpecies).filter((id) => discovered.has(id)));
  if (typeof cycle.startedAt === 'number' && Number.isFinite(cycle.startedAt)) state.cycle.startedAt = cycle.startedAt;
  state.meta.regulars = unique(stringArray(meta.regulars).filter((id) => discovered.has(id))).slice(
    0,
    regularSlots(state.meta.forestMemory),
  );
  return state;
}

export function saveToStorage(state: GameState, storage: Storage = localStorage): void {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
  } catch {
    // Speicher voll oder blockiert (z. B. privater Modus) – Spiel läuft trotzdem weiter.
  }
}

export function loadFromStorage(now: number, storage: Storage = localStorage): LoadResult | null {
  try {
    return loadGame(storage.getItem(SAVE_KEY), now);
  } catch {
    return null;
  }
}

export function clearStorage(storage: Storage = localStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // ignorieren
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Zahl in [min, max]; NaN und Nicht-Zahlen → fallback, ±Infinity → Grenze. */
function clampedOr(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// Spielstand als Text-Code (Exportieren / Importieren)
// ---------------------------------------------------------------------------

/** Präfix des Text-Codes („Vom Samen zum Wald“, Format 1). */
export const EXPORT_PREFIX = 'VSZW1:';
/** Längere Codes werden gar nicht erst dekodiert (Schutz vor riesigen Eingaben). */
export const MAX_EXPORT_CODE_LENGTH = 200_000;

/** Warum ein Code nicht geladen werden konnte. */
export type ImportError =
  /** Leere Eingabe. */
  | 'empty'
  /** Länger als MAX_EXPORT_CODE_LENGTH. */
  | 'too-large'
  /** Kein Code dieses Spiels (Präfix, Aufbau oder Zeichen falsch). */
  | 'format'
  /** Prüfsumme passt nicht – der Code wurde unvollständig oder verändert kopiert. */
  | 'checksum'
  /** Der Inhalt ist kein brauchbarer Spielstand. */
  | 'invalid';

export type ImportResult = { ok: true; result: LoadResult } | { ok: false; error: ImportError };

/**
 * Spielstand als Text-Code: `VSZW1:<Base64url des JSON>.<Prüfsumme>`. Deterministisch
 * (gleicher Stand → gleicher Code), nur URL-sichere Zeichen, ohne Zeilenumbrüche.
 */
export function exportCode(state: GameState): string {
  return codeFromJson(serialize(state));
}

/** Kodiert einen gespeicherten Stand (JSON-Text, auch ältere Versionen) als Text-Code. */
export function codeFromJson(json: string): string {
  const payload = base64UrlEncode(new TextEncoder().encode(json));
  return `${EXPORT_PREFIX}${payload}.${checksum(payload)}`;
}

/**
 * Liest einen Text-Code und lädt ihn wie einen gespeicherten Stand (loadGame: robust,
 * mit Migration alter Versionen). Leerraum (Zeilenumbrüche beim Kopieren) wird ignoriert.
 * Die Uhr startet beim Import neu (`lastTick = now`) – ein Import bringt keine
 * Offline-Zeit. Verändert nichts außerhalb des Ergebnisses.
 */
export function importCode(code: string, now: number): ImportResult {
  const compact = code.replace(/\s+/g, '');
  if (compact.length === 0) return { ok: false, error: 'empty' };
  if (compact.length > MAX_EXPORT_CODE_LENGTH) return { ok: false, error: 'too-large' };
  if (!compact.startsWith(EXPORT_PREFIX)) return { ok: false, error: 'format' };
  const body = compact.slice(EXPORT_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'format' };
  const payload = body.slice(0, dot);
  const sum = body.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{8}$/.test(sum)) return { ok: false, error: 'format' };
  if (checksum(payload) !== sum) return { ok: false, error: 'checksum' };
  const bytes = base64UrlDecode(payload);
  if (!bytes) return { ok: false, error: 'format' };
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const result = loadGame(json, now);
  if (!result) return { ok: false, error: 'invalid' };
  result.state.lastTick = now;
  return { ok: true, result };
}

/** FNV-1a (32 Bit) über die Zeichen – einfach und deterministisch, als 8 Hex-Ziffern. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url ohne Auffüllzeichen (eigene Umsetzung, damit der Kern ohne btoa auskommt). */
function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]!;
    if (b !== undefined) out += BASE64URL[(n >> 6) & 63]!;
    if (c !== undefined) out += BASE64URL[n & 63]!;
  }
  return out;
}

/** Gegenstück zu base64UrlEncode; null bei unmöglicher Länge oder fremden Zeichen. */
function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? BASE64URL.indexOf(chunk[k]!) : 0;
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    out[o++] = (n >> 16) & 255;
    if (chunk.length > 2) out[o++] = (n >> 8) & 255;
    if (chunk.length > 3) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
