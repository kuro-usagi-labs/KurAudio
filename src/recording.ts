import workletUrl from './recording.worklet.js?url';
import { media, MAX_DECODED_BYTES } from './audio';
export type RecordedAudio = { buffer: AudioBuffer; bytes: Uint8Array };
export function encodeRecordedWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return bytes;
}
class Recorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private epoch = 0;
  private done: (() => void) | null = null;
  private completed = false;
  active = false;
  get hasPending() { return this.active || this.chunks.length > 0; }
  async prepare(deviceId: string, meter: (peak: number, elapsed: number) => void) {
    this.cancel(); const ticket = this.epoch;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Akses mikrofon tidak tersedia di lingkungan ini.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    if (ticket !== this.epoch) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream; const ctx = new AudioContext({ latencyHint: 'interactive' }); this.context = ctx;
    try {
      await ctx.resume(); await ctx.audioWorklet.addModule(workletUrl);
      if (ticket !== this.epoch) return false;
      const node = new AudioWorkletNode(ctx, 'kuraudio-capture'); this.node = node;
      node.port.onmessage = event => {
        if (event.data.samples) this.chunks.push(event.data.samples);
        if (event.data.peak !== undefined) meter(event.data.peak, event.data.elapsed);
        if (event.data.finished) { this.completed = true; this.active = false; this.done?.(); this.done = null; }
      };
      ctx.createMediaStreamSource(stream).connect(node); const silent = ctx.createGain(); silent.gain.value = 0; node.connect(silent); silent.connect(ctx.destination);
      return true;
    } catch (error) { this.cancel(); throw error; }
  }
  start() {
    if (!this.node || !this.context) throw new Error('Siapkan mikrofon terlebih dahulu.');
    let used = 0; for (const item of media.values()) used += item.buffer.length * item.buffer.numberOfChannels * 4;
    const maximum = Math.floor(Math.min(900 * this.context.sampleRate, (MAX_DECODED_BYTES - used) / 4));
    if (maximum < this.context.sampleRate * 0.02) throw new Error('Memori audio penuh.');
    this.chunks = []; this.completed = false; this.active = true; this.node.port.postMessage({ type: 'start', maximum });
  }
  async finish(): Promise<RecordedAudio | null> {
    const ctx = this.context; if (!ctx || !this.node || !this.hasPending) { this.cancel(); return null; }
    if (!this.completed) await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.cancel(); reject(new Error('Perekam tidak merespons.')); }, 3000);
      this.done = () => { clearTimeout(timeout); resolve(); }; this.node!.port.postMessage({ type: 'stop' });
    });
    const count = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0), rate = ctx.sampleRate;
    if (count < rate * 0.02) { this.cancel(); throw new Error('Rekaman terlalu pendek.'); }
    const samples = new Float32Array(count); let at = 0; for (const chunk of this.chunks) { samples.set(chunk, at); at += chunk.length; }
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: count, sampleRate: rate }); buffer.copyToChannel(samples, 0);
    const bytes = encodeRecordedWav(samples, rate); this.cancel(); return { buffer, bytes };
  }
  cancel() {
    this.epoch++; this.active = false; this.completed = false; this.done = null;
    this.node?.disconnect(); this.node = null; this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    void this.context?.close().catch(() => {}); this.context = null; this.chunks = [];
  }
}
export const recorder = new Recorder();
