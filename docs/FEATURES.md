# Feature-Abdeckung

Abgleich mit einer Liste typischer Funktionen moderner clip-basierter DAWs (Stand: Prototyp 0.1).
Legende: ✅ vorhanden · 🟡 teilweise · 🗺️ geplant · ⛔ nicht machbar / bewusst nicht

## Audio & Sampling

| Feature | Status | Notiz |
| --- | --- | --- |
| Stem-Trennung (Vocals, Drums, Bass, Rest) | 🗺️ | Braucht Audiospuren. Plan: offenes Modell (z. B. Demucs, MIT) per ONNX Runtime Web/nativ |
| Ähnliche Samples finden | 🗺️ | Audio-Features (MFCC/Spektrum) lokal berechnen, Nächste-Nachbarn-Suche |
| Splice-Integration | ⛔ | Proprietärer Dienst ohne offene API. Stattdessen: eigene Sample-Ordner, später offene Quellen (z. B. Freesound-API) |
| Audio zwischen Apps im Netzwerk | 🗺️ | Tempo-Sync über das offene Ableton-Link-SDK (GPL) in der Desktop-Version. Audio-Streaming später |

## MIDI & Komposition

| Feature | Status | Notiz |
| --- | --- | --- |
| MIDI-Generatoren (Melodie, Akkorde, Rhythmus) | ✅ | Melody, Chords, Euclidean Rhythm, mit Seed reproduzierbar |
| Transformationen: Arpeggio | ✅ | up/down/updown/random, 1/16, 1/8, 1/16T |
| Transformationen: Strumming | ✅ | Richtung, Zeit, Kurve |
| Transformationen: Verzierungen | ✅ | Vorschlag, Flam, Triller |
| Transformationen: Rhythmus-Variationen | ✅ | Teilen, Weglassen, Verschieben |
| Accelerando/Ritardando-Kurven | ✅ | Time Warp |
| Weitere Transformationen | ✅ | Quantize, Humanize, Transpose in Scale, Legato |
| Wahrscheinlichkeit pro Note | ✅ | Wird bei jedem Loop-Durchlauf neu gewürfelt, Werkzeug + Shift+Klick |
| Piano-Roll mit erweiterten Werkzeugen | 🟡 | Zeichnen, Länge ziehen, Velocity, Chance, Fold. Geplant: Auswahl, Verschieben, Kopieren |
| MPE | 🟡 | Pitchbend pro Kanal/Note live. Geplant: Slide/Pressure, Aufnahme von Ausdruck |
| MIDI-Keyboard | ✅ | Web MIDI (Chrome/Edge): Geräteauswahl, Live-Spiel, Aufnahme mit Quantisierung |
| MIDI-Datei-Export | ✅ | Pro Clip als .mid |

## Tonarten & Stimmungen

| Feature | Status | Notiz |
| --- | --- | --- |
| Projektweite Tonart/Skala | ✅ | 14 Skalen, wirkt auf Editor und Werkzeuge |
| Skalen-Hervorhebung im Editor | ✅ | Plus „Fold“ (nur Skalentöne) |
| Alternative Stimmungen / Mikrotonalität | ✅ | Reine Stimmung, pythagoreisch, 19/24/31-EDO. Geplant: Scala-Dateien (.scl) |

## Instrumente & Effekte

| Feature | Status | Notiz |
| --- | --- | --- |
| Synth | ✅ | Subtraktiv, ADSR, Filter-Hüllkurve. Geplant: 2 Oszillatoren, Modulation, Wavetable |
| Drum-Kit | ✅ | Komplett synthetisiert |
| MPE-fähiger Experimental-Synth | 🗺️ | Eigenes Design, kein Nachbau eines bestimmten Geräts |
| Granular-Instrument | 🗺️ | Braucht Sample-Import |
| Multiband-Sättigung | ✅ | „Drive“: 3 Bänder, Soft/Hard/Wavefold, Mix |
| Delay | ✅ | Tempo-synchroner Send |
| Plug-ins (VST3/CLAP) | 🗺️ | Nur in der Desktop-Version möglich |

## Browser & Workflow

| Feature | Status | Notiz |
| --- | --- | --- |
| Browser mit Tags, Filtern, eigenen Kategorien | 🗺️ | Zusammen mit Sample-Import |
| Ähnliche Dateien anzeigen | 🗺️ | Siehe „Ähnliche Samples finden“ |
| Undo/Redo | ✅ | |
| Speichern/Laden | ✅ | JSON-Projektdatei + automatisches Zwischenspeichern |

## Oberfläche

| Feature | Status | Notiz |
| --- | --- | --- |
| Clip-Raster + Mixer + Geräte + Editor gleichzeitig | ✅ | Alles in einem Fenster |
| Arrangement-Zeitleiste | ✅ | Clips ziehen/verschieben/kürzen, Loop-Bereich, Session-Jam aufnehmen, „Zurück zum Arrangement“ |
| Automation mit Tastatursteuerung | ✅ | Lautstärke, Pan, Delay-Send, Filter-Cutoff, Drive-Mix. Punkte per Maus oder Pfeiltasten (Shift grob, Alt fein) |
| Bounce auf neue Spur | 🗺️ | Braucht Audiospuren + Offline-Rendering |

## Erweiterbarkeit

| Feature | Status | Notiz |
| --- | --- | --- |
| API für eigene Generatoren/Transformationen | ✅ | `registerMidiTool()` in `src/midi/tools.ts` |
| Skript-/Patch-Umgebung | 🗺️ | Später, z. B. mit JS-Sandbox oder Faust |

## Plattformen

| Feature | Status | Notiz |
| --- | --- | --- |
| Browser | ✅ | Chrome/Edge empfohlen (Web MIDI) |
| Windows-App (PWA) | ✅ | In Edge/Chrome „App installieren“ |
| Windows-Installer (.msi/.exe) | ✅ | Tauri, gebaut von GitHub Actions (noch unsigniert) |
