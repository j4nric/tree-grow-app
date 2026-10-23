# Album-Oberfläche – Umsetzungskonzept

Die ganze Oberfläche wird als **Sammelalbum** neu gestaltet, als Naturtagebuch zum Einkleben.
Grundlage sind das gewählte Mockup „G · Sammelalbum hoch“ sowie die Detail-Mockups
„Album-Prototyp“ (mobil, Umblättern, Haftnotiz) und „Album-Desktop“ (Doppelseite). Die
Entscheidungen des Nutzers (Abschnitt 0) stehen fest. Dieses Dokument legt fest, **wo jedes
heutige Element hinkommt**, wie die Bedienung funktioniert, wie es technisch gebaut wird und
in welcher Reihenfolge die Agenten es umsetzen.

Gliederung:

- 0 Festgelegte Entscheidungen (Kurzfassung)
- A Bestandsaufnahme und Zuordnung
- B Seitenstruktur je Reiter
- C Interaktionsmodell
- D Technische Architektur
- E Teststrategie
- F Umsetzungsplan
- G Risiken und eigene Entscheidungen

---

## 0. Festgelegte Entscheidungen (Kurzfassung)

1. **Desktop und Tablet im Querformat:** aufgeschlagenes Buch als Doppelseite. Links das
   Polaroid mit Vorräten und Stufe, rechts die aktuelle Seite mit Reitern. **Mobil
   (Hochformat):** eine Seite wie im Mockup.
2. **Zwei Arten von Erklärungen.** Kurze Erklärungen erscheinen als **Haftnotiz** über der
   Seite. Ausführliches öffnet sich als **Unterseite durch Umblättern**. Es gibt höchstens
   zwei Ebenen. Zurück geht per Wischen, Zurück-Knopf (Lesezeichen) oder Escape.
3. **Umblättern** ist eine leichte 3D-Drehung (`rotateY`). Bei `prefers-reduced-motion`
   wird stattdessen überblendet. Es gibt keinen Seiten-Curl.
4. **Polaroid antippen:** Die Szene geht auf volle Größe, mit Zoom und Kamera wie heute.
   „Schließen“ führt zurück ins Album.
5. **Begegnungen** liegen als gestapelte Notizzettel bereit („2 Zettel“). Neue Zettel
   wackeln kurz. Erst Antippen öffnet die Wahl. Die Regeln bleiben gleich (Stapel voll,
   automatisch ablehnen).
6. **Reiter:** Nischen, Arten, Pflege, Ziele, Landschaft. Landschaft erscheint erst nach der
   Freischaltung. Der **Buchumschlag** (Menü) enthält Einstellungen, Spielanleitung,
   Konto/Sync und Export/Import. Alles andere sind Unterseiten.
7. **Tier-Sticker** kommen aus den vorhandenen Renderer-Zeichnungen: einmal auf ein kleines
   Canvas gezeichnet und zwischengespeichert. Es gibt keine neuen Illustrationen.
8. **Schriften** Caveat und Nunito liegen selbst gehostet bei (offline, PWA). Caveat nur für
   Überschriften und Zahlen.
9. **Das Papier bleibt immer hell.** Nacht und Wetter zeigt nur das Polaroid.
10. **Umstellung auf einen Schlag** ohne Beta-Schalter. Entwickelt wird auf dem Sammel-Branch
    `claude/album-ui`. Gemergt wird erst, wenn alles fertig und getestet ist.
11. **Barrierefreiheit** steht vorerst nicht im Fokus. Was es heute gibt (echte Knöpfe,
    Tastatur, sichtbarer Fokus), darf nicht kaputtgehen. Zusätzlichen Aufwand gibt es dafür
    nicht.

### Begriffe

| Begriff | Bedeutung |
|---|---|
| **Album / Buch** | die ganze Oberfläche (`Book`) |
| **Doppelseite** | Desktop- und Querformat-Ansicht: linke Seite (Polaroid) und rechte Seite (Reiter) |
| **Reiterseite** | Grundseite eines Reiters (Ebene 0) |
| **Unterseite** | durch Umblättern geöffnete Detailseite (Ebene 1, höchstens Ebene 2) |
| **Haftnotiz** | kurze Erklärung, die über der Seite aufklappt (kein Umblättern) |
| **Zettel** | Begegnungen (Stapel) sowie längere Meldungen und der Rückkehr-Bericht |
| **Stempel** | kurze Meldung, ersetzt den Toast |
| **Etikett** | gestricheltes Vorratsschild (Wachstum, Samen, Harmonie) |
| **Sticker** | runder Aufkleber für Tiere, Pflanzen und Erfolge |
| **Banderole** | dauerhaftes Band über dem Album für Update-Hinweis und neueren Spielstand |
| **Buchumschlag** | Menü (☰ Umschlag) |
| **Vollbild** | die vergrößerte Szene aus dem Polaroid |

---

## A. Bestandsaufnahme und Zuordnung

Quelle ist der Stand `origin/main` mit Phase 7, 1c. Durchgesehen wurden `index.html`,
`src/main.ts`, `src/ui/*.ts` und `src/style.css`.

**Ortskürzel:**

| Kürzel | Ort |
|---|---|
| **P** | Polaroid oder linke Seite (Etiketten, Stufenleiste) |
| **V** | Vollbild der Szene |
| **R:Name** | Reiterseite |
| **U:Name** | Unterseite (Umblättern) |
| **H** | Haftnotiz |
| **B** | Buchumschlag (Menü) |
| **Z** | Zettel |
| **S** | Stempel |
| **G** | global (Band, Ebene über allem, unsichtbar) |

Spalte „heute“: Datei und, falls vorhanden, `data-ref`.

### A.1 Rahmen, Szene und globale Elemente

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 1 | Titel „Vom Samen zum Wald“ (h1, Fokusziel nach dem Schließen von Dialogen) | index.html `.panel h1` | B / G | Titel auf dem Buchumschlag; im Kopf „Naturtagebuch · ‹Waldname›“ (Caveat). Als Fokusziel dient die Überschrift der aktuellen Seite. |
| 2 | Zweispaltiges Layout Szene + Seitenleiste; mobil Szene 45vh, darunter die Leiste | index.html, style.css `.layout` | G | `Book` mit Doppelseite bzw. Einzelseite (B.0) |
| 3 | Szenen-Canvas `#scene` mit Game Loop und `CanvasSizer` | index.html, main.ts | P | Dasselbe Canvas liegt im Polaroid (D.3) |
| 4 | Stufen-Banner (Titel, Text, Zusatzzeile Erfolg, längere Anzeige) | `#stage-banner`, main.ts `showBanner` | P / S | großer Stempel schräg auf dem Polaroid: „Neue Stufe: Junger Baum“ mit Erfolgszeile; ausgelöst vom selben `stageBannerView` |
| 5 | Szenen-Dock mit Begegnungsstapel (Anzahl, Symbol der vordersten Begegnung, mobil schwebend) | `#scene-dock`, encounter-stack.ts `encounter-stack` | Z | Zettelstapel (A.6) |
| 6 | Toast (role=status, Dauer nach Textlänge, Kurzfassung mobil `.brief`) | `#toast`, main.ts `showToast` | S / Z | Stempelschicht (C.5) |
| 7 | Lage des Toasts mobil (weicht Update-Hinweis, Stapel und Banner aus) | toast-place.ts | – | **entfällt.** Stempel haben einen festen Platz oben, der Zettelstapel liegt unten. Es gibt nichts mehr auszuweichen. |
| 8 | Unsichtbare Statuszeile für Screenreader | `#live-status` | G | bleibt unverändert |
| 9 | Schwebende Zahlen und Hinweise („+144 🌰“, „−30 🌰“, „🌱 Waldmeister“, Pflege-Bestätigung, Auto-Ablehnen-Notiz) | feedback.ts `createFloatLayer` | G | bleibt, in Caveat und Tintenfarbe; Ziel ist das Samen-Etikett (`data-ref="seeds"`) |
| 10 | „Spielstand löschen“ mit zweitem Klick zur Bestätigung | index.html `#reset`, main.ts `onReset` | B | Umschlag → „Spielstand“ (B.7) |
| 11 | Banner „neuerer Spielstand“ (role=alert, „Seite neu laden“) | main.ts `freezeForNewerSave`, `newer-save-banner` | G | rote Banderole quer über dem Album, dauerhaft |
| 12 | PWA-Hinweis „Neue Version verfügbar – neu laden“ bzw. „… aktiv – bitte neu laden“, × für später | pwa.ts `update-hint` | G | gelbe Banderole oben (Washi-Optik); die Logik in pwa.ts bleibt |
| 13 | Kamera-Leiste + / − / ⟲ | camera-input.ts `zoom-in`, `zoom-out`, `zoom-reset` | V | nur im Vollbild, dazu „✕ Zurück ins Album“ |
| 14 | Kamera-Gesten: Pinch, Ziehen, Wisch-Auslauf, Mausrad (mit Strg), Tastatur + − Pfeile 0; `touch-action` je nach Zoom | camera-input.ts, camera-gestures.ts | V | nur im Vollbild. Im Polaroid gibt es keine Kamera (G-15). |
| 15 | Tippen auf ein Tier in der Szene öffnet Tierdetails (Treffer-Test) | main.ts `onAnimalTap` | V → H → U | Im Vollbild öffnet ein Tipp eine Haftnotiz zum Tier mit „Im Album ansehen“. Das schließt das Vollbild und öffnet U:Tier (G-16). |
| 16 | Kamera-Ansicht für die Sitzung merken | camera-input.ts `loadCameraView` | V | bleibt |
| 17 | Klang: Kulisse sowie die Signale `encounter`, `achievement`, `stage` | sound.ts, sound-plan.ts | – | bleibt; die Einstellung liegt im Umschlag. Kein Blätter-Geräusch (G-24). |
| 18 | Bewegung reduzieren: `data-motion` am body | help.ts `initPreferences` | G | bleibt; steuert auch Umblättern und Wackeln |
| 19 | Fokus bei geschlossenen Dialogen nicht auf `body` stranden lassen | main.ts | G | Regel bleibt: Nach dem Umblättern bekommt die Überschrift der neuen Seite den Fokus, nach „Zurück“ der auslösende Knopf. |
| 20 | Ereignisse beim Seitenwechsel: Sichtbarkeit (speichern, nachrechnen), `beforeunload`, `storage`-Ereignis | main.ts | – | unverändert (keine UI) |

### A.2 Kopf der Seitenleiste: Stufe, Raten, Jahreszeit, Wetter

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 21 | „Stufe: Junger Baum“ | ecosystem-panel.ts `stage` | P | Bildunterschrift des Polaroids (Caveat 26/30 px) und markierte Stufe in der Stufenleiste. `data-ref="stage"` bleibt an der Bildunterschrift. |
| 22 | Fortschrittsbalken zum nächsten Wegpunkt (progressbar) | ecosystem-panel.ts `.eco-progress` | P | **Stufenleiste** mit allen 8 Stufen (Samen … Urwald) und Balken (Desktop-Mockup); mobil als schmale Leiste unter den Etiketten |
| 23 | Fortschrittshinweis (Countdown bzw. „N Begegnungen warten“) | `progress-hint` | P | kleine Zeile unter der Stufenleiste |
| 24 | Knopf „🐾 N Begegnungen warten – ansehen“ | `pending-encounters` | – | **entfällt.** Der Zettelstapel ist immer sichtbar (mobil fest unten rechts, Desktop im Kopf). |
| 25 | Kennzahl Wachstum mit „mit ⚖️ ×1,24“, lange Zahlen kleiner | `growth-rate` | P + H | Etikett „Wachstum“ (Zahl in Caveat). Tipp → H mit Erklärung und Harmonie-Faktor. |
| 26 | Kennzahl Samen mit „+3,2/s“ | `seeds` | P | Etikett „Samen · +3,2/s“ (Desktop-Mockup); mobil steht die Rate in der H |
| 27 | Kennzahl Harmonie mit Harmoniestufe („ausgewogen“) und Aufploppen beim Steigen | `harmony` | P + H | Etikett „Harmonie ⓘ“ mit rotem Strichrand. Tipp → H wie im Prototyp (Text, „jetzt: Wachstum ×1,32“, Knopf „Verstanden“, dazu „Mehr ›“ → U:Harmonie) |
| 28 | 🌙 an Wachstum und Samen, solange eine Nachtwirkung gilt (Titel, Screenreader-Text) | `growth-rate-night`, `seeds-night` | P + H | kleines 🌙 in der Etikett-Ecke; der Text dazu steht in der H des Etiketts |
| 29 | Jahreszeit-Abzeichen (Symbol, Name, Restzeit), klappt die Wirkungen auf | season-badge.ts `season`, `season-effects` | P + H | Bildunterschrift „Frühling · wechselhaft · 2:58“. Tipp auf „Frühling“ → H mit den Wirkungen. |
| 30 | Wetter-Abzeichen mit Wirkung; Details mit Stimmung, Wirkung heute, Dämpfung, Tipp, Vorhersage, Tag/Nacht, Hinweis „Immer Tag“; Escape schließt | weather-badge.ts `weather`, `weather-details`, `weather-*` | P + H | Tipp auf „wechselhaft“ → H mit allen Zeilen. Die `data-ref` der Zeilen bleiben. |

### A.3 Ökosystem: Harmonie, Gemeinschaften, Nahrungsnetz

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 31 | „Woraus sich die Harmonie zusammensetzt“ (Teile mit Ton und Summe) | ecosystem-panel.ts `.eco-harmony` | U:Harmonie | erster Abschnitt der Unterseite „Harmonie“ |
| 32 | Lebensgemeinschaften live: Zusammenfassung „+8 ⚖️“, Zeilen aktiv / fast / offen, Fortschrittsbalken, „???“ für unentdeckte, Aufleuchten beim Entstehen | `communities`, `communities-summary` | U:Harmonie | zweiter Abschnitt der U:Harmonie. Auf R:Nischen steht dazu ein Lesezeichen-Link „Lebensgemeinschaften · +8 ⚖️ ›“. |
| 33 | Nahrungsnetz: Zusammenfassung, Einleitung, je Beute Zustand (Text und Symbol), „Beute · Bestand“, „Jäger · hält klein“, Hinweis (Massenjahr), Leertext | `food-web`, `food-web-*` | U:Nahrungsnetz | eigene Unterseite. Link von R:Nischen („Nahrungsnetz ›“) und aus U:Tier, Abschnitt „Räuber und Beute“. |

