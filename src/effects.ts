import { type Clip, type Effects, defaultEffects, resolveEffects } from './model';

let worker: Worker | null = null, jobId = 0, sourceId = 0;
let processing = Promise.resolve();
const sourceIds = new WeakMap<AudioBuffer, number>();
const jobs = new Map<number, { resolve: (channels: Float32Array[]) => void; reject: (reason: Error) => void }>();
const cache = new Map<string, { source: AudioBuffer; buffer: AudioBuffer }>();
const pending = new Map<string, Promise<AudioBuffer>>();
const CACHE_BYTES = 64 * 1024 * 1024;
export function effectiveDenoise(clip: Clip) { const f = resolveEffects(clip.effects); return f.bypassed ? 0 : f.denoise; }
export async function preparedBuffer(assetId: string, source: AudioBuffer, amount: number, ctx: BaseAudioContext): Promise<AudioBuffer> {
  if (!amount) return source;
  if (!sourceIds.has(source)) sourceIds.set(source, ++sourceId);
  const key = `${assetId}:${sourceIds.get(source)}:${amount}`, hit = cache.get(key);
  if (hit?.source === source) return hit.buffer;
  if (pending.has(key)) return pending.get(key)!;
  // Queue before copying PCM so rapid intensity changes cannot queue full-buffer copies.
  const task = processing.then(async () => {
  if (!worker) {
    worker = new Worker(new URL('./denoise.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { const job = jobs.get(data.id); if (!job) return; jobs.delete(data.id); if (data.error) job.reject(new Error(data.error)); else job.resolve(data.channels); };
    worker.onerror = () => { for (const job of jobs.values()) job.reject(new Error('Pemrosesan denoise gagal. Coba intensitas lebih rendah atau berkas lebih pendek.')); jobs.clear(); worker?.terminate(); worker = null; };
  }
  const channels = Array.from({ length: source.numberOfChannels }, (_, ch) => source.getChannelData(ch).slice()), id = ++jobId;
  const result = new Promise<Float32Array[]>((resolve, reject) => { jobs.set(id, { resolve, reject }); });
  worker.postMessage({ id, channels, amount }, channels.map(c => c.buffer));
  const timeout = setTimeout(() => { for (const job of jobs.values()) job.reject(new Error('Denoise melewati batas waktu. Coba berkas yang lebih pendek.')); jobs.clear(); worker?.terminate(); worker = null; }, 120000);
  let output: Float32Array[]; try { output = await result; } finally { clearTimeout(timeout); jobs.delete(id); }
  { const channels = output;
    const buffer = ctx.createBuffer(channels.length, source.length, source.sampleRate);
    channels.forEach((channel, ch) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, ch));
    cache.set(key, { source, buffer });
    let size = 0; for (const item of cache.values()) size += item.buffer.length * item.buffer.numberOfChannels * 4;
    while (size > CACHE_BYTES && cache.size) { const first = cache.keys().next().value!; const item = cache.get(first)!; size -= item.buffer.length * item.buffer.numberOfChannels * 4; cache.delete(first); }
    return buffer;
  }
  }).finally(() => pending.delete(key));
  processing = task.then(() => {}, () => {});
  pending.set(key, task); return task;
}

const impulses = new Map<string, AudioBuffer>();
function impulse(ctx: BaseAudioContext, kind: 'reverb' | Effects['roomSize'], seconds: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${kind}:${seconds}`;
  const cached = impulses.get(key); if (cached) return cached;
  const duration = kind === 'reverb' ? seconds : 0.25, buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    if (kind === 'reverb') {
      let seed = 7831 + channel * 1237, energy = 0;
      for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; const t = i / ctx.sampleRate; data[i] = t < 0.012 ? 0 : (seed / 2147483648) * Math.exp(-6.9 * t / duration); energy += data[i] ** 2; }
      const scale = 0.7 / Math.sqrt(Math.max(1e-8, energy)); for (let i = 0; i < data.length; i++) data[i] *= scale;
    } else {
      const roomScale = kind === 'small' ? 0.5 : kind === 'studio' ? 1 : 1.8;
      [0.014, 0.023, 0.037, 0.053, 0.079, 0.113].forEach((time, index) => { const at = Math.min(data.length - 1, Math.round((time * roomScale + channel * 0.0023) * ctx.sampleRate)); data[at] = (index % 2 ? -1 : 1) * 0.48 * 0.72 ** index; });
    }
  }
  impulses.set(key, buffer); if (impulses.size > 20) impulses.delete(impulses.keys().next().value!);
  return buffer;
}

/** One graph shared by live playback and offline rendering. No export-only effects. */
export function createEffectRack(ctx: BaseAudioContext, initial?: Effects) {
  const nodes: AudioNode[] = [], keep = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
  const input = keep(ctx.createGain()), output = keep(ctx.createGain()), bypass = keep(ctx.createGain()), active = keep(ctx.createGain());
  const bass = keep(ctx.createBiquadFilter()), treble = keep(ctx.createBiquadFilter());
  bass.type = 'lowshelf'; bass.frequency.value = 180; treble.type = 'highshelf'; treble.frequency.value = 4000;
  input.connect(bypass).connect(output); input.connect(bass).connect(treble);
  const compressed = keep(ctx.createDynamicsCompressor()), compDry = keep(ctx.createGain()), compWet = keep(ctx.createGain()), compOut = keep(ctx.createGain());
  treble.connect(compDry).connect(compOut); treble.connect(compressed).connect(compWet).connect(compOut);
  compressed.attack.value = 0.008; compressed.release.value = 0.18; compressed.knee.value = 16;
  const convolution = (source: AudioNode) => {
    const dry = keep(ctx.createGain()), wet = keep(ctx.createGain()), convolver = keep(ctx.createConvolver()), out = keep(ctx.createGain());
    convolver.normalize = false; source.connect(dry).connect(out); source.connect(convolver).connect(wet).connect(out);
    return { dry, wet, convolver, out };
  };
  const room = convolution(compOut), reverb = convolution(room.out);
  const echoOut = keep(ctx.createGain()), echoDry = keep(ctx.createGain()); reverb.out.connect(echoDry).connect(echoOut);
  // Five finite taps give predictable tails, including exact offline export length.
  const taps = Array.from({ length: 5 }, () => { const delay = keep(ctx.createDelay(5.1)), gain = keep(ctx.createGain()); reverb.out.connect(delay).connect(gain).connect(echoOut); return { delay, gain }; });
  echoOut.connect(active).connect(output);
  let initialized = false;
  let roomImpulseKind: Effects['roomSize'] | undefined, reverbImpulseDecay: number | undefined;
  const set = (param: AudioParam, value: number) => { if (!initialized || ctx instanceof OfflineAudioContext) param.setValueAtTime(value, 0); else { param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(value, ctx.currentTime, 0.012); } };
  const update = (value = defaultEffects()) => {
    const f = resolveEffects(value);
    set(bypass.gain, f.bypassed ? 1 : 0); set(active.gain, f.bypassed ? 0 : 1);
    set(bass.gain, f.bass); set(treble.gain, f.treble);
    // Do not parallel-mix the compressor's look-ahead latency with the dry signal.
    set(compDry.gain, f.compression > 0 ? 0 : 1); set(compWet.gain, f.compression > 0 ? 1 : 0);
    set(compressed.threshold, -8 - f.compression * 0.32); set(compressed.ratio, 1 + f.compression * 0.09);
    set(room.dry.gain, 1 - f.room / 100 * 0.35); set(room.wet.gain, f.room / 100);
    if (f.room > 0 && roomImpulseKind !== f.roomSize) { room.convolver.buffer = impulse(ctx, f.roomSize, 0.25); roomImpulseKind = f.roomSize; }
    set(reverb.dry.gain, 1 - f.reverb / 100 * 0.5); set(reverb.wet.gain, f.reverb / 100);
    if (f.reverb > 0 && reverbImpulseDecay !== f.decay) { reverb.convolver.buffer = impulse(ctx, 'reverb', f.decay); reverbImpulseDecay = f.decay; }
    set(echoDry.gain, 1 - f.echo / 100 * 0.25);
    taps.forEach(({ delay, gain }, index) => { set(delay.delayTime, (index + 1) * f.echoTime); set(gain.gain, f.echo / 100 * 0.48 ** (index + 1)); });
    initialized = true;
  };
  update(initial);
  return { input, output, update, disconnect: () => nodes.forEach(node => node.disconnect()) };
}
export type EffectRack = ReturnType<typeof createEffectRack>;
