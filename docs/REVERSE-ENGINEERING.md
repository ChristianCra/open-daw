# Wie wir uns an anderen DAWs orientieren (und wo die Grenze liegt)

open-daw soll sich für Leute vertraut anfühlen, die mit clip-basierten DAWs arbeiten.
Es ist aber **kein Klon** eines bestimmten Produkts.

## Erlaubt

- Öffentlich dokumentiertes Verhalten nachbauen (Handbücher, Release Notes, Tutorials).
- Beobachten, wie sich ein Programm *von außen* verhält, und das Verhalten neu implementieren.
- Offene Standards und Formate nutzen: MIDI, Standard MIDI Files, WAV/FLAC, VST3/CLAP/LV2, MPE.
- Allgemeine Ideen und Workflows (Clip-Raster, Szenen, Piano-Roll, Skalen), die in vielen DAWs vorkommen.

## Nicht erlaubt

- Binärdateien, Plug-ins oder Installer proprietärer DAWs dekompilieren, disassemblieren oder patchen.
- Code, Presets, Samples, Packs, Icons, Schriften, Grafiken oder das konkrete UI-Design übernehmen.
- Geschützte Produkt- und Gerätenamen verwenden. Unsere Geräte haben eigene Namen (z. B. „Drive“).
- Proprietäre Dateiformate über das hinaus analysieren, was für reine Interoperabilität nötig ist.

## Methode: REA ("Reverse Engineer Anything")

Wir nutzen den Ansatz aus [morluto/rea](https://github.com/morluto/rea) **nur in der verhaltensbasierten Variante**:

1. **Ein Feature auswählen**, nicht die ganze App (z. B. „Clips quantisiert starten“).
2. **Belege sammeln** aus öffentlichen Quellen und eigener Beobachtung.
3. **Kurz zusammenfassen** und jede Aussage markieren: *gesehen*, *abgeleitet* oder *unbekannt*.
4. **Neu bauen** mit eigener Architektur und eigenem Design.
5. **Testen**, ob das Verhalten passt (Unit-Tests für Logik, manuelle Checks für Klang und UI).

Die Notizen pro Feature liegen in [`docs/features/`](features/).
