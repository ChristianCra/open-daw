# Feature-Studie: Clips quantisiert starten

| Aussage | Status | Quelle |
| --- | --- | --- |
| Clips liegen in einem Raster aus Spuren (Spalten) und Szenen (Zeilen). | gesehen | öffentliche Handbücher/Tutorials mehrerer DAWs |
| Ein gestarteter Clip beginnt erst am nächsten Takt (globale Quantisierung). | gesehen | dito |
| Pro Spur läuft höchstens ein Clip, ein neuer Clip ersetzt den alten am Quantisierungspunkt. | gesehen | dito |
| Eine Szene startet alle Clips ihrer Zeile, Spuren ohne Clip in der Zeile stoppen. | abgeleitet | Verhalten beobachtet |
| Noten, die über den Wechsel hinaus klingen würden, werden abgeschnitten. | abgeleitet | eigene Designentscheidung |

**Umsetzung:** `src/engine/scheduler.ts` (rein, getestet in `tests/scheduler.test.ts`) und
`src/engine/engine.ts` (Lookahead-Scheduler auf der Web-Audio-Uhr).