### A.4 Gattungen, Nischen, Lebensräume, Pflanzring

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 34 | Gattungsleiste: Knopf je Gattung mit Zähler, Schwellen-Pips, aktiv/leer, Aufleuchten bei neuer Schwelle | ecosystem-panel.ts `.family-chip` | R:Nischen | Reihe kleiner Abzeichen oben auf R:Nischen (Emoji im Kreis, Pips als Punkte) |
| 35 | Gattungs-Detailzeile (aria-live) beim Antippen eines Abzeichens | `.family-detail` | H | H am Abzeichen |
| 36 | Nischenliste: Titel mit Symbol, „2/3 Plätze“, „voll“ | `.niche`, `data-niche` | R:Nischen | Stickerreihe (Spalte für den Namen, rechts die Sticker); Kopfzeile der Seite „9 von 14 Plätzen“ |
| 37 | Hinweis bei verschlossener oder leerer Nische („öffnet beim Alten Baum“) | `.niche-hint` | R:Nischen (+H) | grauer Nischenname und Handschrift-Zeile; ein langer Text wird in einer H gekürzt |
| 38 | „Zur Pflege“ an verschlossenen Nischen (Waldtümpel); öffnet die Pflege bei der Maßnahme | `niche-care-link`, `carePanel.reveal` | R:Nischen → R:Pflege | Link-Knopf; wechselt zum Reiter Pflege, scrollt zur Maßnahme und lässt sie aufleuchten |
| 39 | Tier-Kachel: Gattungssymbol, Name, Zufriedenheit % und Stimmung (gekürzt, Tooltip), Ring `--h`, Seltenheit, Gattungsfarbe, Ankunftsanimation | `.slot.filled`, `data-species` | R:Nischen | **Sticker** mit Tierzeichnung (D.4). Zufriedenheit als Bogen im weißen Rand, Seltenheit über Randfarbe und Edelstein, Name klein darunter. Ankommen = „Einkleben“-Animation. `data-species` bleibt. |
| 40 | Kachel ist ein Knopf und öffnet die Tierdetails | `.slot-open` | U:Tier | Tipp auf den Sticker blättert zu U:Tier um |
| 41 | Bestand der Beute („Bestand reichlich“) | `.slot-stock` | U:Tier | im Kopf von U:Tier, dazu ein farbiger Punkt am Sticker (niedrig/gut/hoch) |
| 42 | 🌙 am Ring für nachtaktive Arten, leuchtet bei aktiver Nachtwirkung | `.slot-night` | R:Nischen | 🌙-Eckchen am Sticker |
| 43 | Durchreisender Gast in der Nische (nicht klickbar, „zu Gast“) | `.slot.visitor` | R:Nischen + H | Sticker mit farbigem Strichrand; Tipp → H „zu Gast, zieht weiter …“ |
| 44 | Freier Platz („frei“) | `.slot.empty` | R:Nischen | gestrichelter leerer Kreis wie im Mockup |
| 45 | Lebensräume Waldwiese, Totholzhaufen, Trockenmauer und Waldtümpel (Nischen, die über die Pflege öffnen) | `nicheViews`, `data-niche` | R:Nischen | eigener Abschnitt „Lebensräume“ unter den Baum-Nischen, gleiche Stickerreihen |
| 46 | Pflanzring-Titel mit „x/y Plätze“, „voll“ | `plant-slots` | R:Nischen | Abschnitt „Pflanzring“ |
| 47 | Pflanzring verschlossen: Hinweis | `.plant-ring .niche-hint` | R:Nischen | Handschrift-Zeile |
| 48 | Versorgung Licht und Wasser: Text, zwei Balken, Screenreader-Detail | `plant-supply`, `.plant-meter` | R:Nischen | zwei Messbänder im Washi-Stil mit Zahl |
| 49 | Mangel-Hinweis | `plant-shortage` | R:Nischen | rote Handschrift-Notiz |
| 50 | Pflanzen-Kacheln (Name, Gruppe, Ankunft) | `.plant-slot`, `data-plant` | R:Nischen | Pflanzen-Sticker mit Gruppen-Emoji (G-17) |
| 51 | Gruppenzählung (Bäume/Sträucher/Blumen/Moose) mit Beschriftung | `.plant-groups` | R:Nischen | kleine Etiketten „🌳 2 · 🌿 1 …“ |
| 52 | Knopf „🌱 Pflanze setzen“ mit Kosten, bezahlbar markiert | `plant-open` | R:Nischen → U:Pflanze | blättert zu U:Pflanze setzen um |
| 53 | Pflanz-Hinweis | `plant-hint` | R:Nischen | Zeile unter dem Knopf |

### A.5 Tierdetails (heute Dialog)

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 54 | Dialog „Tierdetails“ (modal, Escape, Fokus zurück, Inhalt nur bei Änderung neu) | animal-detail-dialog.ts `animal-detail` | U:Tier | Unterseite; das Lesezeichen „‹ Nischen“ (bzw. Name der Herkunft) dient als Zurück |
| 55 | Band: Gattung und Seltenheit (Edelstein) | `.card-band` | U:Tier | Kopf: großer Sticker 104 px, „Vögel · Stamm & Rinde“, Pille „selten“ |
| 56 | Kopf: Name, Nische, Zufriedenheit %, Stimmungstext | `detail-happiness` | U:Tier | Kopf (Name Caveat 38 px); Zufriedenheit als Zahl und Satz |
| 57 | „Beitrag gerade“ mit Hinweis | `detail-contribution`, `detail-contribution-note` | U:Tier | Abschnitt „Was er bewirkt“ (Pillen) |
| 58 | „Zufriedenheit – warum?“: Futter und Wünsche, weitere Einflüsse | `detail-reasons` | U:Tier | Abschnitt „Was er braucht“ (✓ / ~ / ✗ wie im Prototyp) |
| 59 | „Räuber und Beute“ | `detail-predation` | U:Tier | eigener Abschnitt, Link „Nahrungsnetz ›“ (das ist Ebene 2) |
| 60 | „Wirkungen“ | `detail-effects` | U:Tier | Teil von „Was er bewirkt“ |
| 61 | „Fähigkeiten“ | `detail-abilities` | U:Tier | Teil von „Was er bewirkt“ |
| 62 | „Lebensgemeinschaften“ der Art | `detail-communities` | U:Tier | eigener kurzer Abschnitt |
| 63 | Stammgast-Text | `detail-regular` | U:Tier | Zeile und **Stammgast-Schalter** ★ (dieselbe Aktion `toggleRegular` wie im Tagebuch) |
| 64 | Beschreibung (Flavor) | `.card-flavor` | U:Tier | gelbe Notiz zur Art in Caveat (Prototyp) |
| 65 | Dialog schließt, wenn die Art auszieht (Fokus an die Nische) | main.ts `refreshAnimalDetail` | U:Tier | Die Seite bleibt offen und zeigt „ist ausgezogen“ mit Tagebuchangaben. Kein automatisches Zurückblättern (G-11). |
| 66 | Hinweisfeld im Dialog | `.encounter-notice` | S | Stempelschicht |

### A.6 Begegnungen und Pflanzenwahl

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 67 | Stapel: Zahl, Symbol der vordersten Begegnung (`stackIcon`), öffnet auf Wunsch, schwebt mobil | encounter-stack.ts | Z | **Zettelstapel** „2 Zettel: Besuch wartet!“ (Text aus `waitingText`, Symbol bleibt). Neue Zettel wackeln. `data-ref="encounter-stack"` bleibt. |
| 68 | Dialog „Kartenwahl“: Art, Titel, Untertitel, großes Symbol und Eckdaten (Ereignis/Gast), Warteschlange mit Pips | encounter-dialog.ts | U:Begegnung | Unterseite mit Zettel-Optik im Kopf |
| 69 | Tierkarte: Gattungsband, Seltenheit, Name, Nische, Vorschau-Chips, Bedingungen, Wirkungen, Gemeinschafts-Hinweise (`card-communities`), Hinweis (`card-note`), Wildwechsel-Zeile (1c) | encounter-dialog.ts | U:Begegnung | Karten als „Polaroid-Kärtchen“ mit Sticker; Knopf „Einkleben“ statt „Wählen“ (Text aus dem View-Model) |
| 70 | Ersetzen bei voller Nische („Wer zieht weiter?“, bevorzugte Option, Sperrgrund) | encounter-dialog.ts | U:Begegnung | unverändert in der Karte |
| 71 | Pflanzenbegegnung („Etwas keimt …“) mit eigenen Fehlertexten | adapters.ts, main.ts | U:Begegnung | gleiche Seite |
| 72 | Ereignis mit Optionen | `toEventView` | U:Begegnung | Optionen als Karten |
| 73 | Durchreisender Gast: bewirten / ziehen lassen | `toVisitorView` | U:Begegnung | zwei Karten |
| 74 | Wisch-Hinweis „← Wischen für weitere Karten →“ | `.encounter-swipe` | U:Begegnung | bleibt (mobil). Der Kartenbereich ist von der Wisch-Zurück-Geste ausgenommen. |
| 75 | Legende „Was bedeuten die Symbole?“ (beim ersten Mal offen) | `.encounter-legend` | H | H am „?“-Knopf; öffnet sich beim allerersten Mal von selbst |
| 76 | „Neu würfeln (− x 🌰)“ und Sperrgrund | `.encounter-button`, `rerollHint` | U:Begegnung | Knopf und Zeile |
| 77 | „Ablehnen (+x 🌰)“ | – | U:Begegnung | Knopf |
| 78 | „Später“ (Dialog zu, Begegnung bleibt) | `onDefer` | U:Begegnung | = Zurück (Lesezeichen „‹ Später“) |
| 79 | Schutz vor Doppel-Eingaben, Pfeiltasten zwischen Karten | encounter-dialog.ts | U:Begegnung | übernehmen |
| 80 | Seite bleibt offen und zeigt die nächste Begegnung, bis keine mehr wartet | main.ts `dialogWanted` | U:Begegnung | gleich. Bei leerem Stapel automatisch zurück. |
| 81 | Pflanzenwahl: Kopf, Samenzeile, Liste (Gruppe, Wirkungen, Vorschau, „Setzen (−x 🌰)“ bzw. Sperrgrund), Schließen | plant-picker.ts `plant-picker`, `picker-seeds` | U:Pflanze setzen | Unterseite von R:Nischen |

### A.7 Naturtagebuch (heute Dialog mit 7 Reitern)

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 82 | Knopf „📖 Naturtagebuch“ | journal-dialog.ts `journal-open` | – | **entfällt**, das ganze Album ist das Tagebuch |
| 83 | Kopf: Zähler, Meta (Zyklus, Alter), Stammgäste | `journal-counts`, `journal-meta`, `journal-regulars` | R:Arten | Kopfzeile von R:Arten |
| 84 | Reiter „Arten“: entdeckte Einträge (Symbol, Name, Fakten, Text, „lebt gerade hier“), unentdeckte „???“ | `data-species` | R:Arten | Sticker-Raster. Unentdeckte erscheinen als Silhouette mit „???“. Tipp → U:Tier (auch für entdeckte, nicht anwesende Arten: Tagebuchansicht). |
| 85 | Stammgast-Schalter ★ je Art (deaktiviert, wenn alle Plätze belegt sind) | `.journal-regular` | R:Arten + U:Tier | kleiner ★-Knopf am Sticker und auf U:Tier |
| 86 | Reiter „Pflanzen“ | `data-plant` | R:Arten | Abschnitt „Pflanzen“ |
| 87 | Reiter „Gemeinschaften“ (Mitglieder, Wirkung, Hinweis, Fortschritt, „besteht gerade“) | `data-community` | R:Arten | Abschnitt „Gemeinschaften“ |
| 88 | Reiter „Andenken“: Hauptbaum-Arten (Status ★/✓/🔒, Eigenheit, Hinweis) und Erinnerungen | `data-tree`, `data-keepsake` | R:Arten | Abschnitt „Andenken“ |
| 89 | Reiter „Erfolge“: Erreicht / Noch offen, Fortschritt, laufender Zeit-Fortschritt | `data-achievement` | U:Erfolge (von R:Ziele) | Sticker-Bogen der Erfolge |
| 90 | Reiter „Landschaft“: Zusammenfassung, Hähersaat, Wälder, Korridore | `journal-landscape-summary`, `journal-jay-seeds` | R:Landschaft | in R:Landschaft eingegliedert |
| 91 | Reiter „Statistik“: dieser Zyklus und „Über alle Zyklen“, laufend aktualisiert | `journal-stats`, `journal-stats-total` | U:Statistik (von R:Ziele) | Unterseite |
| 92 | Zahlen an den Reitern | `.journal-tab-count` | R:Arten | Zähler an den Abschnittsüberschriften |
| 93 | Pfeiltasten in der Reiterleiste | journal-dialog.ts | R | auf die Album-Reiter übertragen (C.1) |
| 94 | Hinweisfeld, „Schließen“ | – | S / – | Stempelschicht; „Schließen“ entfällt |

### A.8 Pflege und Boni

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 95 | Pflege-Liste aufklappbar, mobil zu; Zusammenfassung „2 kaufbar“ / „alles ausgebaut“ | care-panel.ts `care`, `care-summary` | R:Pflege | Reiterseite. Die Zusammenfassung steht in der Kopfzeile, der Reiter trägt einen Punkt, wenn etwas kaufbar ist. |
| 96 | Sortierung kaufbar → sparen → gesperrt → ausgebaut; Reihenfolge bleibt bei Zeiger/Fokus/kurz nach dem Kauf | `careOrder`, `CARE_HOLD_MS` | R:Pflege | übernehmen |
| 97 | Zeile: Symbol, Name, Rang (✓), nächster Rang, „öffnet …“, „schützt vor …“, Vorschau, Sperrgrund, „Kaufen (x)“ | `care-opens`, `care-protects`, `care-preview`, `care-blocker` | R:Pflege + U:Pflegemaßnahme | Auf der Seite stehen Name, Rang, Vorschau und der Kaufen-Knopf. Tipp auf den Namen → U:Pflegemaßnahme mit allen Zeilen und Kaufen-Knopf. Die `data-ref` bleiben auf der Reiterseite, weil die Zeilen dort stehen. |
| 98 | Nach dem Kauf: Aufleuchten, schwebende Bestätigung, Screenreader-Status | care-panel.ts | R:Pflege | bleibt (Stempel „gekauft“ als Juice) |
| 99 | `reveal(id)` (von „Zur Pflege“) | care-panel.ts | R:Pflege | Reiterwechsel, Scroll und Aufleuchten |
| 100 | Aktive Boni: je Quelle Restzeit und schrumpfender Balken, „bis zum Neuen Zyklus“ | bonus-panel.ts `bonuses` | R:Pflege | Abschnitt „Gerade wirksam“ oben auf R:Pflege (nur sichtbar, wenn ein Bonus wirkt) |

### A.9 Ziele: Tagesziele, Neuer Zyklus, Stammgäste

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 101 | Tagesziele: Zusammenfassung, Serie, je Ziel Symbol, Text, Fortschritt, Balken, Belohnung; Belohnung kommt automatisch | daily-panel.ts `daily`, `daily-streak` | R:Ziele | erster Abschnitt |
| 102 | Neuer Zyklus: Titel/Untertitel, „Hauptbaum: …“, Waldgedächtnis, Blocker, Gewinn, Detail, Regel, Plätze-Gewinn | cycle-panel.ts `cycle-panel`, `cycle-title`, `main-tree`, `forest-memory`, `cycle-blocker`, `cycle-gain`, `memory-rule` | R:Ziele + U:Neuer Zyklus | Auf R:Ziele steht eine Kurzkarte (Gedächtnis, Gewinn bzw. Blocker, „Vorbereiten ›“). Auf U:Neuer Zyklus stehen alle Zeilen. |
| 103 | Wahl des Hauptbaums (Radiogruppe, gesperrt mit Hinweis, Vorauswahl je Ziel-Wald) | `tree-choice` | U:Neuer Zyklus | gleich, als „Samentütchen“-Karten mit echten Radioknöpfen |
| 104 | Knopf „Neuen Zyklus beginnen“ / „Auwald gründen (3 🪶)“ mit zweitem Klick | `new-cycle` | U:Neuer Zyklus | gleich; der Fokus geht danach an die Überschrift von R:Ziele |
| 105 | Stammgäste-Auswahl: Titel, Hinweis, Knöpfe (Symbol, Name, Nische, „lebt hier“), Wartegrund | `regulars`, `regular-wait.ts` | U:Neuer Zyklus | Abschnitt „Stammgäste“ |
| 106 | Erfolge (siehe 89) | – | U:Erfolge | Link-Karte auf R:Ziele „Erfolge · 12/40 ›“ |
| 107 | Statistik (siehe 91) | – | U:Statistik | Link-Karte auf R:Ziele |

### A.10 Landschaft

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 108 | Abschnitt „Waldlandschaft“ mit Frage und Hähersaat | landscape-map.ts `landscape`, `jay-seeds` | R:Landschaft | Kopf der Reiterseite |
| 109 | Karte: SVG-Linien der Korridore, sechs Standort-Knöpfe mit Status | `landscape-map`, `data-site` | R:Landschaft | handgezeichnete Karte (gleiche Knöpfe, Papier-Optik) |
| 110 | Angaben zum gewählten Standort (Typ, Text, Gedächtnis, Baum, Urwald, Eigenheit, Verzicht, Gabe, Blocker); Live-Ansage | `site-detail`, `site-memory`, `site-blocker`, `landscape-live` | U:Standort | Tipp auf einen Standort blättert zu U:Standort um. Dort steht „Als Ziel wählen“, wenn er wählbar ist. |
| 111 | Ziel des nächsten Zyklus | `landscape-target` | R:Landschaft + U:Neuer Zyklus | gemeinsamer UI-Zustand `albumTarget` (D.2) |
| 112 | Korridorliste mit „Bauen · x 🪶“ (zweiter Klick), Hinweis | `corridors`, `data-build` | R:Landschaft | Liste unter der Karte |
| 113 | Wildwechsel-Chance am aktiven Wald (1c) | landscape-map.ts, wildwechsel-view.ts | R:Landschaft | Zeile im Kopf |
| 114 | Tagebuch-Teil: Wälder mit Angaben, Hähersaat-Tabelle | journal-dialog.ts | R:Landschaft | Abschnitt „Unsere Wälder“ und U:Standort |
| 115 | Reiter erst nach der Freischaltung sichtbar | journal-dialog.ts | Reiterleiste | Der Reiter erscheint mit „Einkleben“-Animation. |

