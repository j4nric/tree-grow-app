# Game Design – Vom Samen zum Wald

## Vision

Ein ruhiges, grafisches Incremental Game. Du bist ein Samen und wächst – sichtbar –
über einen Baum bis zu einem riesigen Urwald. Jede Entscheidung soll sich im Bild
zeigen: mehr Wurzeln, mehr Blätter, mehr Bäume.

**Gefühl:** entspannt, organisch, belohnend. Keine Hektik, keine Bestrafung.

## Kernschleife

```
Wurzeln ──► 💧 Wasser ─┐
                       ├─► Photosynthese ──► 🍬 Energie ──► Upgrades kaufen
Blätter ──► ☀️ Licht  ─┘    (begrenzt durch                       │
                             Kapazität)                            ▼
                                               Gesamtenergie ──► nächste Stufe
```

- Wasser und Licht werden produziert und gesammelt.
- **Photosynthese** wandelt pro Sekunde bis zu *Kapazität* Einheiten Wasser + Licht
  in Energie um (1 Wasser + 1 Licht → 1 Energie).
- Energie im Gleichgewicht = `min(Wasser/s, Licht/s, Kapazität)`.
  → Der Spieler muss Wurzeln, Blätter und Photosynthese **ausbalancieren**. Das ist
  die zentrale Entscheidung des frühen Spiels.
- Der Button „Wachsen“ gibt sofort +1 Wasser und +1 Licht (aktives Spiel am Anfang).

## Wachstumsstufen (MVP, implementiert)

| # | Stufe | Gesamtenergie | Grafik |
|---|---|---|---|
| 0 | Samen | 0 | Samen im Boden, Keim schiebt sich heraus |
| 1 | Keimling | 10 | Erste Verzweigung |
| 2 | Setzling | 300 | Dünner Stamm, erste Blätter |
| 3 | Junger Baum | 3.000 | Krone verzweigt sich |
| 4 | Alter Baum | 40.000 | Dicker Stamm, volle Krone |
| 5 | Hain | 300.000 | Weitere Bäume erscheinen |
| 6 | Wald | 3.000.000 | Viele Bäume |
| 7 | Urwald | 30.000.000 | Dichter Wald |

Die Schwellen bis „Hain“ sind per Simulation gebalanced (siehe „Balancing-Ziele“).
„Wald“ und „Urwald“ sind nur grob mit Faktor 10 fortgeschrieben.

Die Stufe richtet sich nach der **in diesem Durchgang insgesamt erzeugten Energie**,
nicht nach dem aktuellen Vorrat – Ausgeben wird also nie bestraft.

## Upgrades (MVP, implementiert)

Kosten: `baseCost · costGrowth^Stufe`

| ID | Name | ab Stufe | Basis | Wachstum | Effekt pro Stufe |
|---|---|---|---|---|---|
| root-hairs | Wurzelhaare | Samen | 12 | 1,30 | +0,5 Wasser/s |
| cotyledon | Keimblatt | Samen | 12 | 1,30 | +0,5 Licht/s |
| chlorophyll | Chlorophyll | Keimling | 30 | 1,22 | +1 Photosynthese/s |
| taproot | Pfahlwurzel | Setzling | 120 | 1,17 | +3 Wasser/s |
| canopy | Blätterkrone | Setzling | 120 | 1,17 | +3 Licht/s |
| chloroplasts | Chloroplasten | Junger Baum | 1.400 | 1,24 | +8 Photosynthese/s |
| root-network | Wurzelgeflecht | Alter Baum | 4.000 | 1,33 | +20 Wasser/s |
| leader-shoot | Wipfeltrieb | Alter Baum | 4.000 | 1,33 | +20 Licht/s |
| stomata | Spaltöffnungen | Alter Baum | 7.500 | 1,30 | +50 Photosynthese/s |
| root-grafts | Wurzelverwachsung | Hain | 15.000 | 1,30 | +60 Wasser/s |
| shade-leaves | Schattenblätter | Hain | 15.000 | 1,30 | +60 Licht/s |
| young-growth | Jungwuchs | Hain | 25.000 | 1,30 | +150 Photosynthese/s |

Wasser- und Licht-Upgrades einer Stufe sind bewusst symmetrisch, damit die
Entscheidung „Wurzeln, Blätter oder Photosynthese?“ allein vom aktuellen Engpass abhängt.
Die Hain-Upgrades kosten beim Erreichen des Hains (~200 Energie/s) etwa 1–2 Minuten
Produktion, damit es direkt etwas Neues zu kaufen gibt.

## Geplante Systeme (noch nicht implementiert)

