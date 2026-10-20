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
| 2 | Setzling | 100 | Dünner Stamm, erste Blätter |
| 3 | Junger Baum | 1.000 | Krone verzweigt sich |
| 4 | Alter Baum | 10.000 | Dicker Stamm, volle Krone |
| 5 | Hain | 100.000 | Weitere Bäume erscheinen |
| 6 | Wald | 1.000.000 | Viele Bäume |
| 7 | Urwald | 10.000.000 | Dichter Wald |

Die Stufe richtet sich nach der **in diesem Durchgang insgesamt erzeugten Energie**,
nicht nach dem aktuellen Vorrat – Ausgeben wird also nie bestraft.

## Upgrades (MVP, implementiert)

Kosten: `baseCost · costGrowth^Stufe`

| ID | Name | ab Stufe | Basis | Wachstum | Effekt pro Stufe |
|---|---|---|---|---|---|
| root-hairs | Wurzelhaare | Samen | 5 | 1,15 | +0,5 Wasser/s |
| cotyledon | Keimblatt | Samen | 5 | 1,15 | +0,5 Licht/s |
| chlorophyll | Chlorophyll | Keimling | 20 | 1,20 | +1 Photosynthese/s |
| taproot | Pfahlwurzel | Setzling | 120 | 1,17 | +3 Wasser/s |
| canopy | Blätterkrone | Setzling | 120 | 1,17 | +3 Licht/s |
| chloroplasts | Chloroplasten | Junger Baum | 900 | 1,22 | +8 Photosynthese/s |

> ⚠️ Die Zahlen sind ein erster Wurf und **nicht gebalanced**. Ab „Alter Baum“ fehlen
> Upgrades – das ist die erste Aufgabe für den `game-designer`.

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
