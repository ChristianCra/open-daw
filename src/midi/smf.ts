// Minimal Standard MIDI File (format 0) writer so clips can be taken to any other tool.

import type { Clip } from "../model";

const PPQ = 480;

function varLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

export function clipToMidiFile(clip: Clip, bpm: number, channel = 0): Uint8Array {
  const events: { tick: number; order: number; data: number[] }[] = [];
  const usPerBeat = Math.round(60_000_000 / bpm);
  events.push({ tick: 0, order: 0, data: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff] });
  events.push({ tick: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] });
  for (const n of clip.notes) {
    const on = Math.round(n.start * PPQ);
    const off = Math.round(Math.min(clip.length, n.start + n.length) * PPQ);
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    events.push({ tick: on, order: 2, data: [0x90 | channel, n.pitch, vel] });
    events.push({ tick: Math.max(on + 1, off), order: 1, data: [0x80 | channel, n.pitch, 0] });
  }
  // Note-offs before note-ons at the same tick so repeated notes retrigger.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const ev of events) {
    track.push(...varLen(ev.tick - last), ...ev.data);
    last = ev.tick;
  }
  track.push(...varLen(Math.max(0, Math.round(clip.length * PPQ) - last)), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ)];
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, ...u32(track.length)];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}
