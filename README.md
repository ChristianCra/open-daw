# open-daw

Eine freie, quelloffene Digital Audio Workstation (DAW) mit einem clip-basierten Workflow:
Clips in einem Raster live starten, MIDI bearbeiten und erzeugen, mit Instrumenten und Effekten
arbeiten, alles in einem Fenster.

Das Projekt ist eine **eigenständige Neuentwicklung**. Es enthält keinen Code, keine Assets und
kein UI-Design anderer DAWs. Mehr dazu in [docs/REVERSE-ENGINEERING.md](docs/REVERSE-ENGINEERING.md).

## Was schon geht

- **Clip-Raster** mit Szenen, Start quantisiert auf den nächsten Takt, Stop pro Spur
- **Piano-Roll** mit Tonart-/Skalen-Hervorhebung, „Fold“, Velocity und Wahrscheinlichkeit pro Note
- **MIDI Tools**: Generatoren (Melodie, Akkorde, euklidische Rhythmen) und Transformationen
  (Arpeggio, Strum, Verzierungen, Rhythmus-Variation, Accelerando/Ritardando, Quantize, Humanize, …)
- **Stimmungen**: 12-TET, reine Stimmung, pythagoreisch, 19/24/31-EDO
- **Instrumente**: subtraktiver Synth, synthetisiertes Drum-Kit
- **Effekte**: „Drive“ (3-Band-Sättigung), Delay-Send
- **Mixer** mit Pegelanzeige, Pan, Mute, Solo
- **MIDI-Keyboards** über Web MIDI: live spielen, aufnehmen, Pitchbend/MPE
- Undo/Redo, Speichern/Öffnen als JSON, Export einzelner Clips als MIDI-Datei
- Installierbar als App (PWA), läuft offline

Vollständige Liste und Roadmap: [docs/FEATURES.md](docs/FEATURES.md).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer.

```bash
npm install
npm run dev     # Entwicklungsserver auf http://localhost:5173
npm test        # Unit-Tests
npm run build   # Produktions-Build nach dist/
```

## Unter Windows installieren

1. Die App in **Microsoft Edge** oder **Google Chrome** öffnen (lokal mit `npm run build && npm run preview`
   oder über die GitHub-Pages-Adresse, sobald Pages aktiviert ist).
2. In der Adressleiste auf das Symbol **„App installieren“** klicken.
3. open-daw erscheint danach im Startmenü und läuft in einem eigenen Fenster, auch offline.

Ein klassischer Windows-Installer (.msi/.exe) auf Basis von Tauri ist in Arbeit.

## Bedienung

| Aktion | So geht's |
| --- | --- |
| Play/Stop | Leertaste |
| Clip anlegen | Doppelklick auf leeren Slot |
| Clip starten | ▶ im Clip oder ▶ Szene |
| Note zeichnen | Klicken und nach rechts ziehen |
| Note löschen | Klick auf die Note |
| Wahrscheinlichkeit | Shift+Klick auf eine Note (100 → 75 → 50 → 25 %) |
| Rückgängig/Wiederholen | Strg+Z / Strg+Shift+Z |
| MIDI-Keyboard | „🎹 MIDI verbinden“, dann ● für Aufnahme |

## Architektur

```
src/
  model.ts             Projekt-Datenmodell (reines JSON)
  engine/              Audio-Engine, Scheduler, Instrumente, Drive, MIDI-Eingang
  music/               Skalen und Stimmungssysteme
  midi/                MIDI Tools (Generatoren/Transformationen), MIDI-Datei-Export
  ui/                  Oberfläche (ohne Framework)
tests/                 Vitest-Unit-Tests
```

Eigene Generatoren oder Transformationen lassen sich mit `registerMidiTool()` hinzufügen.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