### A.11 Rückkehr-Bericht und Meldungen

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 116 | Rückkehr-Bericht: Titel, Kurzfassung, „Details“ (aufklappen, Escape), „Schließen“ | return-report.ts `return-report*` | Z + U:Rückkehr-Bericht | Zettel „Während du weg warst …“, auf Desktop auf der linken Seite unter den Etiketten, mobil unter den Etiketten. „Details“ → Unterseite. „Schließen“ heißt jetzt „Abheften“. |
| 117 | Willkommens-Toast (mobil Kurzfassung, Desktop ganz) | main.ts `catchUp` | S | Stempel mit Kurzfassung (Desktop wie mobil). Alles Weitere steht im Zettel. |
| 118 | Fehlertexte der Aktionen (`ERROR_TEXTS`, `PLANT_ERROR_TEXTS`) | main.ts | S | Stempel (rot umrandet) |
| 119 | Neu entdeckte Lebensgemeinschaften, eingezogene Stammgäste, Erfolge, erfüllte Tagesziele (als ein Text) | `act`, `joinNotes` | S / Z | Stempel; ab 90 Zeichen als Zettel (C.5) |
| 120 | Jahreszeit- und Wetterwechsel | `seasonWeatherChangeText` | S | Stempel |
| 121 | Wegpunkt ohne Begegnung bzw. automatisch abgelehnt (schwebende Notiz über der Szene) | `noteText`, `tickDeclineText` | G | schwebende Notiz über dem Polaroid. Ist das Polaroid nicht zu sehen (mobil gescrollt, Unterseite), wird daraus ein Stempel. |
| 122 | Landschaft freigeschaltet (einmalig) | `LANDSCAPE_UNLOCK_TEXT` | Z | Zettel; dazu erscheint der Reiter |
| 123 | Korridor gebaut, Wald gegründet, Neuer Zyklus | `corridorBuiltText`, `newCycleToast`, `siteChangeText` | S / Z | Stempel bzw. Zettel |
| 124 | v1-Hinweis, „Waldgedächtnis neu gewichtet“, Import-Nachträge, „Tab angehalten“ | main.ts | Z | Zettel |
| 125 | Konto-Meldungen über `notify` | sync/account.ts | S | Stempel |

### A.12 Hilfe, Einstellungen, Konto, Spielstand

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 126 | Knöpfe „❓ Spielanleitung“, „⚙️ Einstellungen“ | help.ts `guide-open`, `settings-open` | B | Einträge im Umschlag; die `data-ref` bleiben an den Einträgen |
| 127 | Spielanleitung (Einleitung, 20 Abschnitte, „kommt bald“, Landschaft-Abschnitt erst nach der Freischaltung) | help.ts, guide-view.ts `guide` | B → U:Anleitung | Inhaltsverzeichnis im Umschlag; jedes Kapitel ist eine Unterseite |
| 128 | „Neu hier?“ beim ersten Start („Spielanleitung öffnen“, ×) | `guide-hint` | H | H am Knopf „☰ Umschlag“ mit „Anleitung lesen“ und „×“ |
| 129 | Einstellungen: Bewegung, Zahlenformat, Hinweise länger, Klang, Tageszeit | help.ts `settings`, `data-setting` | B → U:Einstellungen | gleiche Fieldsets |
| 130 | Konto: Benutzer, Passwort, Anmelden, Registrieren, „angemeldet als“, Abgleich, Abmelden, Status, veraltet, Sicherungen laden | account-panel.ts `account*` | B → U:Konto | Der Abschnitt hängt sich wie heute über `mount` ein, jetzt in U:Konto statt in den Einstellungen. Ohne Sync-URL gibt es keinen Eintrag. |
| 131 | Spielstand exportieren/importieren: Export, Code, Kopieren, Import-Feld, Import mit zweitem Klick, Status | save-transfer.ts `save-transfer`, `export*`, `import*`, `save-status` | B → U:Spielstand | gleiche Elemente; „Spielstand löschen“ (10) kommt dazu |
| 132 | Hinweisfeld im Hilfe-Dialog | help.ts `notice` | S | Stempelschicht |

### A.13 Sonstiges

| # | Element und Funktion heute | heute | Ort | Ziel im Album |
|---|---|---|---|---|
| 133 | UI-Demo-Seite (`/src/ui/demo.html`) mit Beispieldaten | ui/demo.ts | – | wird zur Album-Demo (Komponenten mit Beispieldaten), Schritt F-12 |
| 134 | Render-Demo (`/src/render/demo.html`) | render/demo.ts | – | bekommt eine Sticker-Tafel (F-2) |
| 135 | Silbentrennung langer Namen | hyphenate.ts | – | bleibt (wichtig für schmale Sticker-Namen) |

**Summe: 135 erfasste Elemente und Funktionen.** Bewusst entfallen nur drei, alle ohne
Funktionsverlust:

- **#7 Toast-Platzierung:** Stempel haben einen festen Platz; es gibt nichts mehr, dem sie
  ausweichen müssten.
- **#24 Knopf „Begegnungen warten“:** Er ist doppelt zum Zettelstapel, der jetzt immer sichtbar
  ist.
- **#82 Tagebuch-Knopf:** Das Album selbst ist das Tagebuch.

