import { audioContext, media } from './audio';
import { clamp } from './model';

export type MediaPreviewSnapshot = {
  assetId: string | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  error?: string;
};

class MediaPreviewStore {
  private state: MediaPreviewSnapshot = { assetId: null, playing: false, position: 0, duration: 0, volume: 1 };
  private listeners = new Set<() => void>();
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private frame = 0;
  private epoch = 0;
  private offset = 0;
  private startedAt = 0;

  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit(part: Partial<MediaPreviewSnapshot>) {
    this.state = { ...this.state, ...part };
    this.listeners.forEach(listener => listener());
  }

  private position() {
    return this.state.playing
      ? clamp(this.offset + audioContext().currentTime - this.startedAt, 0, this.state.duration)
      : this.state.position;
  }

  private disconnect() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* A naturally ended source is already stopped. */ }
      source.disconnect();
    }
    this.gain?.disconnect();
    this.gain = null;
  }

  private start(buffer: AudioBuffer, position: number, ticket: number) {
    const ctx = audioContext(), source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(this.state.volume, ctx.currentTime);
    source.connect(gain);
    gain.connect(ctx.destination);
    this.source = source;
    this.gain = gain;
    this.offset = position;
    this.startedAt = ctx.currentTime;
    const finish = () => {
      if (ticket !== this.epoch || this.source !== source) return;
      this.disconnect();
      this.emit({ playing: false, position: this.state.duration });
    };
    source.onended = finish;
    try { source.start(this.startedAt, position); }
    catch (error) { this.disconnect(); throw error; }
    this.emit({ playing: true, position, error: undefined });
    const tick = () => {
      if (ticket !== this.epoch || this.source !== source) return;
      const position = this.position();
      if (position >= this.state.duration) { finish(); return; }
      this.emit({ position });
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  play = async (assetId: string): Promise<void> => {
    const currentPosition = this.position(), ticket = ++this.epoch;
    this.disconnect();
    const entry = media.get(assetId);
    if (!entry) {
      const error = 'Media pratinjau tidak tersedia.';
      this.emit({ assetId: null, playing: false, position: 0, duration: 0, error });
      throw new Error(error);
    }
    const duration = entry.buffer.duration;
    const position = this.state.assetId === assetId && currentPosition < duration ? clamp(currentPosition, 0, duration) : 0;
    this.emit({ assetId, playing: false, position, duration, error: undefined });
    try {
      await audioContext().resume();
      // A project replacement may remove or replace this decoded entry while
      // the device is resuming, even when the asset identifier is reused.
      if (ticket !== this.epoch || media.get(assetId) !== entry) return;
      this.start(entry.buffer, position, ticket);
    } catch (cause) {
      if (ticket !== this.epoch) return;
      this.disconnect();
      const error = cause instanceof Error ? cause.message : 'Pratinjau audio tidak dapat diputar.';
      this.emit({ playing: false, error });
      throw new Error(error);
    }
  };

  pause = () => {
    const position = this.position();
    this.epoch++;
    this.disconnect();
    this.emit({ playing: false, position });
  };

  seek = (time: number) => {
    if (!this.state.assetId || !Number.isFinite(time)) return;
    const position = clamp(time, 0, this.state.duration), wasPlaying = this.state.playing, ticket = ++this.epoch;
    this.disconnect();
    this.emit({ playing: false, position });
    const entry = media.get(this.state.assetId!);
    if (wasPlaying && entry && position < this.state.duration) {
      try { this.start(entry.buffer, position, ticket); }
      catch (cause) { this.emit({ playing: false, error: cause instanceof Error ? cause.message : 'Pratinjau audio tidak dapat diputar.' }); }
    }
  };

  setVolume = (linear: number) => {
    if (!Number.isFinite(linear)) return;
    const volume = clamp(linear, 0, 1);
    this.gain?.gain.setValueAtTime(volume, audioContext().currentTime);
    this.emit({ volume });
  };

  clear = () => {
    this.epoch++;
    this.disconnect();
    this.emit({ assetId: null, playing: false, position: 0, duration: 0, error: undefined });
  };
}

export const mediaPreview = new MediaPreviewStore();
