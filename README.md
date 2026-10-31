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
  vorhören, **ähnlich klingende Samples finden** und als Audio-Clips in Raster oder Zeitleiste ziehen,
  optional dem Projekttempo folgen
- **Automation** im Arrangement (Lautstärke, Pan, Delay, Filter-Cutoff, Drive-Mix) mit Maus- und Tastatursteuerung
- **Piano-Roll** mit Tonart-/Skalen-Hervorhebung, „Fold“, Velocity und Wahrscheinlichkeit pro Note
- **MIDI Tools**: Generatoren (Melodie, Akkorde, euklidische Rhythmen) und Transformationen
  (Arpeggio, Strum, Verzierungen, Rhythmus-Variation, Accelerando/Ritardando, Quantize, Humanize, …)
- **Stimmungen**: 12-TET, reine Stimmung, pythagoreisch, 19/24/31-EDO
- **Instrumente**: subtraktiver Synth, synthetisiertes Drum-Kit
- **Effekte**: „Drive“ (3-Band-Sättigung), Delay-Send
- **Mixer** mit Pegelanzeige, Pan, Mute, Solo
- **MIDI-Keyboards** über Web MIDI: live spielen, aufnehmen, Pitchbend/MPE
- **Stem-Trennung**: Samples und Audio-Clips lokal in Drums, Bass, Gesang und Rest zerlegen
- **Bounce auf neue Spur** (Instrument, Effekte und Automation als Audio) und **WAV-Export** des Arrangements
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
Die Installer sind noch nicht signiert, deshalb zeigt Windows SmartScreen beim ersten Start eine
Warnung („Weitere Informationen“ → „Trotzdem ausführen“).

**Variante B: Als Web-App.** Die App in Microsoft Edge oder Google Chrome öffnen und in der
Adressleiste auf **„App installieren“** klicken. Sie läuft danach in einem eigenen Fenster, auch offline.
Die Web-Version liegt auf GitHub Pages, sobald Pages eingeschaltet ist
(Repository → Settings → Pages → Source: **GitHub Actions**).

### Ein Release erstellen (ohne eigene Build-Tools)

Den Installer baut GitHub Actions, auf dem eigenen Rechner muss dafür nichts installiert sein.
Es gibt zwei Wege:

- **Über Actions (einfachster Weg):** Auf der Seite
  [Windows installer](https://github.com/ChristianCra/open-daw/actions/workflows/windows.yml)
  auf **„Run workflow“** klicken, bei **„Release-Tag“** zum Beispiel `v0.1.0` eintragen und starten.
- **Über Releases:** Auf der [Releases-Seite](https://github.com/ChristianCra/open-daw/releases) auf
  **„Draft a new release“** klicken, unter **„Choose a tag“** einen neuen Tag wie `v0.1.0` eintippen
  („Create new tag on publish“) und veröffentlichen.

Nach etwa 15 Minuten hängen die `.exe` und die `.msi` am Release. Den Fortschritt siehst du unter
[Actions](https://github.com/ChristianCra/open-daw/actions). Ohne Tag gestartete Läufe legen den
Installer nur als Artefakt „open-daw-windows-installer“ am jeweiligen Lauf ab.

### Installer selbst bauen (für Entwickler)

Voraussetzungen unter Windows: [Git](https://git-scm.com/download/win), [Node.js](https://nodejs.org) 20+,
[Rust](https://rustup.rs) und die „Desktop development with C++“-Build-Tools von
[Visual Studio](https://visualstudio.microsoft.com/de/visual-cpp-build-tools/).

Die Befehle müssen **im Projektordner** laufen, nicht im Benutzerordner. Sonst meldet npm
`Could not read package.json`. In PowerShell:

```powershell
git clone https://github.com/ChristianCra/open-daw.git
cd open-daw
npm install
npm run tauri build   # Ergebnis: src-tauri\target\release\bundle\nsis\ und ...\msi\
npm run tauri dev     # Desktop-Fenster mit Live-Reload
```

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
| In Stems trennen | „✂“ neben einem Sample oder „Stems ✂“ im Editor eines Audio-Clips |
| Ähnliche Samples finden | „≈“ neben einem Sample im Browser |
| Sample verwenden | Aus dem Browser in einen Slot oder in die Zeitleiste ziehen (leere Spuren werden zur Audiospur) |
| Sample an Clip-Länge anpassen | „An Clip anpassen“ im Clip-Editor (setzt die Sample-BPM) |
| Clip starten | ▶ im Clip oder ▶ Szene |
| Note zeichnen | In leeren Bereich klicken und nach rechts ziehen |
| Noten auswählen | Klick, Shift+Klick ergänzt, Shift+Ziehen zieht einen Rahmen, Strg+A wählt alle |
| Noten verschieben / Länge ändern | Ziehen / rechten Rand ziehen, oder Pfeiltasten (Shift: Takt bzw. Oktave, Alt+←/→: Länge) |
| Noten kopieren | Strg+Ziehen, Strg+D dupliziert, Strg+C / Strg+X / Strg+V |
| Note löschen | Doppelklick auf die Note oder Entf |
| Wahrscheinlichkeit | Alt+Klick auf eine Note (100 → 75 → 50 → 25 %), oder Noten wählen und „Chance“ ziehen |
| Velocity ändern | Noten wählen und „Vel“ ziehen |
| Spur bouncen | „⤓“ im Spurkopf der Arrangement-Ansicht |
| Als WAV exportieren | „Export“ oben rechts |
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

Fremde Bestandteile:

- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT) führt das Modell zur Stem-Trennung aus.
- Das Modell [HT-Demucs](https://github.com/facebookresearch/demucs) (MIT, Meta) wird erst bei der ersten
  Stem-Trennung von Hugging Face geladen ([ONNX-Export](https://huggingface.co/StemSplitio/htdemucs-onnx))
  und ist nicht Teil dieses Repositorys.
