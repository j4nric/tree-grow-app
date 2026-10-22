/**
 * Messung der geplanten Hauptbäume je Waldtyp (docs/DESIGN_V2.md 25, Phase 7) – BEVOR sie in
 * src/content/trees.ts stehen. Die Kandidaten werden nur für die Messung in MAIN_TREES_BY_ID
 * eingetragen (dieselbe Map, die evaluate und isTreeUnlocked lesen; `unlockPlant: null`, also
 * ohne Freischaltung). So rechnet der Simulator mit der echten Logik, ohne dass sich Spielstand,
 * Typen oder Inhalte ändern.
 *
 * Wenn der core-engineer die Arten in trees.ts aufnimmt (25.6), entfällt diese Datei: Dann misst
 * der Test „Waldtypen im Vergleich“ (tests/landscape-balance.test.ts) die neuen Leitbäume direkt.
 *
 * Ausführen: SIM_SITE_TREES=1 npx vitest run tests/site-trees-balance.test.ts --silent=false  (~1 min)
 */
import type { MainTree, MainTreeId } from '../src/content/trees';
import { MAIN_TREES_BY_ID } from '../src/content/trees';

/** Kandidaten wie in DESIGN_V2.md 25.3 (Texte gekürzt; die Messung braucht nur die Wirkung). */
export const CANDIDATE_TREES: readonly MainTree[] = [
  {
    id: 'fir' as MainTreeId, name: 'Weißtanne', icon: '🎄', fruit: 'Tannensamen',
    text: 'Geduldig wächst sie im Schatten der Buchen – und überragt sie am Ende alle.',
    summary: 'Schattenbaum · winterfest · Nadeln · Vögel +10 % 😊 · +1 Platz Stamm & Rinde · ab Alter Baum −1 ☀️ · keine Nüsse',
    unlockPlant: null, unlockHint: '',
    tags: ['laub', 'wurzeln', 'nadeln'], nutsFromStage: null,
    traits: [
      { minStage: 0, effect: { kind: 'happiness', genus: 'birds', points: 10 } },
      { minStage: 3, effect: { kind: 'slot', niche: 'bark', amount: 1 } },
      { minStage: 4, effect: { kind: 'light', amount: -1 } },
    ],
    winterHardy: true,
  },
  {
    id: 'alder' as MainTreeId, name: 'Schwarzerle', icon: '🌿', fruit: 'Erlensamen',
    text: 'Sie steht mit den Füßen im Wasser – und ihre Wurzeln düngen den Boden.',
    summary: 'Nassbaum · Amphibien +10 % 😊 · Blumen +15 % 🌿 · ab Junger Baum +1 Platz Waldtümpel · keine Nüsse',
    unlockPlant: null, unlockHint: '',
    tags: ['laub', 'wurzeln'], nutsFromStage: null,
    traits: [
      { minStage: 0, effect: { kind: 'happiness', genus: 'amphibians', points: 10 } },
      { minStage: 0, effect: { kind: 'groupGrowth', group: 'flowers', pct: 15 } },
      { minStage: 3, effect: { kind: 'slot', niche: 'pond', amount: 1 } },
    ],
    winterHardy: false,
  },
];

/** Trägt die Kandidaten für die Messung ein (idempotent). Nur in Simulationen aufrufen. */
export function registerCandidateTrees(): void {
  const map = MAIN_TREES_BY_ID as Map<MainTreeId, MainTree>;
  for (const tree of CANDIDATE_TREES) map.set(tree.id, tree);
}
