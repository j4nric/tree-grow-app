/**
 * Schnittstelle zwischen main.ts und dem Album (docs/ALBUM_UI.md, D.2 und G-25): main.ts
 * gibt Spielstand, Einstellungen und Spieleraktionen hinein, das Album ruft nur diese
 * Aktionen auf – keine Spielregeln in der Oberfläche.
 */
import type { MainTreeId } from '../../content/trees';
import type { SiteId } from '../../content/landscape';
import type { Evaluation } from '../../core/formulas';
import type { GameState } from '../../core/state';
import type { UpgradeTarget } from '../../core/upgrades';
import type { EncounterCallbacks } from '../encounter-cards';
import type { Preferences } from '../preferences';
import type { SaveTransferCallbacks } from '../save-transfer';
import type { WildwechselMark } from '../wildwechsel-view';

/** Spieleraktionen; main.ts führt sie über core/tick.ts aus (act). */
export interface AlbumActions {
  /** Kartenwahl der vordersten Begegnung: Wählen, Ablehnen, Neu würfeln. */
  encounter: EncounterCallbacks;
  /** „🌱 Säen“ (DESIGN_V2.md 27.6): öffnet eine Aussaat bzw. die offene in U:Begegnung. */
  sow(): void;
  /** Kauft den nächsten Rang einer Pflegemaßnahme; `true` bei Erfolg. */
  buyCare(id: string): boolean | void;
  /** Ausbau (DESIGN_V2.md 28.4): eine Stufe einer Nische bzw. eines Baumteils. */
  upgrade(target: UpgradeTarget): void;
  newCycle(mainTree: MainTreeId, site?: SiteId): void;
  buildCorridor(id: string): void;
  toggleRegular(speciesId: string): void;
  /** „Spielstand löschen“ (schon bestätigt). */
  resetGame(): void;
}

export interface AlbumDeps {
  /** Vorhandenes Szenen-Canvas – wandert ins Polaroid. */
  canvas: HTMLCanvasElement;
  preferences: Preferences;
  /** Aktueller Spielstand (wird bei Löschen und Import ersetzt, darum als Funktion). */
  state(): GameState;
  actions: AlbumActions;
  saveTransfer: SaveTransferCallbacks;
  /** Neues Spiel ohne gespeicherten Stand: Hinweis „Neu hier?“. */
  newGame: boolean;
  /** Heutiger Tag für die Tagesziele („JJJJ-MM-TT“, '' = aus). */
  today(): string;
  /** Wildwechsel-Weg der vordersten Begegnung (DESIGN_V2.md 24.6), null = keiner. */
  encounterMark(): WildwechselMark | null;
  /** Meldung „Landschaft freigeschaltet“, falls fällig (merkt sie im Spielstand), sonst ''. */
  takeLandscapeAnnouncement(): string;
  /**
   * Ökosystem neu ausgewertet (nach Änderungen): `rebuilt` = Auswertung oder gesehene
   * Ereignisse sind neu. main.ts baut dann Tiere und Pflanzen der Szene neu.
   */
  ecosystemChanged(evaluation: Readonly<Evaluation>, rebuilt: boolean): void;
}

/** Was im selben Moment neu aufgebaut werden muss (früher ecoDirty, encounterDirty …). */
export type AlbumPart = 'eco' | 'encounter' | 'picker' | 'season';