Die Dialog-eigenen Hinweisfelder (#66, #94, #132) gehen in der gemeinsamen Stempelschicht auf.

---

## B. Seitenstruktur je Reiter

### B.0 Rahmen

**Mobil (Hochformat, 390 × 844, auch 360 breit)** – Reihenfolge von oben, die Seite scrollt
als Ganzes:

```
[☰]                                        (Umschlag-Knopf, klein, oben links)
┌ Polaroid (Washi-Tape, −1,4°) ────────────┐
│  Szene (Canvas)                           │
│  Junger Baum        Frühling, wechselhaft │
└───────────────────────────────────────────┘
[48,3/s Wachstum] [1.240 Samen] [62 Harmonie ⓘ]   ← Etiketten
▬▬▬▬▬▬▬▬▬░░░░░ noch 1:20 bis zum Wegpunkt          ← Stufenleiste schmal
(Zettel „Während du weg warst …“, falls vorhanden)
 Nischen | Arten | Pflege | Ziele | Landschaft     ← Reiter (klebt oben beim Scrollen)
┌ Heftseite ────────────────────────────────┐
│  … Inhalt des Reiters …                    │
└───────────────────────────────────────────┘
                           ┌ 2 Zettel: ┐       ← Zettelstapel, fest unten rechts
                           └ Besuch!   ┘
```

- Sobald die Etiketten aus dem Bild scrollen, erscheint über den Reitern eine schmale
  **Vorratsleiste** mit Samen, Wachstum und Harmonie in Caveat 20 px (G-21). Umgesetzt in
  `album/supply-bar.ts`: Sie erscheint, sobald die Reiterleiste klebt (Marke direkt über den
  Reitern), und verschiebt nichts im Textfluss. U:Pflegemaßnahme zeigt den Vorrat am Knopf.
- **Unterseiten auf dem Handy:** Wie im Prototyp dreht sich die **ganze Hauptseite**
  (Polaroid, Etiketten, Heft) um die linke Kante weg, darunter liegt die Unterseite in voller
  Höhe. Der Zettelstapel und die Stempel bleiben darüber.

**Doppelseite (Desktop und Tablet quer, ab 760 px Breite im Querformat)** – nach dem
Desktop-Mockup:

```
[☰ Umschlag]        Naturtagebuch · Heimatwald        [2 Zettel: Besuch wartet!]
┌────────────── Einband #6B4E3A ───────────────────────────────────────────┐
│┌ linke Seite ──────────────┐┊┌ rechte Seite ─────────────────────┐ Nischen│
││  Polaroid (500×300)        │┊│ Wer wohnt wo?      9 von 14 Plätzen│ Arten  │
││  Junger Baum  Frühling ·…  │┊│ Krone      (●)(●)( )               │ Pflege │
││ [Wachstum][Samen][Harmonie]│┊│ Stamm      (●)( )                  │ Ziele  │
││ Samen Keimling … Urwald    │┊│ …                                  │ Landsch│
││ ▬▬▬▬▬▬▬▬▬░░░░░              │┊│                              S. 12 │        │
││ (Rückkehr-Zettel)          │┊└────────────────────────────────────┘        │
│└────────────────────────────┘                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

- Die Reiter stehen **senkrecht am rechten Buchrand** (`writing-mode: vertical-rl`). Die
  linke Seite scrollt nicht. Die rechte Seite scrollt in sich.
- Beim Umblättern dreht sich **nur die rechte Seite** um den Buchfalz. Die linke Seite mit
  dem Polaroid bleibt stehen (G-2).
- Die **Seitenzahl** („S. 12“) ist Schmuck. Sie ergibt sich fest aus Reiter und Unterseite,
  damit sie beim Wiederkommen gleich bleibt.

**Seitenkopf jeder Reiterseite:** Caveat-Überschrift als Frage (Desktop 46 px, mobil 32 px)
und rechts eine kurze Kennzahl.

### B.1 Reiter „Nischen“ – „Wer wohnt wo?“ · „9 von 14 Plätzen“

1. Kurzer Hinweis „Tippe auf einen Sticker, um umzublättern.“ (nur bis zum ersten Umblättern,
   gemerkt in den Einstellungen)
2. **Gattungen:** Abzeichen-Reihe mit Pips. Tipp öffnet eine H mit der Beschreibung.
3. **Baum-Nischen:** Stickerreihen Wurzeln, Laubstreu, Waldsaum, Krone, Stamm & Rinde,
   Höhlen. Verschlossene Nischen zeigen grauen Namen und eine Handschrift-Zeile.
4. **Lebensräume:** Waldtümpel, Waldwiese, Totholzhaufen, Trockenmauer. Verschlossene haben
   den Link „Zur Pflege ›“.
5. **Pflanzring:** Plätze als Sticker, Messbänder für Licht und Wasser, Mangel-Notiz,
   Gruppen-Etiketten, Knopf „🌱 Pflanze setzen · 120 🌰“ → U:Pflanze setzen.
6. **Lesezeichen-Links:** „Lebensgemeinschaften · +8 ⚖️ ›“ → U:Harmonie; „Nahrungsnetz ·
   1 überjagt ›“ → U:Nahrungsnetz.

Unterseiten:

- **U:Tier:** Lesezeichen „‹ Nischen“; Kopf mit großem Sticker, Name, Gattung · Nische,
  Seltenheits-Pille, Zufriedenheit; „Was er braucht“; „Was er bewirkt“; „Räuber und Beute“
  (Link „Nahrungsnetz ›“, das ist Ebene 2); „Lebensgemeinschaften“; Stammgast ★; Notiz zur Art.
  „Zuerst gesehen“ kommt seit v15 aus `meta.journal.firstSeen` und steht nur da, wenn der Stand
  den Wert kennt (G-12 ist damit erledigt).
- **U:Harmonie:** Zusammensetzung, Lebensgemeinschaften live, Erklärung der Harmoniestufen.
- **U:Nahrungsnetz:** wie heute, als Liste mit kleinen Stickern für die Jäger.
- **U:Pflanze setzen:** Samenzeile und Liste der Pflanzen mit „Setzen“.

**Skizze mobil:** Die Namensspalte ist 104 px breit, die Sticker sind 48 px groß mit 6 px
Abstand. Ab 4 Plätzen bricht die Reihe um. Gattungen stehen als waagerecht scrollende Reihe.

**Skizze Desktop:** Die Namensspalte ist 150 px breit, die Sticker sind 54 px groß mit 8 px
Abstand. Gattungen und Pflanzring stehen nebeneinander, wenn die Seite breiter als 640 px ist.

### B.2 Reiter „Arten“ – „Wer war schon da?“ · „23 von 53 Arten“

1. Kopf: Zähler, Zyklus und Alter, Stammgäste (`journal-*`).
2. Sprungmarken als kleine Washi-Streifen: Tiere · Pflanzen · Gemeinschaften · Andenken.
3. **Tiere:** Sticker-Raster, nach Gattung gruppiert. Unentdeckte erscheinen als Silhouette
   mit „???“. ★ markiert Stammgäste, ein Punkt „lebt hier“ die anwesenden Arten. Tipp → U:Tier.
4. **Pflanzen:** Sticker-Raster mit Gruppen-Emoji. Tipp → H mit Fakten und Text.
5. **Gemeinschaften:** Liste mit Mitgliedern, Wirkung, Fortschritt und „besteht gerade“.
6. **Andenken:** Hauptbaum-Arten als Samentütchen (★/✓/🔒) und Erinnerungen als Zettel.

**Skizze mobil:** Raster mit 5 Spalten à 56 px, darunter der Name zweizeilig mit Silbentrennung.

**Skizze Desktop:** Raster mit 7 Spalten, die Abschnitte stehen untereinander.

**Umgesetzt (Schritt 7):** Der ★-Knopf sitzt oben links am Sticker (26 px, Trefferfläche
40 px), die Stammgast-Wahl mit voller Knopfgröße steht auf U:Tier. Unentdeckte Tiere zeigen
die Silhouette auf blassem Gattungsgrund mit Seltenheitsrand, unentdeckte Pflanzen ihr
Gruppen-Emoji als dunklen Schatten. Die Haftnotiz einer Silhouette nennt Gattung, Seltenheit,
Nische und die Stufe bzw. „besondere Bedingungen“, nie Namen oder ID. Die echte ID für das Bild
bleibt im Skript. Zeichnen: siehe ROADMAP Phase 8, Schritt 7 (IntersectionObserver, IdleQueue,
Messwerte).

### B.3 Reiter „Pflege“ – „Was tun wir für den Wald?“ · „2 kaufbar“

1. **Gerade wirksam** (Boni mit Restzeit-Balken). Fehlt, wenn kein Bonus wirkt.
2. **Pflegemaßnahmen** sortiert wie heute. Jede Zeile hat Symbol, Name und Rang, eine
   Vorschau und „Kaufen (x)“ bzw. den Sperrgrund. Tipp auf den Namen → U:Pflegemaßnahme mit
   nächstem Rang, „öffnet …“, „schützt vor …“ und Kaufen.

**Skizze mobil:** Eine Zeile pro Maßnahme, der Kaufen-Knopf rechts mit mindestens 44 px. Die
Vorschau steht in einer eigenen Zeile.

**Skizze Desktop:** wie mobil, nur breiter. Gesperrte Maßnahmen sind wie heute gedämpft.

### B.4 Reiter „Ziele“ – „Was haben wir vor?“ · „🔥 4 Tage“

1. **Tagesziele** mit Serie und je einem Balken pro Ziel.
2. **Neuer Zyklus:** Kurzkarte mit Waldgedächtnis und Gewinn bzw. Blocker, dazu
   „Vorbereiten ›“ → U:Neuer Zyklus. Dort stehen Untertitel, Hauptbaum jetzt, Gedächtnis,
   Gewinn, Regel, Ziel-Wald (aus der Landschaft), Baumwahl, Knopf mit zweitem Klick und
   Stammgäste.
3. **Erfolge · 12/40 ›** → U:Erfolge (Sticker-Bogen: Erreicht, Noch offen, laufender
   Fortschritt).
4. **Statistik ›** → U:Statistik.

Ein Punkt am Reiter zeigt, wenn ein Neuer Zyklus möglich ist (G-13).

**Skizze mobil und Desktop:** Karten untereinander. Die Tagesziele bekommen einen blauen
Washi-Kopf in der Reiterfarbe.

**Umgesetzt (Schritt 9):** Kennzahl im Kopf ist die Serie („🌞 4 Tage“), ohne Serie der Zyklus.
Die Kurzkarte ist gestrichelt, solange der Zyklus gesperrt ist („Mehr dazu ›“), und bekommt
einen „bereit!“-Stempel, sobald er möglich ist („Vorbereiten ›“). Die Baumwahl zeigt alle
sichtbaren Hauptbäume (`isTreeVisible`) als Samentütchen mit Symbol-Sticker (der Renderer hat
keine Baum-Sticker); gesperrte mit 🔒 und Hinweis. Stammgäste tragen den Tier-Sticker. Nach dem
Start blättert die Seite zurück zu „Ziele“. `data-ref`: `daily`, `cycle-card`, `cycle-open`,
`achievements-open`, `stats-open`; auf U:Neuer Zyklus wie bisher `new-cycle`, `tree-choice`,
`regulars`, `forest-memory`, `cycle-gain`, `cycle-blocker`, `memory-rule`, `main-tree`, neu
`cycle-sub`, `cycle-target`.

### B.5 Reiter „Landschaft“ – „Unsere Wälder“ · „🪶 3 Hähersaat“

1. Frage, Hähersaat und Wildwechsel-Chance.
2. **Karte** mit sechs Standorten und Korridor-Linien. Tipp auf einen Standort → U:Standort.
3. **Ziel des nächsten Zyklus:** Zeile mit „Neuer Zyklus ›“ (blättert in den Reiter Ziele um;
   das ist ein Reiterwechsel mit geöffneter Unterseite, C.1).
4. **Korridore** mit „Bauen“.
5. **Unsere Wälder** (Tagebuch-Teil) mit Hähersaat-Tabelle.

**Skizze mobil:** Die Karte ist so breit wie die Seite, im Seitenverhältnis 4 : 3; die
Standort-Knöpfe sind mindestens 44 px groß.

**Skizze Desktop:** Die Karte ist 100 % breit, Korridore und Wälder stehen darunter.

**Umgesetzt (Schritt 10):** Kennzahl im Kopf „🪶 3 Hähersaat“. Die Karte ist auf der Einzelseite
höher als 4 : 3 (1 : 1,2, mindestens 360 px): Bei 360 px Breite, 125 % Schrift oder breiterer
Schrift (DejaVu Sans) überlappen sich die Standort-Knöpfe (≥ 44 px, mit Name und Zustand) sonst;
auf der Doppelseite 4 : 3. Ein Tipp auf einen Standort blättert zu U:Standort; dort wählt
„Als Ziel wählen“ den Wald (gedrückt = Ziel, erneut tippen = doch hier bleiben, mit Live-Ansage)
und „Neuer Zyklus ›“ springt zu U:Neuer Zyklus. Abschnitt 5 heißt „Tagebuch der Wälder“ (die
Seite selbst heißt schon „Unsere Wälder“); jeder Wald darin blättert ebenfalls zu U:Standort.
U:Neuer Zyklus verlinkt den Ziel-Wald („Auwald am Fluss ansehen ›“, U:Standort auf Ebene 2).
Reiterwechsel mit Unterseite über `PageEnv.goto(tab, page)`. `data-ref`: `landscape`,
`jay-seeds`, `wildwechsel-chance`, `landscape-map`, `data-site`, `landscape-target`,
`landscape-cycle-open`, `corridors`, `data-build`, `corridor-wildwechsel`, `landscape-diary`,
`landscape-summary`, `landscape-jay-seeds`, `data-forest`, `forest-open`; auf U:Standort
`site-detail`, `site-status`, `site-memory`, `site-blocker`, `site-choose`, `site-choice-hint`,
`site-cycle-open`, `site-diary`, `landscape-live` (Seite mit `data-site-id`); auf U:Neuer Zyklus
`cycle-site-open`.

### B.6 Unterseiten-Übersicht

| Unterseite | erreichbar von | Ebene | Inhalt |
|---|---|---|---|
| Tier | Nischen-Sticker, Arten-Sticker, Vollbild-Haftnotiz | 1 | A.5 |
| Nahrungsnetz | Nischen, U:Tier | 1 oder 2 | A.3 #33 |
| Harmonie | Harmonie-H „Mehr ›“, Nischen | 1 | A.3 #31–32 |
| Pflanze setzen | Nischen | 1 | A.6 #81 |
| Begegnung | Zettelstapel (von überall) | 1 | A.6 #68–80 |
| Pflegemaßnahme | Pflege | 1 | A.8 #97 |
| Neuer Zyklus | Ziele, Landschaft | 1 | A.9 #102–105 |
| Erfolge, Statistik | Ziele | 1 | A.7 #89, #91 |
| Standort | Landschaft, U:Neuer Zyklus | 1 oder 2 | A.10 #110 |
| Rückkehr-Bericht | Rückkehr-Zettel | 1 | A.11 #116 |
| Anleitung (Kapitel), Einstellungen, Konto, Spielstand | Umschlag | 1 | A.12 |

### B.7 Buchumschlag (Menü)

Der Knopf „☰ Umschlag“ öffnet den Umschlag. Mobil schwenkt er als **Innenseite des
Einbands** (Kartonfarbe #6B4E3A, Schrift Papierfarbe) von links herein. Am Desktop klappt der
linke Buchdeckel über die linke Seite. Inhalt:

1. Titel „Vom Samen zum Wald“ (h1)
2. 📖 Spielanleitung › (Inhaltsverzeichnis → Kapitel)
3. ⚙️ Einstellungen ›
4. 👤 Konto › (nur mit Sync-URL)
5. 💾 Spielstand › (Export, Import, Spielstand löschen)
6. „Schließen“

Kapitel im Umschlag werden mit denselben Unterseiten umgeblättert. Der Umschlag zählt als
eigene Ebene 0 (C.1).

---

## C. Interaktionsmodell

### C.1 Navigationsstapel

Der UI-Zustand des Albums ist **kein Teil des Spielstands**. Er liegt in
`src/ui/album/nav.ts` als reine Funktion ohne DOM, damit er sich mit Vitest testen lässt:

```ts
type TabId = 'niches' | 'species' | 'care' | 'goals' | 'landscape';
type PageRef =
  | { kind: 'animal'; id: string } | { kind: 'foodweb' } | { kind: 'harmony' }
  | { kind: 'plant-picker' } | { kind: 'encounter' } | { kind: 'care-item'; id: string }
  | { kind: 'cycle' } | { kind: 'achievements' } | { kind: 'stats' }
  | { kind: 'site'; id: SiteId } | { kind: 'return-report' }
  | { kind: 'guide'; section?: string } | { kind: 'settings' } | { kind: 'account' } | { kind: 'save' };

interface AlbumNav {
  tab: TabId;
  cover: boolean;            // Umschlag offen (eigene Ebene 0)
  stack: PageRef[];          // höchstens 2 Einträge
  fullscreen: boolean;       // Vollbild der Szene
  note: string | null;       // ID der offenen Haftnotiz
}
type NavAction =
  | { type: 'tab'; tab: TabId } | { type: 'open'; page: PageRef } | { type: 'back' }
  | { type: 'cover'; open: boolean } | { type: 'fullscreen'; open: boolean }
  | { type: 'note'; id: string | null } | { type: 'landscape-locked' };
function navigate(nav: AlbumNav, action: NavAction, ctx: { landscapeUnlocked: boolean }): AlbumNav;
```

**Regeln:**

- **Öffnen:** `open` legt eine Seite auf den Stapel. Ist er schon 2 hoch, **ersetzt** sie die
  oberste (es gibt nie eine Ebene 3). Liegt dieselbe Seite schon oben, ändert sich nichts.
- **Reiterwechsel:** Er leert den Stapel und schließt Haftnotiz und Umschlag. Es gibt
  **kein Umblättern**, nur ein kurzes Überblenden (120 ms, G-3).
- **Sprung in einen anderen Reiter mit Unterseite** (z. B. Landschaft → „Neuer Zyklus ›“):
  `tab` wird auf Ziele gesetzt, danach folgt `open(cycle)` mit Umblättern.
- **Begegnung:** `open(encounter)` geht vom aktuellen Reiter aus (Ebene 1) und ersetzt dabei
  einen vorhandenen Stapel nicht, sondern legt sich darauf. Ist der Stapel voll, ersetzt die
  Begegnung die oberste Seite. Wird der Zettelstapel leer, folgt `back` von selbst.
- **Zurück-Reihenfolge** (Escape, Zurück-Knopf, Wischen, Browser-Zurück):
  1. offene Haftnotiz
  2. Vollbild
  3. oberste Unterseite
  4. Umschlag
  5. sonst nichts (Escape tut nichts; das Browser-Zurück verlässt die App wie heute)
- **Landschaft gesperrt** (z. B. nach dem Import eines älteren Stands): Ist `tab ===
  'landscape'`, geht es zurück zu Nischen.
- **Fokus:** Nach `open` bekommt die Überschrift der neuen Seite den Fokus (`tabindex=-1`).
  Nach `back` bekommt ihn der auslösende Knopf, wenn es ihn noch gibt, sonst die
  Seitenüberschrift.
- **Reiter-Tastatur:** Pfeiltasten (mobil links/rechts, Desktop hoch/runter), Pos1 und Ende,
  Rollen `tablist`/`tab`/`tabpanel` wie im Tagebuch heute. Verborgene Reiter werden
  übersprungen.

### C.2 URL, Verlauf und Wischen

- **Hash für den Reiter:** `#nischen`, `#arten`, `#pflege`, `#ziele`, `#landschaft`. Beim
  Neuladen öffnet das Album den Reiter aus dem Hash. Unterseiten werden **nicht**
  wiederhergestellt, weil ihr Inhalt veraltet sein kann. e2e-Tests können so direkt
  `goto('/#pflege')` aufrufen.
- **Verlauf:** Jede Unterseite, das Vollbild und der Umschlag legen per `history.pushState`
  einen Eintrag an (gleicher Hash, `state.album = depth`). `popstate` löst `back` aus. So
  schließt die **Android-Zurück-Taste** die Unterseite, statt die App zu verlassen (G-6). Ein
  Zurück-Knopf in der Oberfläche ruft `history.back()` auf, damit Verlauf und Stapel nie
  auseinanderlaufen. Haftnotizen bekommen keinen Verlaufseintrag.
- **Neuladen auf einer Unterseite (Schritt 12):** Der Eintrag trägt noch `album = n`; darunter
  liegen die Einträge der alten Ebenen. Das Album spult beim Start mit `history.go(-n)` auf den
  Grundeintrag zurück und setzt dort den Hash des Reiters, mit dem neu geladen wurde (nur, wenn
  der Verlauf mindestens so lang ist – sonst wie bisher nur `album = 0`). Zeigt ein älterer
  Eintrag einen Hash, der nicht mehr zum gezeigten Reiter passt (z. B. `#landschaft` nach dem
  Sperren der Landschaft), ersetzt das Album ihn beim `hashchange`.
- **Wischen:** Auf einer Unterseite gilt ein waagerechter Wisch nach rechts als „Zurück“:
  mindestens 60 px weit, waagerecht mindestens doppelt so weit wie senkrecht, oder schneller
  als 0,5 px/ms. Die Seite folgt dem Finger dabei leicht (rotateY bis −20°) und schnappt
  zurück bzw. blättert zu Ende. Ausgenommen sind Elemente mit `data-no-swipe` (Kartenreihe der
  Begegnung, waagerecht scrollende Reihen, Eingabefelder, Landschaftskarte) und das Canvas.
  Auf Reiterseiten gibt es **keine** Wischgeste zum Reiterwechsel (das verhindert
  Fehlbedienung beim Scrollen).
  **Umsetzung (13a, `album/swipe.ts`):**
  - Die Richtung steht nach 10 px fest; senkrecht oder nach links ist die Geste für diesen
    Kontakt aus. Das Verhältnis 2 : 1 gilt immer, die Bedingungen „60 px“ und „> 0,5 px/ms“
    (Tempo über die letzten 100 ms, dazu mindestens 20 px) sind die beiden Alternativen.
  - Nur Finger und Stift (keine Maus), nur ein Finger, nur mit Beginn **in** der obersten
    Unterseite, nicht bei offener Haftnotiz, im Vollbild oder während des Blätterns. Nicht aus
    den linken 20 px des Bildschirms: Dort gehört die Geste dem Browser (iOS-Rand-Wischen, das
    über den Verlauf dasselbe tut, R8).
  - Auslösen geht über denselben Weg wie das Lesezeichen (`history.back()`), Verlauf und Stapel
    bleiben gleich.
  - Mitführen: Die darunterliegende Seite (mobil die Hauptansicht, Desktop die rechte Seite bzw.
    Ebene 1) dreht sich so von −90° her ein, dass ihre rechte Kante unter dem Finger liegt
    (Perspektive eingerechnet), höchstens bis −20°. Nach dem Loslassen blättert `PageTurn.back`
    von dort aus zu Ende, sonst schnappt sie in ≤ 220 ms zurück. Layout wird nur einmal zu
    Beginn der Geste gelesen. Bei reduzierter Bewegung ohne Mitführen (nur Auslösen,
    Überblenden wie beim Lesezeichen).
  - Unterseiten haben `touch-action: pan-y pinch-zoom` (sonst bricht der Browser waagerechte
    Gesten mit `pointercancel` ab); `[data-no-swipe]` darin `pan-x pan-y pinch-zoom`.

### C.3 Umblättern

Die Werte stammen aus dem Album-Prototyp:

- **Vorwärts** (Unterseite öffnen): Die Unterseite wird **unter** die aktuelle Seite gelegt.
  Die aktuelle Seite dreht sich mit `rotateY(0 → −104deg)` um ihre linke Kante
  (`transform-origin: left center`) in `--turn-ms` (380 ms) mit `--turn-ease`
  (`cubic-bezier(.3,.7,.3,1)`). Der Container hat `perspective: 1400px`, die Seite
  `backface-visibility: hidden`. Der Schatten wächst dabei auf `30px 0 40px
  rgba(59,58,54,.35)`. Danach wird die alte Seite verborgen (`hidden`) und zurückgesetzt.
- **Zurück:** genau umgekehrt. Die verlassene Seite dreht sich von −104° auf 0° über die
  Unterseite, danach wird die Unterseite verborgen.
- **Mobil** dreht sich die ganze Hauptansicht (Polaroid, Etiketten, Heft) wie im Prototyp,
  **Desktop** nur die rechte Seite um den Falz.
- **Reduzierte Bewegung** (`data-motion="reduce"`): Überblenden in 150 ms, ohne 3D.
- Während des Blätterns sind beide Seiten nicht bedienbar. Eine zweite Eingabe wird
  vorgemerkt und danach ausgeführt. Die Unterseite ist dabei `inert`; die drehende Seite fängt
  Zeiger und Klicks per Capture-Lauscher ab (ein Klick darauf wird vorgemerkt und nach der
  Drehung ausgelöst, wenn sein Ziel dann bedienbar ist) und bekommt `inert` erst am Ende zusammen mit
  `turned-away` (`visibility: hidden` + `content-visibility: hidden`). Grund (Schritt 14, S9):
  `inert` erbt sich, an der großen Hauptansicht kostete jede Änderung eine Stil-Neuberechnung
  des ganzen Teilbaums; im gesperrten Teilbaum entfällt sie. Mobil schneidet `clip-path` die
  drehende Hauptansicht für die Dauer der Drehung auf den sichtbaren Streifen zu (gerastert
  wird nur er; zu sehen ist der Unterschied nicht, weil die Perspektive nur nach außen vergrößert).
- `will-change: transform` gilt nur während der Animation. Es animiert genau ein Element. Es
  gibt keine Schnappschüsse und keinen Curl.

### C.4 Haftnotizen

- **Auslöser** sind echte `<button>` mit `aria-expanded`. Die Notiz hat `role="note"`, ist ein
  eigenes Element mit `popover="auto"` und liegt damit in der obersten Ebene. Light-Dismiss
  und Escape bekommt sie so vom Browser.
- **Lage:** unter dem Auslöser, rechtsbündig an der Seite, nie über den Bildschirmrand
  hinaus (einfache Rechnung in `Note.position()`; kein CSS-Anchor-Positioning, das noch nicht
  überall geht). Ist unten kein Platz, kommt sie darüber.
- **Optik:** `--note-bg` #FFF4B8, Washi-Streifen #BFD8C2 (56 × 18, −4°), leicht gedreht
  (+2°), Titel in Caveat 24 px, Text 13 px. Knopf „Verstanden“ (schließt), optional „Mehr ›“
  (öffnet die passende Unterseite und schließt die Notiz).
- **Es gibt immer höchstens eine Notiz.** Sie schließt beim Reiterwechsel, beim Umblättern,
  beim Vollbild und bei Escape. Der Fokus geht zurück an den Auslöser.
- **Aufklappen:** 160 ms `scale(.92) → 1` mit Ausblenden; bei reduzierter Bewegung ohne
  Skalierung.
- **Inhalt:** Der Text kommt aus den vorhandenen View-Funktionen (Jahreszeit, Wetter,
  Gattung, Nacht) oder aus kurzen festen Texten in `album/notes-text.ts`.
- **Ersatz**, falls `popover` fehlt (iOS < 17): eine Klasse `.note-open` und ein eigener
  Klick-außerhalb-Handler (G-22).

### C.5 Stempel und Zettel (Ersatz für den Toast)

Es gibt **eine Meldungsschicht** (`Stamps`) über dem Album, auch über dem Vollbild:

- **Ort (seit Schritt 12):** nie über der Navigation. Unten über der Seite – mobil über dem
  Zettelstapel, Desktop mittig über dem Fuß der rechten Seite. Nur mobil auf der Hauptansicht
  (oben liegt dort nur das Bild) und im Vollbild oben über dem Bild, unter sichtbaren
  Banderolen (`.stamps-top`, entschieden in `album/index.ts`). Vorher lag die Schicht immer oben
  und verdeckte mobil Reiter, Lesezeichen und Seitentitel.
- **Stabil und ausweichend (Schritt 14):** Oben oder unten wird entschieden, wenn eine Meldung
  erscheint (oben, solange über der Bildunterschrift Platz ist). Beim Scrollen wechselt sie nur
  noch nach unten, wenn die Knöpfe unter dem Bild heranrücken – mit kurzem Überblenden, nie
  zurück, solange sie steht (`stampsOnTop`). Unten rückt die Schicht über scharfe Bestätigungen
  (`.armed`), markierte Knöpfe (`data-stamp-avoid`, z. B. „Schließen“ im Umschlag) und den
  fokussierten Knopf (`stampLift`, höchstens bis unter Reiterleiste bzw. Lesezeichen). Von zwei
  Meldungen steht die ältere einzeilig und kleiner (`.stamp-older`); Zahl und Symbol („+24 🌰“)
  brechen nicht auseinander.
- **Stempel** (Text bis 90 Zeichen): Tintenrahmen 2 px, abgerundet, −3° gedreht, Caveat
  22 px, Papier dahinter. Er „stempelt“ in 220 ms herein (`scale(1.3) → 1`, Deckkraft) und
  verschwindet nach `toastDurationFor(text, preferences.toastMs())`. Höchstens 2 sind
  gleichzeitig sichtbar, der älteste weicht.
- **Zettel** (Text über 90 Zeichen oder Meldungen, die bleiben sollen: Landschaft
  freigeschaltet, v1-Hinweis, angehaltener Tab): gelber Zettel mit Tape, dazu „×“. Er bleibt
  doppelt so lange stehen bzw. bis zum Schließen.
- **Fehler** bekommen einen roten Stempelrahmen (`--ink-red` #A8364F).
- `role="status"` an der Schicht. Die Texte bleiben dieselben wie heute.
- **`notify()` wird einfacher:** Es gibt keine Hinweisfelder pro Dialog mehr. Die heutige
  Regel „mehrere Hinweise im selben Moment zu **einem** Text zusammenfassen“ (`joinNotes`)
  bleibt, sonst stapeln sich Stempel.
- **Schwebende Zahlen** (feedback.ts) bleiben und werden nur in Caveat und Tinte gesetzt.

### C.6 Polaroid und Vollbild

- **Das Polaroid ist ein `<button>`** (aria-label „Szene vergrößern“), das das Canvas umhüllt.
  Ein Tipp oder Enter öffnet das Vollbild. Im Polaroid gibt es **keine** Kamera-Gesten und
  keinen Tier-Treffer-Test (G-15). `touch-action: pan-y`, damit die Seite scrollt.
- **Vollbild:**
  - **Öffnen:** Das Canvas-Element wandert (DOM-Umhängen, kein Neuanlegen) in die
    Vollbild-Ebene. Es wird mit FLIP vom Rechteck des Polaroids aufgezogen (300 ms,
    `--turn-ease`), bei reduzierter Bewegung sofort. Erst nach der Animation meldet der
    `CanvasSizer` die neue Größe, und der Renderer baut seine Caches **einmal** neu (D.3).
  - **Bedienung:** Kamera-Leiste (+, −, ⟲) unten rechts, „✕ Zurück ins Album“ oben rechts.
    Gesten und Tastatur wie heute. Die Bildunterschrift steht unten links als Polaroid-Rand.
  - **Tier antippen:** H mit Name, Zufriedenheit und Stimmung, Knopf „Im Album ansehen ›“ →
    schließt das Vollbild und öffnet U:Tier.
  - **Schließen:** per Knopf, Escape, Browser-Zurück und Wisch nach unten (über 80 px, nur
    bei Zoom 1×). Danach zieht sich die Szene ins Polaroid zurück, und die Kamera-Ansicht
    bleibt für das nächste Öffnen erhalten.
- **Stufen-Stempel:** liegt über dem Polaroid bzw. im Vollbild über der Szene.

### C.7 Zettelstapel der Begegnungen

- **Mobil** fest unten rechts (`right 18px; bottom 22px`, 150 px breit, um 3° gedreht).
  **Desktop** im Kopf rechts (um 2° gedreht). Text: „2 Zettel: Besuch wartet!“ bzw. je nach
  oberster Begegnung („Etwas keimt!“, „Sturmnacht!“; Symbol aus `stackIcon`). Bei einem
  Zettel steht „1 Zettel: …“.
- **Stapel-Optik:** Ab 2 Zetteln zeichnet der Schatten `4px 4px 0 #F4E39A` einen zweiten
  Zettel, ab 3 einen dritten (`8px 8px 0`).
- **Neuer Zettel:** einmal Wackeln, 600 ms, ±3°, `--wobble`. Bei reduzierter Bewegung gibt es
  nur einen kurzen Farbblitz. Das bisherige „Pling“ (Klang) bleibt.
- **Antippen** → U:Begegnung. Die Seite zeigt die oberste Begegnung. Nach einer Entscheidung
  kommt die nächste ohne neues Umblättern (der Inhalt wird überblendet), bis der Stapel leer
  ist. Dann blättert die Seite automatisch zurück.
- **Mobil auf Unterseiten** bleibt der Stapel sichtbar, auf U:Begegnung selbst ist er
  verborgen.
- **Keine Regeländerung:** Stapelgröße, automatisches Ablehnen und Samen-Ausgleich bleiben,
  wie sie sind.

### C.8 Rückkehr-Bericht

Der Zettel „Während du weg warst …“ hat eine Kurzfassung (`headline`) und die Knöpfe
„Details ›“ (→ U:Rückkehr-Bericht mit `details`) und „Abheften“ (blendet aus). Der
Willkommens-Stempel grüßt nur („Willkommen zurück! 8 Std.“, `returnStamp`) – die Kurzfassung
steht ja im Zettel; Screenreader hören sie im Stempel mit (unsichtbarer Rest). Auf
U:Rückkehr-Bericht verschwindet der Stempel. Am Desktop unter 760 px Höhe ist der Zettel
kompakt (Kurzfassung neben den Knöpfen), damit das Polaroid groß bleibt. Die Regeln zum
Ersetzen bzw. Ausblenden bei späterer Rückkehr bleiben wie in main.ts.

---

## D. Technische Architektur

### D.1 Ordner `src/ui/album/`

```
src/ui/album/
  index.ts            createAlbum(deps): Album – baut alles einmal, Einstieg für main.ts
  nav.ts              navigate(), Hash parsen/schreiben (rein, ohne DOM)       ← Vitest
  history.ts          pushState/popstate ↔ nav
  book.ts             Book: Rahmen, Einband, Doppelseite/Einzelseite (matchMedia)
  spread.ts           Spread: linke + rechte Seite, Falz
  page.ts             Page: Grundgerüst einer Seite (Kopf, Seitenzahl, Scrollbereich, update/visible)
  page-turn.ts        PageTurn: Umblättern vor/zurück, Überblenden, inert, Warteschlange
  tab-strip.ts        TabStrip: Reiter (waagerecht/senkrecht), Punkte, Tastatur
  polaroid.ts         Polaroid: Rahmen, Tape, Bildunterschrift, Knopf, hält das Canvas
  fullscreen.ts       Fullscreen: Vollbild-Ebene, FLIP, Kamera-Leiste, Schließen
  tape-label.ts       TapeLabel: Etikett (Zahl Caveat, Beschriftung, 🌙, ⓘ)
  stage-ladder.ts     StageLadder: Stufenleiste mit 8 Stufen und Balken
  sticker.ts          StickerSlot: runder Sticker (Canvas-Bild, Rand, Bogen, Drehung, leer/gestrichelt)
  sticker-row.ts      StickerRow: Nischenzeile (Name, Sticker, Hinweis)
  note.ts             Note: Haftnotiz (popover, Fallback), openNote() für freie Notizen
  note-layout.ts      notePosition(): Lage der Haftnotiz (rein)                  ← Vitest
  notes-text.ts       Texte der Etiketten-Notizen (rein)                         ← Vitest
  label-notes.ts      Notizen an Wachstum, Samen, Harmonie
  season-weather.ts   Jahreszeit und Wetter in der Bildunterschrift mit Notizen
  stamps.ts           Stamps: Stempel- und Zettelschicht (ersetzt #toast)
  stamp-rules.ts      stampKind(), Standzeit, wer weicht, stampLift/stampsOnTop (rein) ← Vitest
  stamp-place.ts      Platz der Schicht: oben/unten, Ausweichen über Bestätigungen
  eco-refresh.ts      Ökosystem-Ansicht nur nach Änderungen neu, Jahreszeit/Wetter je Sekunde (Schritt 12)
  floats.ts           schwebende Zahlen und Hinweise über Szene, Samen, Pflanzring (Schritt 12)
  stage-banner.ts     Stufen-Stempel über dem Bild (Schritt 12)
  cycle-target.ts     gemeinsames Ziel des nächsten Zyklus (D.2) mit resolveTarget/isOtherTarget
  note-stack.ts       NoteStack: Zettelstapel der Begegnungen
  banderole.ts        Banderole: Update-Hinweis, neuerer Spielstand
  cover.ts            Cover: Buchumschlag (Menü)
  bookmark.ts         Bookmark: Lesezeichen-Zurück-Knopf „‹ Nischen“
  swipe.ts            Wisch-Zurück-Erkennung (reine Logik + dünne DOM-Schicht) ← Vitest
  tokens.css          CSS-Variablen (D.5)
  album.css           Grundlayout; je Komponente eine eigene .css daneben
  pages/
    niches-page.ts    R:Nischen        animal-page.ts      U:Tier
    species-page.ts   R:Arten          harmony-page.ts     U:Harmonie
    care-page.ts      R:Pflege         food-web-page.ts    U:Nahrungsnetz
    goals-page.ts     R:Ziele          plant-picker-page.ts U:Pflanze setzen
    landscape-page.ts R:Landschaft     encounter-page.ts   U:Begegnung
    cycle-page.ts     U:Neuer Zyklus   care-item-page.ts   U:Pflegemaßnahme
    achievements-page.ts, stats-page.ts, site-page.ts, return-report-page.ts,
    guide-page.ts, settings-page.ts, account-page.ts, save-page.ts
```

**Regeln für alle Seiten:**

- **Gleiche Schnittstelle:** `{ element, update(view), visible }`.
- **DOM einmal bauen.** `update` setzt nur Texte, Klassen und Variablen (`setText`, `setAttr`
  aus `dom.ts`). Neue Knoten entstehen nur, wenn neue Elemente dazukommen, wie heute.
- **Nur sichtbare Seiten werden aktualisiert.** Unsichtbare werden als `dirty` markiert und
  beim Zeigen einmal nachgezogen. Das spart den größten Teil der heutigen Frame-Arbeit.
- **Unterseiten werden je Art einmal gebaut** und beim Öffnen mit dem View gefüllt. Es gibt
  kein Neuanlegen pro Öffnen.
- **Keine Spielregeln im Album.** Aktionen gehen über Callbacks an main.ts, und die rufen
  `core/tick.ts` auf, wie heute.

### D.2 Wiederverwendung des Bestands

| Datei | Umgang |
|---|---|
| `view-model.ts`, `adapters.ts`, `view-format.ts`, `format.ts`, `hyphenate.ts`, `dom.ts`, `confirm.ts` | **unverändert** weiterverwenden. Neue Seiten bekommen ihre Daten aus denselben `to…View`-Funktionen. |
| `animal-detail-view.ts`, `cycle-view.ts`, `daily-view.ts`, `weather-view.ts`, `season-view.ts`, `landscape-view.ts`, `wildwechsel-view.ts`, `return-report-view.ts`, `achievement-view.ts`, `food-web-view.ts`, `guide-view.ts`, `account-view.ts`, `regular-wait.ts`, `settings.ts`, `sound*.ts` | **unverändert** (reine Ansichtslogik, alle getestet) |
| `camera-input.ts`, `camera-gestures.ts` | weiterverwenden. `attachCameraInput` hängt am Canvas, bekommt aber `enabled = fullscreen`. `createCameraControls` wird in die Vollbild-Ebene gehängt. |
| `feedback.ts` | weiterverwenden (`restartAnimation`, `prefersReducedMotion`, schwebende Zahlen) |
| `pwa.ts`, `save-transfer.ts`, `account-panel.ts` | Logik bleibt. Der Ort ändert sich (`mount`-Wurzel); das CSS wird angepasst. |
| `encounter-dialog.ts`, `plant-picker.ts` | Karten-Aufbau und Eingabeschutz nach `encounter-cards.ts` / `plant-offers.ts` auslagern (ohne `<dialog>`). Die Seiten in `album/pages` hängen sie ein. Die Logik bleibt erhalten. |
| `care-panel.ts` | Pure Funktionen (`careOrder`, `carePreviewText`, `careSummaryText`) nach `care-view.ts` verschieben (bleiben getestet). Die Zeilen-DOM-Logik geht in `care-page.ts` über. |
| `ecosystem-panel.ts`, `journal-dialog.ts`, `animal-detail-dialog.ts`, `cycle-panel.ts`, `landscape-map.ts`, `daily-panel.ts`, `bonus-panel.ts`, `return-report.ts`, `season-badge.ts`, `weather-badge.ts`, `encounter-stack.ts`, `help.ts` | Die Bauteile wandern in die Seiten. Pure Exporte (`slotOpensDetails`, `barWidth`, `stackIcon`, `waitingText`, `initPreferences`) werden vorher in `*-view.ts` bzw. `preferences.ts` verschoben. Am Ende werden die Dateien gelöscht (F-12). `landscape-map.ts` bleibt wahrscheinlich fast ganz erhalten (nur neue Klassen). |
| `toast-place.ts` | löschen (#7); den Test `toast-place.test.ts` mit löschen |
| *Stand Schritt 12* | Alle oben als „gelöscht (F-12)“ geführten Dateien, `album/legacy.ts` und das alte CSS der Seitenleiste und Dialoge sind gelöscht; `style.css` enthält nur noch globale Grundregeln (Reset, `.sr-only`, `#scene`, schwebende Zahlen). |
| `main.ts` | Der Game Loop bleibt. Alles, was heute Seitenleiste und Dialoge steuert (`refreshPanel`, `refreshEncounter`, `refreshPicker`, `notify`, `showToast`, `showBanner`, `overlayOpen`), geht in `album/index.ts` über. main.ts ruft nur noch `album.refresh(state, now, flags)` und `album.notify(text)` auf. Siehe G-25 zur Zuständigkeit. |

**Gemeinsamer UI-Zustand:** `albumTarget` (Ziel-Wald des nächsten Zyklus) ist heute in
`landscape-map.ts` versteckt. Künftig liegt er im Album, damit R:Landschaft, U:Standort und
U:Neuer Zyklus denselben Wert sehen. Wie heute fällt er beim Neuen Zyklus und beim Import
zurück auf „hier“. Umgesetzt in `album/cycle-target.ts`: `view()` (Ansicht der Karte, nur nach
Änderungen am Ökosystem neu), `target()`, `choose(id | null)`, `onChange`, `disarm`/`onDisarm`
(offene Bau-Bestätigungen nach Import).

### D.3 Die Szene im Polaroid

- **Ein Canvas, ein Renderer, ein Game Loop.** Der Polaroid-Rahmen bestimmt die
  CSS-Größe des Canvas:
  - mobil Breite der Seite minus 48 px, Seitenverhältnis 342 : 230 (≈ 3 : 2)
  - Desktop bis 500 × 300 (5 : 3)
- **Größenwechsel:**
  - `CanvasSizer` (ResizeObserver, entprellt ~100 ms) bleibt die einzige Größenquelle.
  - Beim Vollbild animiert FLIP nur `transform`. ResizeObserver meldet das nicht, also gibt
    es während der Animation **keinen** Neubau.
  - Am Ende wird die echte Layoutgröße gesetzt. Es folgt ein Neubau der Caches (Baum,
    Kulisse, Sprites); Teure Teile laufen über die vorhandene `IdleQueue`.
  - Beim Zurückkehren geht es genauso, nur umgekehrt.
- **Unsichtbar = nicht zeichnen:** Ist das Polaroid aus dem Bild gescrollt (mobil) oder von
  einer Unterseite verdeckt (mobil, die Hauptansicht ist weggedreht), wird `drawScene`
  übersprungen. `tick()` läuft weiter. Gemessen wird per IntersectionObserver, nicht pro
  Frame. Das ist eine kleine Änderung im Game Loop in main.ts (Flag `sceneVisible`).
- **Der Treffer-Test** wird nur im Vollbild gerufen (`hitTestScene` bekommt `fullscreen`).
- **Nacht und Wetter** zeichnet wie heute nur der Renderer. Das Papier bleibt hell. Es gibt
  keine CSS-Verbindung zu `dayPhase`.

### D.4 Tier-Sticker aus den Renderer-Zeichnungen

**Heute im Renderer:**

- Jede Art hat eine `SpriteDef` (`sprite-kit.ts`): ein Rahmen `x0, y0, x1, y1` in
  Zeicheneinheiten (1 = Grundgröße, Ursprung = Ankerpunkt, Blick nach rechts) und
  `paint(c, frame)`.
- Die Definitionen liegen in `species-sprites.ts` (`SPECIES_DEFS`), `habitat-sprites.ts`
  (`HABITAT_DEFS`, Reptilien) und `visitor-sprites.ts` (`VISITOR_DEFS`). Zusammengeführt
  werden sie im privaten `DEFS` in `animals.ts`.
- Die Zuordnung Art-ID → Zeichnung macht das private `SPECIES_KIND`. Fehlt eine Art, nimmt
  `FAMILY_KIND` die Zeichnung der Gattung.
- `SpriteCache.get(kind, frame, muted, size, dpr)` zeichnet mit `renderSprite` in ein
  Offscreen-Canvas. Gecacht wird nach Art, Bild, Größe, Pixeldichte und Variante, höchstens
  400 Einträge. `desaturate` liefert die matte Variante.

**Neue Schnittstelle** in `src/render/sticker.ts` (Aufgabe des Renderers):

```ts
export type StickerVariant = 'color' | 'muted' | 'silhouette';

/** Zeichnung für eine Art-ID oder Gast-ID (Fallback: Gattung). null, wenn gar nichts passt. */
export function stickerKind(id: string, family?: AnimalFamily): string | null;

/**
 * Sticker-Bild einer Art: quadratisch, `size` CSS-Pixel, Pixeldichte `dpr`. Die Zeichnung
 * (Bild 0) wird eingepasst (80 % der Fläche, zentriert nach ihrem Rahmen) und nicht
 * beschnitten. Gecacht nach (kind, size, dpr, variant) in eigenem LRU (max. 256), getrennt vom
 * SpriteCache der Szene. Das gelieferte Canvas ist schreibgeschützt (nie verändern).
 */
export function renderSpeciesSticker(
  id: string,
  size: number,
  opts?: { dpr?: number; variant?: StickerVariant; family?: AnimalFamily },
): HTMLCanvasElement;

/** Reine Rechnung für Tests: Maßstab und Versatz, um einen SpriteDef-Rahmen einzupassen. */
export function stickerFit(def: Pick<SpriteDef, 'x0' | 'y0' | 'x1' | 'y1'>, size: number): { scale: number; ox: number; oy: number };
```

- **Umgesetzt (Schritt 2), Abweichungen:** Schlanke Tiere (Seitenverhältnis ab 3 : 1, z. B.
  Wurm, Eidechse, Schlange) füllen bis 90 % statt 80 %, ihr Rahmen bleibt im Kreis. Wenige
  Zeichnungen haben einen engeren Sticker-Rahmen (`stickerFrame`: Glühwürmchen mit Lichthof,
  Gäste im Flug), Kranich und Falke zeigen Bild 1 (`stickerPose`, gesenkte Flügel). Unbekannte
  IDs ohne Gattung ergeben ein leeres Bild. Gemessen (Chromium, 59 Arten/Gäste, 48 px @2x):
  erstes Zeichnen farbig ≈ 7–20 ms gesamt, matt ≈ 35–45 ms, Silhouette ≈ 10 ms; mit 4-facher
  CPU-Drosselung bis ≈ 5 ms je mattem Sticker. Die Tafel: `/src/render/demo.html?stickers=1`.
- `animals.ts` exportiert dafür `spriteDefOf(kind)` und `speciesKindOf(id, family)`. Das sind
  kleine Exporte; die Logik bleibt, wo sie ist.
- **`silhouette`:** Bild 0 wird gezeichnet und mit `globalCompositeOperation = 'source-in'`
  in `--ink` (#3B3A36) bei 55 % Deckkraft gefüllt. Das ergibt die unentdeckten Arten im Reiter
  Arten. **`muted`:** über die vorhandene `desaturate`-Variante (z. B. ruhende Arten im
  Winter, ausgezogene Arten).
- **Im Album** (`StickerSlot`): Jeder Sticker hat ein eigenes kleines `<canvas>`
  (`aria-hidden`). Er zieht das Bild mit **einem** `drawImage` aus dem Cache, aber **nur,
  wenn sich Art, Variante oder Größe ändern** – nie pro Frame. Die Pixeldichte wird bei
  `resize` geprüft. Gezeichnet wird faul, erst wenn die Seite das erste Mal sichtbar ist.
- **Pflanzen** bleiben als Gruppen-Emoji (G-17). **Gäste** nutzen `VISITOR_DEFS` über
  dieselbe Funktion.
- **Drehung der Sticker:** fest aus dem Hash der Art-ID plus Platznummer, Bereich −6° bis +6°
  (`stickerTilt(id, index)` in `album/sticker.ts`, rein, testbar). Derselbe Sticker liegt so
  immer gleich schief.

### D.5 CSS-Tokens

Alle Werte stehen in `src/ui/album/tokens.css` und kommen aus den drei Mockups. Neue Farben
gibt es nur über Tokens.

```css
:root {
  /* Papier, Karton, Einband */
  --paper: #FFFDF7;          /* Seiten, Etiketten */
  --photo: #FFFFFF;          /* Polaroid-Rahmen, Sticker-Rand */
  --card: #E9DFC9;           /* Karton (Mobil-Hintergrund) */
  --desk: #CBBE9F;           /* Tisch hinter dem Buch (Desktop) */
  --binding: #6B4E3A;        /* Einband, Umschlag-Knopf */
  --binding-ink: #4A3B2C;    /* Titel auf dem Tisch */
  --spine: #D9CDB2;          /* Buchfalz */
  /* Tinte */
  --ink: #3B3A36;
  --ink-soft: #6B6553;
  --ink-faint: #8C846F;      /* künftige Stufen, Seitenzahl */
  --ink-green: #3E6B4E;      /* Wachstum, Hauptknopf, erreichte Stufe */
  --ink-green-dark: #28503A;
  --ink-seed: #8A5A2B;       /* Samen */
  --ink-red: #A8364F;        /* Harmonie, Fehler-Stempel */
  /* Washi und Zettel */
  --tape: #F4C95D;           /* Washi-Tape, Lesezeichen, aktiver Reiter Desktop */
  --tape-green: #BFD8C2;     /* Tape der Haftnotiz */
  --note-bg: #FFF4B8;        /* Haftnotiz, Zettel */
  --note-under: #F4E39A;     /* Zettel darunter (Stapel) */
  /* Linien */
  --dash: #B9AD92;           /* Etikett-Strichrand, Stufenleiste */
  --slot-dash: #C9BFA6;      /* leerer Sticker-Platz */
  --rule: #DDD3BC;           /* gepunktete Trennlinie */
  --track: #F3EDDF;          /* Balken-Hintergrund */
  --fill: #7FB069;           /* Balken-Füllung */
  /* Reiterfarben (inaktiv); aktiv = --paper (mobil) bzw. --tape (Desktop) */
  --tab-niches: #F6E3B4;     /* eigene Wahl: Mockups zeigen Nischen nur aktiv */
  --tab-species: #BFD8C2;
  --tab-care: #F2C1CC;
  --tab-goals: #C9D6EE;
  --tab-landscape: #D9C7E8;
  /* Sticker-Grund je Gattung */
  --fam-birds: #DCEBF7;  --fam-mammals: #FCE3D3; --fam-insects: #FFF2C2;
  --fam-soil: #F6E3CF;   --fam-fungi: #FDE1D6;   --fam-amphibians: #E3EDD8;
  --fam-reptiles: #E8E2C0;
  --rarity-bg: #E8E2F3;  --rarity-ink: #4A2F75; /* Pille „selten“ */
  /* Schrift */
  --font-hand: 'Caveat', 'Segoe Print', cursive;      /* nur Überschriften und Zahlen */
  --font-text: 'Nunito', system-ui, sans-serif;
  /* Abstände */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 30px;
  --page-pad-mobile: 16px 14px 12px;
  --page-pad-desk: 26px 30px;
  --niche-col: 104px;            /* Desktop: 150px */
  --sticker: 48px;               /* Desktop: 54px; Tierseite 104px */
  --sticker-border: 3px;         /* Tierseite 5px */
  --tap: 44px;                   /* Mindestgröße aller Knöpfe */
  /* Radien */
  --r-label: 12px;  --r-label-desk: 14px;
  --r-page: 16px;   --r-page-inner: 4px;
  --r-tab: 12px 12px 0 0;        /* senkrecht: 0 12px 12px 0 */
  --r-button: 10px;
  --r-book: 18px;   --r-spread: 10px;
  --r-pill: 999px;
  /* Schatten */
  --sh-photo: 0 8px 18px rgba(59,58,54,.18);
  --sh-page: 0 8px 18px rgba(59,58,54,.15);
  --sh-sticker: 0 2px 5px rgba(59,58,54,.2);
  --sh-sticker-big: 0 3px 8px rgba(59,58,54,.25);
  --sh-note: 0 8px 16px rgba(59,58,54,.25);
  --sh-slip: 0 6px 12px rgba(59,58,54,.2);
  --sh-stack-1: 4px 4px 0 var(--note-under);
  --sh-book: 0 16px 30px rgba(59,58,54,.3);
  --sh-gutter-left: inset -18px 0 24px -18px rgba(59,58,54,.35);
  --sh-gutter-right: inset 18px 0 24px -18px rgba(59,58,54,.35);
  --sh-turn: 30px 0 40px rgba(59,58,54,.35);
  /* Drehungen */
  --tilt-photo: -1.4deg;  --tilt-photo-desk: -1.5deg;
  --tilt-tape: 3deg;      --tilt-note: 2deg;
  --tilt-stack: 3deg;     --tilt-stack-desk: 2deg;
  --tilt-flavor: -1deg;   --tilt-stamp: -3deg;
  /* Bewegung */
  --turn-ms: 380ms;
  --turn-ease: cubic-bezier(.3,.7,.3,1);
  --turn-angle: -104deg;
  --turn-perspective: 1400px;
  --fade-ms: 150ms;        /* Überblenden bei reduzierter Bewegung */
  --tab-fade-ms: 120ms;
  --note-ms: 160ms;
  --stamp-ms: 220ms;
  --wobble-ms: 600ms;  --wobble-deg: 3deg;
  --flip-ms: 300ms;    /* Polaroid ↔ Vollbild */
}
```

**Schriftgrößen** (aus den Mockups):

| Element | mobil | Desktop |
|---|---|---|
| Etikett-Zahl | 26 px | 34 px |
| Etikett-Beschriftung | 11/800 | 13/800 |
| Bildunterschrift | 26 + 20 px | 30 + 22 px |
| Reiter | 21 px | 20 px senkrecht, 50 px breit (aktiv 56), mindestens 84 px hoch |
| Seitentitel | 32 px | 46 px |
| Tiername auf U:Tier | 38 px | 38 px |
| Abschnittstitel | 24 px | 24 px |
| Lesezeichen | 22 px | 22 px |
| Zettelstapel | 22 px | 22 px |
| Seitenzahl | – | 20 px, `--ink-faint` |

Die Knöpfe in Haftnotizen bekommen abweichend vom Prototyp (36 px) die volle Höhe von 44 px.

**Schriften (selbst gehostet):**

- `src/ui/album/fonts/caveat-700-latin.woff2` und `nunito-var-latin.woff2` (Achse wght
  600–800), jeweils mit `OFL.txt` daneben.
- Eingebunden per `@font-face` in `tokens.css` mit `font-display: swap`. Vite gibt die Dateien
  mit Hash nach `dist/`, und `precacheList` nimmt sie automatisch in den Offline-Cache auf
  (vite.config.ts → alle Dateien aus dist).
- Die Teilmenge Latin reicht für ä, ö, ü, ß, „ “ und –. Zusammen sind es etwa 80–100 KB.
- **Begründung der Asset-Abhängigkeit:** Die Handschrift ist der Kern der Album-Optik. Beide
  Schriften stehen unter der **SIL Open Font License 1.1**, die Einbetten, Weitergabe und
  Teilmengen erlaubt (Lizenztext muss beiliegen, Schriftname nicht als Eigenname
  weiterverkaufen). Sie werden selbst gehostet statt über Google Fonts geladen: Das Spiel
  muss offline als PWA laufen, und es gibt keinen Drittanbieter-Aufruf (Datenschutz). Es ist
  **keine npm-Abhängigkeit**; die Dateien kommen einmalig aus `github.com/google/fonts`
  (`ofl/caveat`, `ofl/nunito`).

**Altes CSS:** `style.css` (5350 Zeilen) wird schrittweise ersetzt. Am Ende bleibt nur noch,
was Album und Szene brauchen (F-12). Damit parallele PRs nicht im selben Riesen-File kollidieren,
bekommt jede Album-Komponente eine **eigene CSS-Datei** (G-19).

### D.6 Schnittstellen: Haftnotiz und Meldungen (Schritt 4)

**Haftnotiz** (`album/note.ts`):

```ts
interface NoteMore { label?: string; onMore(): void; available?(): boolean }
interface NoteContent {
  title: string;
  lines?: readonly string[];  // Absätze, leere fallen weg
  emphasis?: string;          // grüne Kernzahl („jetzt: Wachstum ×1,32“)
  more?: NoteMore;            // Knopf „Mehr ›“ (Beschriftung änderbar), schließt die Notiz
  ref?: string;               // data-ref, Standard „note“
}
// Freie Notiz an einem beliebigen Element (z. B. Tier-Tipp im Vollbild, Schritt 3).
// Es gibt nur eine; ein neuer Aufruf ersetzt den Inhalt. Rückgabe: die Notiz (hide()).
function openNote(anchor: HTMLElement, content: NoteContent): Note;
// Feste Notizen: einmal bauen, Zeilen per note.line(), Texte per setText.
function createNote(options: { id: string; title: string; ref?: string; more?: NoteMore }): Note;
function attachNote(trigger: HTMLElement, note: Note): void;   // aria-expanded, Auf/Zu per Klick
function closeNotes(): void;
```

- Umgesetzt im Vollbild (`showSceneAnimal` in `album/index.ts`): Anker ist ein unsichtbares
  Element an der zuletzt angetippten Stelle der Vollbild-Ebene. Beispiel (aus `album/index.ts`
  exportiert):
  `openNote(canvas, { title: 'Waldkauz', lines: ['Zufriedenheit 80 %', 'satt und ruhig'],
  more: { label: 'Im Album ansehen ›', onMore: () => { closeFullscreen(); openAnimal(id); } } })`.
  Als Anker taugt jedes Element im Bild; die Notiz liegt unter bzw. über ihm. Für eine Stelle
  im Canvas genügt ein kleines unsichtbares, absolut gesetztes Element an der Trefferstelle.
- Es ist immer höchstens eine Notiz offen. `nav.note` führt ihre ID; Reiterwechsel, Umblättern,
  Umschlag, Vollbild (`fullscreen: true` setzt `note: null`) und Escape schließen sie. Wer im
  Vollbild eine Notiz öffnet, setzt also zuerst das Vollbild und öffnet die Notiz danach.
- Fokus: Beim Öffnen geht er in die Notiz (`tabindex=-1`), bei „Verstanden“ und Escape zurück an
  den Auslöser, bei Klick außerhalb bleibt er, wo geklickt wurde.

**Meldungen** (`album.notify`, `album/stamps.ts`):

```ts
interface NotifyOptions {
  error?: boolean;  // roter Rahmen (Fehler einer Aktion)
  keep?: boolean;   // Zettel bis zum Schließen (Landschaft frei, v1-Hinweis, angehaltener Tab)
  brief?: boolean;  // höchstens drei Zeilen
  spoken?: string;  // nur für Screenreader angehängt (Rückkehr: Kurzfassung steht im Zettel)
  direct?: boolean; // nie in ein altes Dialog-Hinweisfeld (bis Schritt 12; früher showToast)
}
album.notify(text: string, options?: NotifyOptions): void;   // leerer Text: nichts
```

- Bis 90 Zeichen Stempel, darüber (oder mit `keep`) Zettel mit „×“. Höchstens zwei zugleich;
  die älteste weicht, bleibende Zettel zuletzt. Gleicher Text ersetzt die alte Meldung.
- Platz: seit Schritt 12/14 wie in C.5 (unten, mobil auf der Hauptansicht oben; Ausweichen in
  `stamp-place.ts`); steht eine Banderole im Bild, rückt die Schicht darunter (gemessen beim Zeigen und per
  ResizeObserver an den Banderolen, nie pro Frame). Klicks gehen durch, nur „×“ fängt sie.
- Übergang bis Schritt 12: Ist ein alter Dialog mit eigenem Hinweisfeld offen (Tagebuch),
  landet die Meldung dort, sonst verdeckte der modale Dialog den Stempel. Mit den Dialogen fällt
  diese Weiche weg (die Hilfe seit Schritt 11). Kartenwahl, Pflanzenwahl und Tierdetails sind
  seit Schritt 5/6 Unterseiten; ihre Meldungen kommen als Stempel. Verdeckt mobil eine Unterseite
  das Polaroid, meldet `overlayOpen()` das ebenfalls – main.ts sammelt die Hinweise dann in einem
  Stempel, und schwebende Notizen über der Szene (`noteText`) werden zum Stempel (A.11 #121).
- e2e: `stamps(page)` ist die Schicht (für „enthält“), `stamp(page)` die neueste Meldung,
  `settledStamp(page)` dieselbe nach dem Hereinstempeln (für Lage und Größe).

**Umschlag-Seiten** (Schritt 11): Der Umschlag öffnet `{ kind: 'guide' }` (Inhaltsverzeichnis),
`settings`, `account` und `save`. Ein Kapitel ist `{ kind: 'guide', section }` auf Ebene 2 mit
eigener Seite (`subpageKey` in `pages/registry.ts`); Weiterblättern zum Nachbarkapitel ersetzt
die oberste Seite. Der Konto-Abschnitt kommt über `album.mountAccount(section)` (sync/account.ts
über main.ts) und schaltet den Eintrag im Umschlag frei. Rückkehr: `album.showReturnReport(view)`
zeigt den Zettel und stempelt die Kurzfassung, `hideReturnReport()` blendet ihn aus.

**Banderole** (`album/banderole.ts`): `createBanderole({ tone: 'tape' | 'alert', ref, role, text,
buttons })` hängt in `album.banners`. Gelb: Update-Hinweis (`pwa.ts`, `mount: album.banners`),
rot: „neuerer Spielstand“.

---

## E. Teststrategie

### E.1 Vitest (Node, ohne DOM – wie heute)

| Bereich | Tests |
|---|---|
| `album/nav.ts` | Stapel nie tiefer als 2 (Ersetzen der obersten); Reiterwechsel leert den Stapel; Zurück-Reihenfolge Haftnotiz → Vollbild → Unterseite → Umschlag; Landschaft-Reiter verschwindet → zurück zu Nischen; Begegnung öffnen bei vollem Stapel; Hash ↔ Reiter (unbekannter Hash → Nischen, gesperrte Landschaft → Nischen) |
| `album/swipe.ts` | Schwellen für Weite, Richtung und Tempo; senkrechtes Scrollen löst nicht aus; Abbruch. Umgesetzt in 13a: `tests/album-swipe.test.ts`. |
| `album/sticker.ts` | `stickerTilt` fest und im Bereich ±6°; Zuordnung Gattung → Sticker-Farbe |
| `album/stamps` (rein) | `stampKind(text)` Stempel/Zettel an der 90-Zeichen-Grenze; Fehler erkennen; höchstens 2 sichtbar |
| `render/sticker.ts` | `stickerFit` passt jeden Rahmen ein (kein Überstand, zentriert); **jede Art aus `content/species.ts` und jeder Gast** hat eine eigene Zeichnung (`stickerKind` ≠ Gattungs-Ersatz), damit neue Arten nicht still auf den Ersatz fallen |
| Seiten-Views | neue reine Zusammenstellungen, z. B. `nichesPageHeader` („9 von 14 Plätzen“), `goalsPageView` (Punkt am Reiter bei möglichem Zyklus), `careTabDot`; Seitenzahl je Seite fest |
| verschobene Funktionen | `careOrder`, `carePreviewText`, `careSummaryText`, `slotOpensDetails`, `barWidth`, `stackIcon` – die Tests ziehen mit um (nur andere Importpfade) |
| entfallend | `tests/toast-place.test.ts` wird mit `toast-place.ts` gelöscht |

Alle heutigen View-Tests (`ui-view`, `journal-view`, `cycle-view`, `daily-view`,
`weather-view`, `season-view`, `landscape-view`, `return-report-view`, `animal-detail`,
`food-web-view`, `event-view` …) bleiben **unverändert grün**, denn die View-Schicht bleibt.

### E.2 e2e (Playwright)

**Grundsätze der Migration:**

1. **`data-ref` bleiben erhalten**, wo das Element fachlich dasselbe ist (z. B. `seeds`,
   `growth-rate`, `harmony`, `stage`, `encounter-stack`, `new-cycle`, `care`, `care-*`,
   `daily`, `landscape*`, `export*`, `import*`, `account*`, `settings-open`, `guide-open`,
   `detail-*`, `food-web-*`, `return-report*`, `update-hint`, `newer-save-banner`). Neue
   Elemente bekommen neue `data-ref` (`album`, `tab-<id>`, `page-<kind>`, `bookmark`,
   `polaroid`, `fullscreen`, `fullscreen-close`, `note`, `stamp`, `cover-open`).
2. **Neue Helfer in `e2e/fixtures.ts`:**
   - `openTab(page, 'pflege')` (Klick auf den Reiter)
   - `gotoTab(page, 'pflege')` (Hash)
   - `openCover(page)` und `back(page)` (Lesezeichen)
   - `subpage(page, kind)`
   - `openFullscreen(page)`
   - `stamp(page)` als Ersatz für den Toast
   - `dialog(page)` wird zu `subpage(page, 'encounter')`, `openStack` bleibt
3. **Texte:** Die Spieltexte bleiben gleich (Fehler, Hinweise). Es ändern sich nur Knopf- und
   Überschriften wie „Wählen“ → „Einkleben“, „Schließen“ → „‹ Zurück“, „Naturtagebuch“ →
   Reiter. Wer auf solche Texte prüft, wird angepasst.
4. **Jeder Schritt in F migriert die Specs seines Bereichs im selben PR.** Specs eines noch
   nicht umgebauten Bereichs laufen weiter, weil die Altbauteile in Schritt 1 als
   Übergangsinhalt in den Reitern hängen (F-1). Am Ende (F-13) gibt es kein `test.fixme`.

**Betroffene Specs:**

| Spec | Grad | Was sich ändert | Schritt |
|---|---|---|---|
| `smoke.spec.ts` (952 Zeilen) | hoch | Reiter öffnen, Dialog → Unterseite, Toast → Stempel, Reset im Umschlag | 1, dann je Bereich, Rest 13 |
| `playthrough.spec.ts`, `full-cycle.spec.ts` | hoch | Stapel/Begegnungsseite, Neuer Zyklus als Unterseite | 6, 9 |
| `events.spec.ts` | mittel | Begegnungsseite | 6 |
| `animal-detail.spec.ts` | hoch | Dialog → U:Tier, Schließen → Lesezeichen | 5 |
| `scene-animal-tap.spec.ts` | hoch | erst Vollbild, Tipp → Haftnotiz → „Im Album ansehen“ | 3 |
| `camera.spec.ts` | hoch | Zoom nur im Vollbild | 3 |
| `canvas-size.spec.ts` | mittel | Größe im Polaroid und im Vollbild, kein Dauer-Resize | 3 |
| `care.spec.ts`, `habitats.spec.ts` | mittel | Reiter Pflege, „Zur Pflege“-Sprung, U:Pflegemaßnahme | 8, 5 |
| `food-web.spec.ts` | mittel | U:Nahrungsnetz | 5 |
| `journal.spec.ts`, `journal-stats.spec.ts`, `journal-landscape.spec.ts`, `achievements.spec.ts` | hoch | kein Dialog mehr: Reiter Arten, U:Statistik, U:Erfolge, Reiter Landschaft | 7, 9, 10 |
| `daily.spec.ts` | niedrig | Reiter Ziele | 9 |
| `cycle.spec.ts`, `cycle-transition.spec.ts` | mittel | U:Neuer Zyklus | 9 |
| `landscape.spec.ts`, `wildwechsel.spec.ts` | mittel | Reiter Landschaft, U:Standort | 10 |
| `seasons.spec.ts`, `weather.spec.ts`, `daynight.spec.ts` | mittel | Abzeichen → Bildunterschrift + Haftnotiz | 4 |
| `return-report.spec.ts` | mittel | Zettel + U:Rückkehr-Bericht, Toast → Stempel | 11 |
| `help.spec.ts`, `sound.spec.ts` | mittel | Umschlag, U:Anleitung, U:Einstellungen | 11 |
| `account.spec.ts`, `save-transfer.spec.ts` | mittel | Umschlag → U:Konto, U:Spielstand | 11 |
| `pwa.spec.ts` | niedrig | Banderole | 11 |
| `playtest-ui.spec.ts`, `playtest6-ui.spec.ts`, `playtest6.spec.ts` | hoch | Überlappungs- und Layoutprüfungen (`.panel`, `.toast`, `.scene-dock`) neu für Album schreiben | 13 |
| `habitats-scene`, `landscape-scene`, `weather-scene` | niedrig | prüfen nur die Szene (Screenshot-Größe ggf. anpassen) | 3 |

**Neue Specs** (`e2e/album-*.spec.ts`, qa-tester):

- **Navigation:** Reiter, Hash, Neuladen öffnet denselben Reiter; Unterseite → Escape,
  Lesezeichen, Wisch (Touch-Emulation), Browser-Zurück; nie Ebene 3.
- **Reduzierte Bewegung:** Es läuft keine `rotateY`-Animation (`emulateMedia`).
- **Haftnotiz:** auf und zu, Klick außerhalb, nur eine zur Zeit.
- **Vollbild:** öffnen, zoomen, schließen, Kamera-Ansicht bleibt.
- **Zettelstapel:** Zahl, Wackel-Klasse bei neuer Begegnung, leerer Stapel blättert zurück.
- **Kein Überlauf bei 360 px:** `scrollWidth <= clientWidth` auf jeder Reiterseite und
  Unterseite.
- **Screenshots** bei 1200 × 700, 390 × 844 und 360 × 740 je Reiter (nur ansehen, kein
  Pixelvergleich).

**Stand nach Schritt 13:** Navigation und reduzierte Bewegung in `album-nav.spec.ts`,
Haftnotiz in `album-notes.spec.ts`, Vollbild in `camera.spec.ts` und `album-nav.spec.ts`,
Zettelstapel in `album-encounter.spec.ts`, 360/390/1200 samt Screenshots (Anhänge im
HTML-Bericht und in `test-results/`) in `album-viewports.spec.ts`. Messungen erst nach dem
Umblättern (`settledSubpage`, `albumAnimationsDone` in `e2e/fixtures.ts`), nie mitten in der
Drehung. Wischen: `e2e/album-swipe.spec.ts` (13a).

---

## F. Umsetzungsplan

**Arbeitsweise:**

- `claude/album-ui` wird einmal von `main` abgezweigt (Schritt 1). Jeder Schritt ist ein
  eigener Branch `claude/album-<thema>` mit **PR gegen `claude/album-ui`**.
- Am Ende gibt es **einen großen PR `claude/album-ui` → `main`**.
- `main` wird mindestens wöchentlich und vor jedem Schritt in `claude/album-ui` gemergt (G-1).
- Jeder Schritt hält `npm run check` und alle e2e-Specs grün und macht Screenshots bei
  1200 × 700 und 390 × 844.

| Schritt | Agent | Inhalt | Abhängig von | parallel möglich mit |
|---|---|---|---|---|
| **1 Grundgerüst** | ui-dev | `claude/album-ui` anlegen. Schriften und Lizenzen, `tokens.css`, `nav.ts` (+Tests), `history.ts`, Book/Spread/Page/TabStrip/PageTurn/Bookmark, Polaroid (nur Rahmen, Canvas darin), Etiketten, Stufenleiste. **Die alten Panels hängen als Übergangsinhalt in den Reitern** (Ökosystem → Nischen, Tagebuch-Knopf → Arten, Pflege + Boni → Pflege, Tagesziele + Neuer Zyklus → Ziele), Hilfe, Einstellungen und Spielstand im Umschlag. `album/index.ts` übernimmt die UI-Steuerung aus main.ts. Fixture-Helfer `openTab`, `gotoTab`, `openCover`; bestehende Specs anpassen. | – | 2 |
| **2 Sticker-Renderer** | renderer | `render/sticker.ts` mit `renderSpeciesSticker`, `stickerKind`, `stickerFit`, Varianten `muted`/`silhouette`, LRU; kleine Exporte in `animals.ts`; Tests (jede Art eigene Zeichnung); Sticker-Tafel in der Render-Demo | – | 1 |
| **3 Polaroid und Vollbild** | ui-dev (renderer prüft Größen und Caches) | FLIP-Vollbild mit demselben Canvas, Kamera nur im Vollbild, Tier-Tipp → Haftnotiz-Platzhalter, `sceneVisible` (Zeichnen aussetzen), Bildunterschrift, Stufen-Stempel. Specs: camera, scene-animal-tap, canvas-size, *-scene | 1 | 4 (nur nach Absprache über main.ts), 2 |
| **4 Haftnotiz und Stempel** | ui-dev | `Note` (popover + Fallback), `Stamps` (ersetzt Toast und `toast-place.ts`), einheitliches `notify`, Banderole, Notizen für Jahreszeit, Wetter, Etiketten (Harmonie mit „Verstanden“/„Mehr“), Nacht, Gattungen. Specs: seasons, weather, daynight, Toast-Prüfungen in smoke | 1 | 3, 2 |
| **5 Reiter Nischen** | ui-dev | Stickerreihen (braucht 2), Gattungen, Lebensräume, Pflanzring, „Zur Pflege“; U:Tier, U:Harmonie, U:Nahrungsnetz; Ersatz für `ecosystem-panel.ts` und `animal-detail-dialog.ts`. Specs: animal-detail, food-web, habitats | 2, 4 | 8, 9, 11 |
| **6 Begegnungen** | ui-dev | Zettelstapel mit Wackeln, U:Begegnung (Karten aus `encounter-cards.ts`, Legende als Haftnotiz), U:Pflanze setzen; Ersatz für `encounter-dialog`, `encounter-stack`, `plant-picker`. Specs: events, playthrough, full-cycle (Begegnungsteil), smoke (Kartenwahl) | 4; für „Pflanze setzen“ 5 | 8, 9, 11 |
| **7 Reiter Arten** | ui-dev | Sticker-Raster (Silhouetten), Pflanzen, Gemeinschaften, Andenken, Stammgast-★; Tipp → U:Tier; Ersatz für den Tagebuch-Dialog (ohne Erfolge, Statistik, Landschaft). Specs: journal | 5 | 8, 9, 10 |
| **8 Reiter Pflege** | ui-dev | „Gerade wirksam“, Pflegeliste, U:Pflegemaßnahme, Punkt am Reiter, `reveal`; Ersatz für `care-panel` und `bonus-panel`. Specs: care | 4 | 5, 6, 7, 9 |
| **9 Reiter Ziele** | ui-dev | Tagesziele, Kurzkarte Zyklus, U:Neuer Zyklus (Baumwahl, Stammgäste), U:Erfolge, U:Statistik; Ersatz für `daily-panel`, `cycle-panel` und Tagebuch-Erfolge/-Statistik. Specs: daily, cycle, cycle-transition, achievements, journal-stats, full-cycle | 4 | 5, 6, 7, 8 |
| **10 Reiter Landschaft** | ui-dev | Karte im Album-Stil, U:Standort, Korridore, Wälder, Wildwechsel-Zeile, gemeinsames `albumTarget`; Tagebuch-Teil Landschaft. Specs: landscape, journal-landscape, wildwechsel | 9 | 7, 11 |
| **11 Umschlag und Zettel** | ui-dev | Umschlag final: Anleitung als Kapitel-Unterseiten, Einstellungen, Konto, Spielstand + Löschen, „Neu hier?“-Notiz; Rückkehr-Zettel + U:Rückkehr-Bericht; Update- und Neuer-Stand-Banderole. Specs: help, sound, account, save-transfer, pwa, return-report | 4 | 5–10 |
| **12 Aufräumen** | ui-dev | Altbauteile und altes CSS löschen, `toast-place` samt Test entfernen, `index.html` neu (Album-Gerüst, `theme-color` = Karton), UI-Demo als Album-Demo, `DESIGN_V2.md` Abschnitt 11 und README-Bilder aktualisieren | 5–11 | – |
| **13 e2e-Abschluss** | qa-tester | übrige Specs (smoke-Rest, playtest*-UI-Specs neu), neue `album-*`-Specs (E.2), kein `test.fixme`, Lauf auf 360/390/1200 | 12 | Die `album-nav`-Spec kann qa-tester schon nach Schritt 1 schreiben. |
| **14 Playtest und Feinschliff** | qa-tester → ui-dev / renderer | zwei Playtests (Handy, Desktop) mit Screenshots, Funde beheben, Leistung messen (FPS mobil, Zeit pro Frame mit offenem Reiter Arten), dann PR `claude/album-ui` → `main` | 13 | – |

**Rollen:**

- **core-engineer** braucht es nur zum **Review der Änderungen an `main.ts`** in den
  Schritten 1 und 3 (Game Loop, `sceneVisible`, Auslagern der UI-Steuerung). Es gibt keine
  Änderung an `GameState` und kein `SAVE_VERSION`.
- **renderer:** Schritt 2 und Prüfung von 3.
- **qa-tester:** Schritte 13 und 14, auf Wunsch Review der Spec-Migration in jedem Schritt.

**Kritischer Pfad:** 1 → 4 → (2) → 5 → 7 → 12 → 13 → 14. Die Schritte 6, 8, 9, 10 und 11
laufen daneben. Damit nicht alle zugleich `album/index.ts` ändern, registriert sich jede
Reiterseite selbst über `album/pages/registry.ts` (eine Zeile pro Seite).

---

## G. Risiken und eigene Entscheidungen

### G.1 Risiken

| # | Risiko | Gegenmaßnahme |
|---|---|---|
| R1 | **Langlebiger Branch:** Auf `main` läuft Phase 7 weiter (2b, 3a: Baumwahl mit fünf Arten). Konflikte in `cycle-panel.ts`, `landscape-map.ts`, `main.ts` | `main` regelmäßig in `album-ui` mergen. UI-Aufgaben aus Phase 7, die noch offen sind (3a), möglichst **im Album** umsetzen statt doppelt (G-1). |
| R2 | **e2e-Aufwand:** 35 Specs, viele auf alte Texte und Selektoren | `data-ref` behalten, Übergangsinhalt in Schritt 1, Migration pro Bereich, Fixture-Helfer |
| R3 | **Leistung:** viele Sticker-Canvas (Reiter Arten: über 50 Arten + Pflanzen); 3D-Drehung auf schwachen Android-Geräten | Sticker faul und nur bei Änderung zeichnen, LRU-Cache; nur ein Element animiert; unsichtbare Seiten nicht aktualisieren; Szene nicht zeichnen, wenn verdeckt. Messen in Schritt 14. **Schritt 14 (S9):** Umblättern ohne erbende Stil-Neuberechnung der Hauptansicht (`inert` erst im gesperrten Teilbaum, `content-visibility: hidden` für weggedrehte Seiten), drehende Hauptansicht mobil auf den sichtbaren Streifen zugeschnitten. Reiter Arten: `content-visibility: auto` je Gattungsblock ausprobiert und verworfen (erster Wechsel kaum kürzer, dafür Long Tasks beim Scrollen). Rest: jedes Sticker-Canvas ist eine eigene Compositing-Ebene (über 70 Ebenen auf Nischen) – bei Software-Raster (headless) bremst das den Compositor. |
| R4 | **Neubau der Render-Caches** beim Vollbild-Wechsel (spürbarer Ruckler) | FLIP nur mit transform, ein einziges Resize am Ende, `IdleQueue`. Falls es trotzdem ruckelt: die Vollbild-Größe im Hintergrund vorbereiten (Renderer-Aufgabe). |
| R5 | **Caveat-Zahlen springen** (keine Ziffern gleicher Breite) bei laufenden Werten | Feste Mindestbreite je Etikett (`min-width` in ch), Zahl rechtsbündig. Samen nur bei neuer ganzer Zahl aktualisieren (gibt es schon). |
| R6 | **5 Reiter bei 360 px** (Caveat 21 px) passen nicht | Innenabstand 10 px, bei Überlauf waagerecht scrollbar mit gewähltem Reiter im Bild (wie heute im Tagebuch). Vier Reiter passen; Landschaft kommt erst spät hinzu. **Seit Schritt 12:** `tab-strip.ts` misst bei Größen- und Schriftwechsel und schaltet stufenweise (`data-fit`): enger/kleiner → Symbole statt Namen (der gewählte Reiter behält ihn) → Name kleiner → nur Symbole. Geprüft mit DejaVu Sans und 125 % bei 360/390 px (`e2e/album-layout.spec.ts`). |
| R7 | **`popover` fehlt** auf älteren iOS-Versionen | Fallback mit Klasse und Klick-außerhalb (C.4) |
| R8 | **Gesten-Konflikte:** iOS-Rand-Wischen, Kartenreihe, Kamera | Verlauf per `pushState`, damit das iOS-Zurück dasselbe tut; Wisch-Zurück beginnt nie in den linken 20 px; `data-no-swipe`; Kamera nur im Vollbild (dort schließt nur der Wisch nach unten, C.6) |
| R9 | **Schriften laden verzögert** (Layout springt beim ersten Start) | `font-display: swap`, ähnliche Fallback-Schriften, Precache. Danach kommen sie immer aus dem Cache. |
| R10 | **Verlust kleiner Funktionen** beim Umbau (z. B. Fokus-Rückgabe, Doppelklick-Schutz, Live-Ansagen) | Tabelle A als Prüfliste im PR jedes Schritts abhaken, Review gegen die `#`-Nummern |
| R11 | **Großer Abschluss-PR** schwer zu prüfen | Er besteht aus bereits geprüften Teil-PRs. Der Reviewer prüft dort nur noch Merge-Stand, Specs und Screenshots. |

### G.2 Eigene Entscheidungen (mit Begründung)

1. **Phase-7-UI im Album:** Offene UI-Aufgaben von Phase 7 (3a Baumwahl mit fünf Arten)
   werden möglichst auf `claude/album-ui` umgesetzt, Logik-Aufgaben weiter auf `main`.
   **Warum:** Die alte Oberfläche wird verworfen; doppelte Arbeit und Merge-Konflikte fallen
   weg. *Der Nutzer sollte das bestätigen*, denn es verschiebt 3a zeitlich.
2. **Desktop blättert nur die rechte Seite**, mobil die ganze Hauptansicht (wie im
   Prototyp). **Warum:** Am Desktop soll das Polaroid immer sichtbar bleiben. Mobil gibt es
   keinen Platz für beides.
3. **Reiterwechsel ohne Umblättern** (nur 120 ms Überblenden). **Warum:** Häufiges Wechseln
   soll schnell bleiben. Umblättern kennzeichnet „tiefer hinein“.
4. **Reiterwechsel leert den Unterseiten-Stapel.** **Warum:** Das ist einfacher und
   vorhersehbar. Es gibt keine „versteckten“ offenen Seiten in anderen Reitern.
5. **Ebene 3 ersetzt die oberste Seite**, statt verboten zu sein. **Warum:** So funktionieren
   Links von Ebene 2 aus trotzdem, und „Zurück“ führt nie tiefer als zwei Schritte.
6. **History-API für Unterseiten, Hash nur für den Reiter.** **Warum:** Die Android-Zurück-
   Taste und das iOS-Wischen sollen eine Seite zurückblättern, statt die App zu schließen.
   Unterseiten nach dem Neuladen wiederherzustellen ist fehleranfällig (Inhalt veraltet).
7. **Doppelseite nur im Querformat ab 760 px.** Tablets im Hochformat bekommen die
   Einzelseite (größer gesetzt, Polaroid höchstens 560 px breit). **Warum:** Eine Doppelseite
   im Hochformat ergäbe zwei sehr schmale Seiten. 760 px ist schon heute die Grenze zwischen
   ein- und zweispaltig.
8. **Begegnung als Unterseite statt Modal.** „Später“ ist das Lesezeichen „‹ Später“.
   **Warum:** Das passt zum Buch und braucht nur einen Navigationsweg. Die Szene bleibt am
   Desktop links sichtbar.
9. **Pflanzenwahl, Pflegemaßnahme, Neuer Zyklus, Erfolge, Statistik, Rückkehr-Bericht und
   Standort sind Unterseiten.** Kurze Erklärungen (Jahreszeit, Wetter, Gattung, Nacht,
   Etiketten, Pflanze im Raster, Legende) sind Haftnotizen. **Warum:** Das folgt Entscheidung 2
   des Nutzers. Alles mit Aktionen oder langen Listen gehört auf eine Seite.
10. **Statistik und Erfolge unter „Ziele“, Andenken unter „Arten“.** **Warum:** Es gibt nur
    fünf Reiter. Erfolge und Statistik sind Fortschritt, Andenken sind Sammelstücke.
11. **Zieht eine Art aus, während U:Tier offen ist, bleibt die Seite offen** (Tagebuch-
    Ansicht mit „ist ausgezogen“). **Warum:** Automatisches Zurückblättern wirkt wie ein
    Fehler. Heute schließt der Dialog nur, weil es keine Tagebuch-Ansicht der Art gab.
12. **„Zuerst gesehen“ aus dem Prototyp entfällt vorerst.** **Warum:** Wann eine Art entdeckt
    wurde, steht nicht im Spielstand. Es bräuchte `SAVE_VERSION` und eine Migration (also
    core-engineer), ohne dass alte Stände den Wert kennen. Das kann später eine eigene Aufgabe
    werden.
13. **Punkte an Reitern:** Pflege (etwas kaufbar), Ziele (Neuer Zyklus möglich). **Warum:**
    Ersetzt die Zusammenfassungen, die heute in der Leiste immer zu sehen waren.
14. **Mobil klebt die Reiterleiste oben und bekommt eine schmale Vorratsleiste**, sobald die
    Etiketten weggescrollt sind. **Warum:** Heute sieht man die Raten beim Scrollen der Leiste
    auch nicht. Das Album soll das besser machen, mit wenig Aufwand (IntersectionObserver).
15. **Im Polaroid keine Kamera und kein Tier-Tipp.** **Warum:** Das Polaroid ist klein, und
    Zoomgesten würden mit dem Seiten-Scrollen kollidieren. Der Nutzer will Antippen =
    vergrößern.
16. **Tier-Tipp im Vollbild öffnet erst eine Haftnotiz** mit „Im Album ansehen“. **Warum:** Der
    Spieler bleibt in der Szene, bis er mehr will. Ein direkter Seitenwechsel würde das
    Vollbild ungefragt schließen.
17. **Pflanzen-Sticker mit Gruppen-Emoji**, nicht mit Renderer-Zeichnung. **Warum:** Die
    Pflanzen werden im Renderer abhängig von Layout und Jahreszeit gemalt (`paintPlant` mit
    `PlacedPlant`). Ein Sticker daraus wäre eine eigene Renderer-Aufgabe. Entscheidung 7 des
    Nutzers nennt nur Tiere.
18. **Unentdeckte Arten als Silhouette** (Renderer-Variante) statt „???“-Emoji. **Warum:** Das
    ist das klassische Sammelalbum-Gefühl, kostet nur eine Compositing-Zeile und braucht keine
    neue Zeichnung.
19. **CSS je Komponente in eigenen Dateien**, Tokens zentral. **Warum:** Parallele PRs (Schritte
    5–11) kollidieren sonst ständig in einer `style.css` mit über 5000 Zeilen.
20. **Seltenheit über Randfarbe und Edelstein am Sticker**, Text nur in der Pille und für
    Screenreader. **Warum:** Wenig Platz bei 48 px; die Pille auf U:Tier nennt es ausgeschrieben.
21. **Haftnotiz-Knöpfe 44 px** statt 36 px wie im Prototyp. **Warum:** Regel „Buttons ≥ 44 px“.
22. **`popover`-API mit Fallback.** **Warum:** Light-Dismiss, Escape und oberste Ebene gibt es
    gratis; der Fallback deckt ältere iOS-Versionen ab.
23. **Stempel ab 90 Zeichen als Zettel.** **Warum:** Lange Sammelmeldungen (Rückkehr,
    Landschaft) passen nicht in einen Stempel. 90 Zeichen sind etwa zwei Zeilen bei 360 px.
24. **Keine neuen Klänge** (kein Blätter-Geräusch). **Warum:** Das geht über den Auftrag
    hinaus, und der Klang ist standardmäßig aus. Es kann später nachkommen.
25. **Die UI-Steuerung wandert aus `main.ts` nach `album/index.ts`** (ui-dev, Review durch
    core-engineer). **Warum:** main.ts gehört dem core-engineer, enthält heute aber rund 400
    Zeilen reine Oberflächensteuerung. Ohne Auslagern müsste jeder Album-Schritt main.ts
    anfassen.
26. **Seitenzahlen sind fest je Seite** (z. B. Nischen 12, Arten 24 …). **Warum:** Schmuck aus
    dem Desktop-Mockup; feste Werte springen nicht.
27. **Stufenleiste mit allen 8 Stufen** (Samen, Keimling, Setzling, Junger Baum, Alter Baum,
    Hain, Wald, Urwald). **Warum:** Das Desktop-Mockup zeigt sieben, „Wald“ fehlt dort. Es
    zählt die Quelle `content/stages.ts`.
28. **Aktiver Reiter:** mobil Papierfarbe (verschmilzt mit der Seite, Mockup „hoch“), Desktop
    Washi-Gelb und 6 px breiter (Desktop-Mockup). Inaktiv bekommt Nischen ein helles Ocker
    (#F6E3B4), weil beide Mockups ihn nur aktiv zeigen und Gelb am Desktop schon „aktiv“ bedeutet.
    **Warum:** Beide Mockups übernehmen, wie sie sind; nur die fehlende Farbe ist ergänzt.

### G.3 Offene Punkte aus Schritt 1 (für Schritt 3 und 12)

- **Kamera-Knöpfe im Polaroid** (bis Schritt 3): oben rechts; `toast-place.ts` zählt sie als
  Hindernis. Mit dem Vollbild (Schritt 3) entfällt beides.
- **Gedrehtes Live-Canvas:** Das Polaroid ist um −1,4° bzw. −1,5° gedreht. `camera-input.ts`
  rechnet die Drehung über `offsetX/Y` heraus. Schärfe und Leistung prüft der renderer in
  Schritt 3.
- ~~**`encounter-stack.ts`:** Das Album schaltet Schweben, Marker und IntersectionObserver per
  `{ float: false }` ab.~~ Erledigt in Schritt 6: ersetzt durch `album/note-stack.ts`, samt
  `watchScroll` und dem CSS für `.scene-dock` gelöscht.
- ~~**Lizenztexte der Schriften** liegen nur im Quellcode, nicht in `dist/`.~~ Erledigt in
  Schritt 12: Sie werden mit ausgeliefert – `public/licenses/OFL-Caveat.txt` und
  `OFL-Nunito.txt` landen in `dist/licenses/` (geprüft in `e2e/album-layout.spec.ts`).
- ~~**`album/legacy.ts`** wird mit jedem Schritt kleiner und in Schritt 12 gelöscht.~~ Erledigt:
  gelöscht; Ökosystem-Auffrischung in `album/eco-refresh.ts`, schwebende Zahlen in
  `album/floats.ts`, Stufen-Stempel in `album/stage-banner.ts`, der Rest in `album/index.ts`.
- **Tagebuch-Teil „Landschaft“:** erledigt in Schritt 10 – steht als „Tagebuch der Wälder“ in
  R:Landschaft (Stammgäste und Tiere zusätzlich auf U:Standort); `ui/journal-landscape.ts` und
  die `.journal-*`-Regeln in `style.css` sind gelöscht.
- ~~**Neuladen auf einer Unterseite (Review KANN 5):** Der aktuelle Eintrag wird `album:0`,
  die älteren Einträge (`album:1`, Grundeintrag) liegen aber noch darunter. Die ersten zwei
  Zurück-Drücke bleiben ohne sichtbare Wirkung, erst der dritte verlässt die App.~~ Erledigt in
  Schritt 12: `history.go(-n)` beim Start, wenn der Verlauf lang genug ist (C.2, Vitest in
  `tests/album-history.test.ts`).
- ~~**Veralteter Hash nach `landscape-locked` bei offenem Umschlag (Review KANN 7):** Reiter
  Landschaft → Umschlag → alten Stand importieren → Umschlag schließen: `go(-1)` landet auf
  dem Grundeintrag mit `#landschaft`, angezeigt wird Nischen. Folgenlos, weil `tabFromHash`
  zurückfällt.~~ Erledigt in Schritt 12: Der `hashchange`-Handler ersetzt einen Hash, der nicht
  zum gezeigten Reiter passt.
- ~~**`toast-place.ts` misst `.polaroid .scene-camera` (Review KANN 9):** Solange einspaltig ein
  Toast sichtbar ist, gibt es pro Frame ein `getBoundingClientRect()`. Entfällt mit Schritt 4
  (toast-place wird gelöscht).~~ Erledigt: `toast-place.ts` samt Test ist seit Schritt 4 gelöscht.