### Nährstoffe & Pilznetzwerk (Mykorrhiza)
- Neue Ressource 🌱 Nährstoffe, benötigt für größere Upgrades.
- Pilznetzwerk = **Automatisierung**: Sammelt Nährstoffe, später kauft es automatisch
  günstige Upgrades.

### Jahreszeiten
- Ein Jahr dauert z. B. 4 × 3 Minuten.
- Frühling: Wachstumsbonus · Sommer: viel Licht · Herbst: Samen fallen · Winter: Ruhe,
  Produktion halbiert, dafür Bonus „Winterreserve“ im Frühling.
- Grafik: Laubfarbe, Blätter fallen, Schnee.

### Samen & Prestige („Neuer Zyklus“)
- Ab „Alter Baum“ produziert der Baum 🌰 Samen.
- **Prestige:** Ein Waldbrand oder das natürliche Ende eines Zyklus setzt Energie,
  Upgrades und Stufe zurück. Gesammelte Samen bleiben und geben dauerhafte Boni
  („Aus der Asche wächst ein stärkerer Wald“).
- Samen-Formel (Vorschlag): `floor((totalEnergy / 1e5)^0.5)`.
- Samen-Shop: dauerhafte Upgrades (Startboni, schnellere Stufen, neue Baumarten).

### Ereignisse
- Zufällige Ereignisse alle paar Minuten: Regenschauer (+Wasser), Sonnentag (+Licht),
  Dürre, Schädlinge (abwehrbar per Klick), Sturm.
- Zufall nur über einen gespeicherten Seed im GameState (Determinismus!).

### Tiere & Helfer
- Eichhörnchen verteilen Samen (mehr Bäume im Hain), Vögel bringen Dünger,
  Bienen bestäuben (Bonus auf Samen).

### Baumarten (späteres Spiel)
- Nach dem ersten Prestige: Eiche (robust), Birke (schnell), Kiefer (winterfest) –
  jede Art mit eigener Grafik und eigenen Boni.

## Balancing-Ziele

| Meilenstein | Ziel-Spielzeit (aktiv) |
|---|---|
| Keimling | < 30 Sekunden |
| Setzling | ~ 2 Minuten |
| Junger Baum | ~ 8 Minuten |
| Alter Baum | ~ 25 Minuten |
| Hain | ~ 1 Stunde |
| Erstes Prestige sinnvoll | 1–2 Stunden |

Zwischen zwei Käufen sollen am Anfang selten mehr als ~30 Sekunden vergehen.

### Simulation

`scripts/simulate.ts` spielt das Spiel mit der echten Logik (`tick`, `clickGrow`,
`buyUpgrade`) in 0,1-s-Schritten durch. `tests/balance.test.ts` prüft die Ziele mit
Toleranz Faktor 2 und gibt die Tabelle aus:

```bash
npx vitest run tests/balance.test.ts --silent=false
```

**Standardspieler:** klickt 2 Minuten lang 3×/s, bis Minute 10 noch 1×/s, danach gar
nicht mehr. Er kauft das Upgrade, das min(Wasser/s, Licht/s, Photosynthese) erhöht
(Klicks zählen als Wasser/Licht mit) und dabei die kürzeste Summe aus „Wartezeit bis
bezahlbar“ und „Amortisationszeit“ hat. Hilft kein Upgrade direkt, verbessert er das
knappste freigeschaltete Glied.

| Meilenstein | Ziel | Simuliert (vorher) | Simuliert (jetzt) | Energie/s beim Erreichen |
|---|---|---|---|---|
| Keimling | < 30 s | 10 s | 10 s | – (nur Klicks) |
| Setzling | ~ 2 min | 0:53 min | 1:51 min | 1,5 |
| Junger Baum | ~ 8 min | 3:00 min | 7:26 min | 13 |
| Alter Baum | ~ 25 min | 10:16 min | 26:18 min | 54 |
| Hain | ~ 60 min | 32:48 min | 59:30 min | 205 |
| Wald | – | 153 min | 132 min | 964 |

„Vorher“ = alte Zahlen (Schwellen in Zehnerpotenzen, ohne Upgrades ab „Alter Baum“)
mit derselben Strategie. Längste Wartezeit zwischen zwei Käufen bis „Junger Baum“:
30 s (die Zeit bis zum ersten Kauf, Chlorophyll). Danach liegen typischerweise
40–90 s zwischen Käufen, vereinzelt bis ~2 min.

**Gelegenheitsspieler** (klickt nur in der ersten Minute 1×/s): Setzling 3:29 min,
Junger Baum 9:59 min, Alter Baum 28:42 min, Hain 61:57 min.
