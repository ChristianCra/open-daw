// MIDI keyboard input via the Web MIDI API (Chrome, Edge, Opera; desktop).

export type MidiEvent =
  | { type: "noteon"; channel: number; pitch: number; velocity: number }
  | { type: "noteoff"; channel: number; pitch: number }
  | { type: "bend"; channel: number; /** -1..1 */ value: number }
  | { type: "cc"; channel: number; controller: number; value: number };

/** Decodes a raw MIDI message. Returns null for messages we ignore (clock, sysex, ...). */
export function parseMidiMessage(data: ArrayLike<number>): MidiEvent | null {
  if (data.length < 2) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const d1 = data[1] & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;
  switch (status) {
    case 0x90:
      // Note-on with velocity 0 is a note-off by convention.
      return d2 === 0 ? { type: "noteoff", channel, pitch: d1 } : { type: "noteon", channel, pitch: d1, velocity: d2 / 127 };
    case 0x80:
      return { type: "noteoff", channel, pitch: d1 };
    case 0xe0: {
      const raw = (d2 << 7) | d1; // 0..16383, centre 8192
      return { type: "bend", channel, value: Math.max(-1, (raw - 8192) / 8191) };
    }
    case 0xb0:
      return { type: "cc", channel, controller: d1, value: d2 / 127 };
    default:
      return null;
  }
}

export interface MidiDevice {
  id: string;
  name: string;
}

export class MidiInput {
  private access: MIDIAccess | null = null;
  /** "all" listens to every connected input */
  selected = "all";
  onEvent: (ev: MidiEvent) => void = () => {};
  onDevicesChanged: () => void = () => {};
  error: string | null = null;

  get supported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  get enabled(): boolean {
    return this.access !== null;
  }

  async enable(): Promise<boolean> {
    if (!this.supported) {
      this.error = "Web MIDI wird von diesem Browser nicht unterstützt (Chrome oder Edge verwenden).";
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.error = `MIDI-Zugriff verweigert: ${(err as Error).message}`;
      return false;
    }
    this.error = null;
    this.access.onstatechange = () => {
      this.bind();
      this.onDevicesChanged();
    };
    this.bind();
    return true;
  }

  devices(): MidiDevice[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? i.id }));
  }

  select(id: string) {
    this.selected = id;
    this.bind();
  }

  private bind() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = this.selected === "all" || this.selected === input.id ? (e) => this.handle(e) : null;
    }
  }

  private handle(e: MIDIMessageEvent) {
    if (!e.data) return;
    const ev = parseMidiMessage(e.data);
    if (ev) this.onEvent(ev);
  }
}
