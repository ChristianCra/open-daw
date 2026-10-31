// Sample library: imported audio files with tags, stored in IndexedDB so they
// survive reloads. Decoded AudioBuffers are cached in memory.

export interface SampleMeta {
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  /** Seconds */
  duration: number;
  sampleRate: number;
  channels: number;
  createdAt: number;
  /** Downsampled peak envelope (0..1) for waveform drawing */
  peaks: number[];
}

interface StoredSample extends SampleMeta {
  data: ArrayBuffer;
  mime: string;
}

const DB_NAME = "open-daw";
const STORE = "samples";
const PEAK_COUNT = 512;

/** Peak envelope of a buffer, `count` buckets, max of |x| over all channels. */
export function computePeaks(channels: Float32Array[], count = PEAK_COUNT): number[] {
  const len = channels[0]?.length ?? 0;
  const peaks = new Array<number>(count).fill(0);
  if (!len) return peaks;
  const bucket = len / count;
  for (let b = 0; b < count; b++) {
    const start = Math.floor(b * bucket);
    const end = Math.min(len, Math.floor((b + 1) * bucket) || start + 1);
    let peak = 0;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(ch[i]);
        if (v > peak) peak = v;
      }
    }
    peaks[b] = Math.min(1, peak);
  }
  return peaks;
}

/** Tags suggested from a file name, e.g. "Kick_808_hard.wav" -> ["kick", "808", "hard"]. */
export function tagsFromName(name: string): string[] {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  const words = base
    .split(/[^a-z0-9äöüß]+/i)
    .filter((w) => (w.length >= 2 && w.length <= 16 && !/^\d+$/.test(w)) || /^\d{3}$/.test(w));
  const known: Record<string, string> = { bd: "kick", sd: "snare", hh: "hihat", hat: "hihat", vox: "vocal", vocals: "vocal", fx: "fx" };
  return [...new Set(words.map((w) => known[w] ?? w))].slice(0, 6);
}

export interface SampleFilter {
  text: string;
  tags: string[];
  favoritesOnly: boolean;
}

/** Filters samples by free text (name or tag), required tags and favourites. */
export function filterSamples(samples: SampleMeta[], f: SampleFilter): SampleMeta[] {
  const q = f.text.trim().toLowerCase();
  return samples
    .filter((s) => !f.favoritesOnly || s.favorite)
    .filter((s) => f.tags.every((t) => s.tags.includes(t)))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
}

/** All tags with usage counts, most used first. */
export function tagCounts(samples: SampleMeta[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of samples) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export class SampleLibrary {
  private db: IDBDatabase | null = null;
  /** Fallback when IndexedDB is unavailable (private mode): samples live only for this session */
  private memory = new Map<string, StoredSample>();
  private metas = new Map<string, SampleMeta>();
  private buffers = new Map<string, AudioBuffer>();
  private decoding = new Map<string, Promise<AudioBuffer | null>>();
  onChange: () => void = () => {};

  constructor(private ctx: BaseAudioContext) {}

  async init(): Promise<void> {
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const all = await this.tx<StoredSample[]>("readonly", (s) => s.getAll());
      for (const s of all) this.metas.set(s.id, stripData(s));
    } catch {
      this.db = null;
    }
    this.onChange();
  }

  get persistent(): boolean {
    return this.db !== null;
  }

  list(): SampleMeta[] {
    return [...this.metas.values()];
  }

  meta(id: string): SampleMeta | undefined {
    return this.metas.get(id);
  }

  /** Decoded buffer if already available (used by the realtime engine). */
  buffer(id: string): AudioBuffer | undefined {
    return this.buffers.get(id);
  }

  /** Decodes a sample (once) and caches the buffer. */
  async load(id: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return cached;
    let pending = this.decoding.get(id);
    if (!pending) {
      pending = (async () => {
        const stored = await this.getStored(id);
        if (!stored) return null;
        const buf = await this.ctx.decodeAudioData(stored.data.slice(0));
        this.buffers.set(id, buf);
        return buf;
      })().catch(() => null);
      this.decoding.set(id, pending);
    }
    return pending;
  }

  /** Imports audio files. Files that can't be decoded are reported in `failed`. */
  async importFiles(files: Iterable<File>): Promise<{ imported: SampleMeta[]; failed: string[] }> {
    const imported: SampleMeta[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const data = await file.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(data.slice(0));
        const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
        const meta: SampleMeta = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ""),
          tags: tagsFromName(file.name),
          favorite: false,
          duration: buf.duration,
          sampleRate: buf.sampleRate,
          channels: buf.numberOfChannels,
          createdAt: Date.now(),
          peaks: computePeaks(channels),
        };
        await this.put({ ...meta, data, mime: file.type || "audio/*" });
        this.metas.set(meta.id, meta);
        this.buffers.set(meta.id, buf);
        imported.push(meta);
      } catch {
        failed.push(file.name);
      }
    }
    this.onChange();
    return { imported, failed };
  }

  async update(id: string, patch: Partial<Pick<SampleMeta, "name" | "tags" | "favorite">>) {
    const stored = await this.getStored(id);
    const meta = this.metas.get(id);
    if (!stored || !meta) return;
    if (patch.tags) patch.tags = [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    Object.assign(meta, patch);
    await this.put({ ...stored, ...patch });
    this.onChange();
  }

  async remove(id: string) {
    this.metas.delete(id);
    this.buffers.delete(id);
    this.memory.delete(id);
    if (this.db) await this.tx("readwrite", (s) => s.delete(id));
    this.onChange();
  }

  private async getStored(id: string): Promise<StoredSample | undefined> {
    if (!this.db) return this.memory.get(id);
    return this.tx<StoredSample | undefined>("readonly", (s) => s.get(id));
  }

  private async put(s: StoredSample) {
    if (!this.db) {
      this.memory.set(s.id, s);
      return;
    }
    await this.tx("readwrite", (store) => store.put(s));
  }

  private tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.db) return reject(new Error("no database"));
      const req = fn(this.db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }
}

function stripData(s: StoredSample): SampleMeta {
  const { data: _data, mime: _mime, ...meta } = s;
  return meta;
}
