import { describe, expect, it } from 'vitest';
import type { SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { ANCIENT_STAGE } from '../src/core/landscape';
import { createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { previewNewCycle } from '../src/core/tick';
import { createAlbumTarget, isOtherTarget, resolveTarget, siteButtonExtra } from '../src/ui/album/cycle-target';
import {
  corridorBuildLabel,
  landscapePageMeta,
  siteAnnouncement,
  siteChoiceView,
  siteDiaryRows,
  targetLine,
} from '../src/ui/album/pages/landscape-page-view';
import { toJournalLandscapeView } from '../src/ui/journal-landscape-view';
import { toLandscapeMapView } from '../src/ui/landscape-view';
import { stateAt } from './helpers';

/**
 * Reiter „Landschaft“ und U:Standort (docs/ALBUM_UI.md, B.5 und A.10): Kennzahl im Kopf,
 * gemeinsames Ziel des nächsten Zyklus (`albumTarget`, D.2), Knopf „Als Ziel wählen“,
 * Bau-Knopf und Tagebuch-Zeilen – reine Ansichtslogik ohne DOM.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

function withLandscape(
  stage: number,
  opts: { own?: number; active?: SiteId; sites?: LandscapeSite[]; corridors?: string[]; free?: string[] } = {},
): GameState {
  const state = stateAt(stage, [], 3);
  state.meta.forestMemory = opts.own ?? 300;
  state.meta.achievements.push('ancient-forest');
  state.meta.landscape = {
    active: opts.active ?? 'home',
    sites: opts.sites ?? [{ ...createSite('home'), ancient: true }],
    corridors: opts.corridors ?? [],
    freeCorridors: opts.free ?? [],
    announced: true,
  };
  return state;
}

const mapOf = (state: GameState) => toLandscapeMapView(state, previewNewCycle(state))!;

describe('Reiter „Landschaft“: Kopf und Ziel', () => {
  it('Kennzahl im Kopf ist die Hähersaat; ohne Karte leer', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    expect(landscapePageMeta(map)).toBe(`🪶 ${map.available} Hähersaat`);
    expect(landscapePageMeta({ available: 1234 })).toBe('🪶 1.234 Hähersaat');
    expect(landscapePageMeta(null)).toBe('');
  });

  it('Ziel: gewählt und wählbar, sonst der aktive Wald; ohne Karte keins', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    expect(resolveTarget(map, null)).toBe('home');
    expect(resolveTarget(map, 'floodplain')).toBe('floodplain');
    // Nicht neben dem Heimatwald gibt es nichts – alle sechs liegen am Heimatwald; gesperrt im Hain:
    const grove = mapOf(withLandscape(GROVE));
    expect(grove.sites.find((s) => s.id === 'floodplain')!.action).toBeNull();
    expect(resolveTarget(grove, 'floodplain')).toBe('home');
    expect(resolveTarget(null, 'floodplain')).toBeNull();
  });

  it('Zeile unter der Karte nennt das Ziel; ohne möglichen Zyklus keine', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    expect(targetLine(map, 'home')).toBe('Ziel: 🌳 Heimatwald – der nächste Baum keimt hier.');
    expect(targetLine(map, 'floodplain')).toContain('neuer Wald für 3 🪶');
    const early = withLandscape(GROVE - 2);
    const locked = toLandscapeMapView(early, previewNewCycle(early));
    expect(locked?.allowed).toBe(false);
    expect(targetLine(locked!, 'home')).toBeNull();
  });

  it('Knopf auf der Karte: Zusatz „Ziel des nächsten Zyklus“ nur für ein anderes Ziel', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    const home = map.sites.find((s) => s.id === 'home')!;
    const flood = map.sites.find((s) => s.id === 'floodplain')!;
    expect(siteButtonExtra(map, flood, 'floodplain')).toBe(', Ziel des nächsten Zyklus');
    expect(siteButtonExtra(map, flood, 'home')).toBe('');
    // Der aktive Wald ist „hier“, nie ein anderes Ziel.
    expect(isOtherTarget(map, home, 'home')).toBe(false);
    expect(isOtherTarget({ allowed: false }, flood, 'floodplain')).toBe(false);
  });
});

describe('U:Standort: „Als Ziel wählen“', () => {
  it('wählbarer Standort: Knopf, gedrückt sobald er das Ziel ist', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    const flood = map.sites.find((s) => s.id === 'floodplain')!;
    const open = siteChoiceView(map, flood, 'home');
    expect(open).toMatchObject({ visible: true, chosen: false, label: 'Als Ziel wählen' });
    expect(open.hint).toBe('Der nächste Zyklus gründet hier einen neuen Wald (3 🪶).');
    const chosen = siteChoiceView(map, flood, 'floodplain');
    expect(chosen).toMatchObject({ visible: true, chosen: true, label: '✓ Ziel des nächsten Zyklus' });
    expect(chosen.hint).toContain('doch hier bleiben');
    expect(siteAnnouncement(map, flood, 'floodplain')).toBe('Auwald am Fluss: Ziel des nächsten Zyklus.');
  });

  it('Wechsel in einen gegründeten Wald heißt „wechselt hierher“', () => {
    const home: LandscapeSite = { ...createSite('home'), memory: 320, ancient: true };
    const map = mapOf(withLandscape(GROVE, { own: 40, active: 'floodplain', sites: [home, createSite('floodplain')], corridors: ['home-floodplain'], free: ['home-floodplain'] }));
    const site = map.sites.find((s) => s.id === 'home')!;
    expect(siteChoiceView(map, site, 'floodplain').hint).toBe('Der nächste Zyklus wechselt hierher.');
  });

  it('aktiver Wald und gesperrte Standorte: kein Knopf, aber der Grund als Ansage', () => {
    const map = mapOf(withLandscape(GROVE));
    const home = map.sites.find((s) => s.id === 'home')!;
    const mountain = map.sites.find((s) => s.id === 'mountain')!;
    expect(siteChoiceView(map, home, 'home')).toMatchObject({ visible: false, chosen: false, hint: '' });
    expect(siteChoiceView(map, mountain, 'home').visible).toBe(false);
    expect(siteAnnouncement(map, mountain, 'home')).toContain('Nur aus dem Urwald');
  });
});

describe('Korridore und Tagebuch', () => {
  it('Bau-Knopf: Kosten, scharf mit Bestätigung', () => {
    expect(corridorBuildLabel({ name: 'Altwasser', cost: 3 }, false)).toEqual({ text: 'Bauen · 3 🪶', label: 'Altwasser bauen, 3 Hähersaat' });
    expect(corridorBuildLabel({ name: 'Altwasser', cost: 3 }, true).label).toBe('Altwasser wirklich bauen? Zum Bestätigen erneut klicken');
  });

  it('U:Standort zeigt aus dem Tagebuch nur Stammgäste und Tiere – nur für gegründete Wälder', () => {
    const state = withLandscape(GROVE, {
      own: 120,
      active: 'floodplain',
      sites: [{ ...createSite('home'), memory: 400, ancient: true, regulars: ['robin'], fauna: ['robin'] }, createSite('floodplain')],
      corridors: ['home-floodplain'],
      free: ['home-floodplain'],
    });
    state.meta.journal.species = ['robin'];
    const journal = toJournalLandscapeView(state);
    expect(siteDiaryRows(journal, 'home').map((r) => r.key)).toEqual(['regulars', 'fauna']);
    expect(siteDiaryRows(journal, 'home')[0]!.value).toBe('Rotkehlchen');
    expect(siteDiaryRows(journal, 'mountain')).toEqual([]);
    expect(siteDiaryRows(null, 'home')).toEqual([]);
  });
});

describe('Gemeinsames Ziel (albumTarget, D.2)', () => {
  it('wählen, melden, zurück auf „hier“ – und nach einem Neuen Zyklus wieder „hier“', () => {
    const target = createAlbumTarget();
    const changes: SiteId[] = [];
    target.onChange((id) => changes.push(id));
    expect(target.view()).toBeNull();
    expect(target.target()).toBeNull();
    const state = withLandscape(ANCIENT_STAGE);
    target.update(state);
    expect(target.view()).not.toBeNull();
    expect(target.target()).toBe('home');
    target.choose('floodplain');
    expect(target.target()).toBe('floodplain');
    // Gleiche Lage: Ziel bleibt.
    target.update(state);
    expect(target.target()).toBe('floodplain');
    target.choose(null);
    expect(target.target()).toBe('home');
    target.choose('carr');
    state.cycle.number += 1;
    target.update(state);
    expect(target.target()).toBe('home');
    expect(changes).toEqual(['home', 'floodplain', 'home', 'carr', 'home']);
  });

  it('nicht wählbare Standorte werden kein Ziel', () => {
    const target = createAlbumTarget();
    target.update(withLandscape(GROVE));
    target.choose('mountain');
    expect(target.target()).toBe('home');
  });

  it('Neuer Zyklus bzw. anderer Wald nimmt offene Bau-Bestätigungen zurück (wie früher map.reset)', () => {
    const target = createAlbumTarget();
    let n = 0;
    target.onDisarm(() => n++);
    const state = withLandscape(ANCIENT_STAGE);
    target.update(state);
    expect(n).toBe(0);
    target.update(state);
    expect(n).toBe(0);
    state.cycle.number += 1;
    target.update(state);
    expect(n).toBe(1);
    state.meta.landscape!.active = 'floodplain';
    state.meta.landscape!.sites.push(createSite('floodplain'));
    target.update(state);
    expect(n).toBe(2);
  });

  it('disarm erreicht alle Seiten (offene Bestätigungen)', () => {
    const target = createAlbumTarget();
    let n = 0;
    target.onDisarm(() => n++);
    target.onDisarm(() => n++);
    target.disarm();
    expect(n).toBe(2);
  });
});
