# open-daw

Eine freie, quelloffene Digital Audio Workstation (DAW) mit einem clip-basierten Workflow:
Clips in einem Raster live starten, MIDI bearbeiten und erzeugen, mit Instrumenten und Effekten
arbeiten, alles in einem Fenster.

Das Projekt ist eine **eigenständige Neuentwicklung**. Es enthält keinen Code, keine Assets und
kein UI-Design anderer DAWs. Mehr dazu in [docs/REVERSE-ENGINEERING.md](docs/REVERSE-ENGINEERING.md).

## Was schon geht

- **Clip-Raster** mit Szenen, Start quantisiert auf den nächsten Takt, Stop pro Spur
- **Arrangement-Zeitleiste**: Clips aus dem Raster hineinziehen, verschieben, kürzen, duplizieren,
  Loop-Bereich, Session-Jams direkt ins Arrangement aufnehmen
- **Audiospuren und Sample-Browser**: Audiodateien importieren, mit Tags und Favoriten ordnen,
  vorhören und als Audio-Clips in Raster oder Zeitleiste ziehen, optional dem Projekttempo folgen
- **Automation** im Arrangement (Lautstärke, Pan, Delay, Filter-Cutoff, Drive-Mix) mit Maus- und Tastatursteuerung
- **Piano-Roll** mit Tonart-/Skalen-Hervorhebung, „Fold“, Velocity und Wahrscheinlichkeit pro Note
- **MIDI Tools**: Generatoren (Melodie, Akkorde, euklidische Rhythmen) und Transformationen
  (Arpeggio, Strum, Verzierungen, Rhythmus-Variation, Accelerando/Ritardando, Quantize, Humanize, …)
- **Stimmungen**: 12-TET, reine Stimmung, pythagoreisch, 19/24/31-EDO
- **Instrumente**: subtraktiver Synth, synthetisiertes Drum-Kit
- **Effekte**: „Drive“ (3-Band-Sättigung), Delay-Send
- **Mixer** mit Pegelanzeige, Pan, Mute, Solo
- **MIDI-Keyboards** über Web MIDI: live spielen, aufnehmen, Pitchbend/MPE
- Undo/Redo, Speichern/Öffnen als JSON, Export einzelner Clips als MIDI-Datei
- Windows-Installer (.exe/.msi) über Tauri, außerdem installierbar als Web-App (PWA)

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

**Variante A: Installer (empfohlen).** Unter [Releases](https://github.com/ChristianCra/open-daw/releases)
die Datei `open-daw_x.y.z_x64-setup.exe` (oder die `.msi`) herunterladen und ausführen.
Zwischenstände ohne Release liegen als Artefakt „open-daw-windows-installer“ im Workflow
[Windows installer](https://github.com/ChristianCra/open-daw/actions/workflows/windows.yml).
Die Installer sind noch nicht signiert, deshalb zeigt Windows SmartScreen beim ersten Start eine
Warnung („Weitere Informationen“ → „Trotzdem ausführen“).

**Variante B: Als Web-App.** Die App in Microsoft Edge oder Google Chrome öffnen und in der
Adressleiste auf **„App installieren“** klicken. Sie läuft danach in einem eigenen Fenster, auch offline.

### Installer selbst bauen

Voraussetzungen unter Windows: Node.js 20+, [Rust](https://rustup.rs) und die
„Desktop development with C++“-Build-Tools von Visual Studio.

```bash
npm install
npm run tauri build   # Ergebnis: src-tauri/target/release/bundle/{nsis,msi}/
npm run tauri dev     # Desktop-Fenster mit Live-Reload
```

Ein neues Release entsteht, wenn ein Tag wie `v0.1.0` gepusht wird: GitHub Actions baut dann die
Installer und hängt sie an einen Release-Entwurf.

## Bedienung

| Aktion | So geht's |
| --- | --- |
| Play/Stop | Leertaste |
| Session/Arrangement wechseln | Tab |
| Startposition / Loop setzen | Im Arrangement-Lineal klicken / ziehen |
| Clip in die Zeitleiste | Aus dem Raster ziehen oder Doppelklick in eine Spur |
| Clip verschieben / Länge ändern | Ziehen / rechten Rand ziehen (Alt: feineres Raster) |
| Clip duplizieren / löschen | Strg+D / Entf |
| Automationsspur zeigen | „A“ im Spurkopf der Arrangement-Ansicht |
| Automationspunkt setzen / löschen | Klick in die Spur / Doppelklick auf den Punkt |
| Punkt fein bewegen | Pfeiltasten (Shift: grob, Alt: fein), Entf löscht |
| Clip anlegen | Doppelklick auf leeren Slot (bei Audiospuren: Datei wählen) |
| Sample importieren | „+ Import“ im Sample-Browser oder Dateien auf den Browser ziehen |
| Sample verwenden | Aus dem Browser in einen Slot oder in die Zeitleiste ziehen (leere Spuren werden zur Audiospur) |
| Sample an Clip-Länge anpassen | „An Clip anpassen“ im Clip-Editor (setzt die Sample-BPM) |
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
  audio/               Sample-Bibliothek (IndexedDB), Wellenform-Peaks, Tag-Filter
  music/               Skalen und Stimmungssysteme
  midi/                MIDI Tools (Generatoren/Transformationen), MIDI-Datei-Export
  ui/                  Oberfläche (ohne Framework)
src-tauri/             Desktop-Hülle (Tauri) für den Windows-Installer
tests/                 Vitest-Unit-Tests
```

Eigene Generatoren oder Transformationen lassen sich mit `registerMidiTool()` hinzufügen.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
