import { type Clip, type Project, crossfadeBounds } from './model';
import { media, renderClipAudio } from './audio';

/**
 * ITU-R BS.1770-5 (2023), Annex1: K weighting, 400ms rectangular blocks,
 * 75% overlap, absolute -70LKFS and relative -10LU gates. Annex2: 4-phase
 * 48-tap interpolation FIR. EBU Tech3341 Table1 supplies numerical fixtures.
 * https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
 * https://tech.ebu.ch/docs/tech/tech3341.pdf
 *
 * Input is the editor's rendered mono/stereo signal at 48kHz. Other source
 * rates/layouts are resampled/downmixed by the same WebAudio graph as export.
 * This is an integrated/true-peak file analyzer, not a full EBU Mode live meter.
 */
export type LoudnessMeasurement = {
  integratedLufs: number | null; truePeakDbtp: number | null; samplePeakDbfs: number | null;
  blocks: number; gatedBlocks: number; silent: boolean; duration: number;
  /** Block energies retain the absolute gate when predicting output gain. */
  blockEnergies?: number[];
};

// BS.1770-5 Annex2, columns Phase0–3; unit gain after the 4x interpolation.
const TRUE_PEAK_FIR = [
  [0.001708984375, -0.0291748046875, -0.0189208984375, -0.00830078125],
  [0.010986328125, 0.029296875, 0.0330810546875, 0.014892578125],
  [-0.0196533203125, -0.0517578125, -0.0582275390625, -0.026611328125],
  [0.033203125, 0.089111328125, 0.1015625, 0.047607421875],
  [-0.0594482421875, -0.16650390625, -0.2003173828125, -0.102294921875],
  [0.1373291015625, 0.465087890625, 0.77978515625, 0.97216796875],
  [0.97216796875, 0.77978515625, 0.465087890625, 0.1373291015625],
  [-0.102294921875, -0.2003173828125, -0.16650390625, -0.0594482421875],
  [0.047607421875, 0.1015625, 0.089111328125, 0.033203125],
  [-0.026611328125, -0.0582275390625, -0.0517578125, -0.0196533203125],
  [0.014892578125, 0.0330810546875, 0.029296875, 0.010986328125],
  [-0.00830078125, -0.0189208984375, -0.0291748046875, 0.001708984375],
];
const energyLufs = (energy: number) => -0.691 + 10 * Math.log10(energy);
const peakDb = (peak: number) => peak > 0 ? 20 * Math.log10(peak) : null;

function gatedLoudness(energies: readonly number[], scale = 1) {
  const absolute = energies.filter(energy => energyLufs(energy * scale) > -70);
  if (!absolute.length) return { integratedLufs: null, gatedBlocks: 0 };
  const threshold = energyLufs(absolute.reduce((sum, energy) => sum + energy * scale, 0) / absolute.length) - 10;
  const relative = absolute.filter(energy => energyLufs(energy * scale) > threshold);
  return { integratedLufs: energyLufs(relative.reduce((sum, energy) => sum + energy * scale, 0) / relative.length), gatedBlocks: relative.length };
}

export function measureLoudness(channels: readonly Float32Array[], sampleRate: number): LoudnessMeasurement {
  if (sampleRate !== 48000 || channels.length < 1 || channels.length > 2 || !channels[0].length || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length)) throw new Error('Analisis memerlukan audio mono/stereo hasil render 48 kHz.');
  const length = channels[0].length, hop = 4800, blockSize = 19200;
  const chunks = new Float64Array(Math.ceil(length / hop));
  let samplePeak = 0, truePeak = 0;
  for (const channel of channels) {
    let shelf1 = 0, shelf2 = 0, high1 = 0, high2 = 0;
    for (let chunk = 0; chunk < chunks.length; chunk++) {
      let energy = 0;
      for (let i = chunk * hop; i < Math.min(length, (chunk + 1) * hop); i++) {
        const x = channel[i];
        if (!Number.isFinite(x)) throw new Error('Audio mengandung sampel yang tidak valid.');
        samplePeak = Math.max(samplePeak, Math.abs(x));
        const shelf = 1.53512485958697 * x + shelf1;
        shelf1 = -2.69169618940638 * x + 1.69065929318241 * shelf + shelf2;
        shelf2 = 1.19839281085285 * x - 0.73248077421585 * shelf;
        const high = shelf + high1;
        high1 = -2 * shelf + 1.99004745483398 * high + high2;
        high2 = shelf - 0.99007225036621 * high;
        energy += high * high;
      }
      chunks[chunk] += energy;
    }
    // Preserve filter ringing at both boundaries; do not discard the final taps.
    if (samplePeak > 0) for (let i = 0; i < length + 11; i++) {
      let a = 0, b = 0, c = 0, d = 0;
      for (let tap = 0; tap < 12; tap++) {
        const at = i - tap, x = at < 0 || at >= length ? 0 : channel[at], f = TRUE_PEAK_FIR[tap];
        a += x * f[0]; b += x * f[1]; c += x * f[2]; d += x * f[3];
      }
      truePeak = Math.max(truePeak, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    }
  }
  const blockEnergies: number[] = [];
  for (let first = 0; first * hop + blockSize <= length; first++) blockEnergies.push((chunks[first] + chunks[first + 1] + chunks[first + 2] + chunks[first + 3]) / blockSize);
  return { ...gatedLoudness(blockEnergies), truePeakDbtp: peakDb(Math.max(samplePeak, truePeak)), samplePeakDbfs: peakDb(samplePeak), blocks: blockEnergies.length, blockEnergies, silent: samplePeak === 0, duration: length / sampleRate };
}

export type LoudnessMatch = { available: boolean; gain: number; integratedLufs: number | null; truePeakDbtp: number | null; limited: boolean; limitReason?: 'peak' | 'gain' | 'gate' };
export function loudnessMatch(measurement: LoudnessMeasurement, currentGain: number, target: number, ceiling: number): LoudnessMatch {
  if (!Number.isFinite(currentGain) || currentGain < 0 || currentGain > 16 || !Number.isFinite(target) || target < -70 || target > 0 || !Number.isFinite(ceiling) || ceiling < -20 || ceiling > 0) throw new Error('Target atau batas puncak tidak valid.');
  const { integratedLufs, truePeakDbtp } = measurement;
  if (integratedLufs === null || truePeakDbtp === null || currentGain === 0) return { available: false, gain: currentGain, integratedLufs, truePeakDbtp, limited: false };
  const peakHeadroom = ceiling - truePeakDbtp, gainHeadroom = 20 * Math.log10(16 / currentGain), maximum = Math.min(peakHeadroom, gainHeadroom);
  let wanted = target - integratedLufs;
  // Re-evaluate the absolute gate after scaling; near-threshold blocks can enter
  // or leave the measurement. Keep the preview truthful if it cannot converge.
  if (measurement.blockEnergies) for (let i = 0; i < 4; i++) {
    const estimate = gatedLoudness(measurement.blockEnergies, 10 ** (wanted / 10)).integratedLufs;
    if (estimate === null || Math.abs(target - estimate) < 0.00001) break;
    wanted += target - estimate;
  }
  const applied = Math.min(wanted, maximum), factor = 10 ** (applied / 20);
  const predicted = measurement.blockEnergies ? gatedLoudness(measurement.blockEnergies, factor * factor).integratedLufs : integratedLufs + applied;
  const limited = applied < wanted - 0.00001 || predicted === null || Math.abs(predicted - target) > 0.1;
  return { available: true, gain: Math.min(16, currentGain * factor), integratedLufs: predicted, truePeakDbtp: truePeakDbtp + applied, limited, ...(limited ? { limitReason: applied < wanted - 0.00001 ? peakHeadroom <= gainHeadroom ? 'peak' : 'gain' : 'gate' } : {}) };
}

const abortError = () => new DOMException('Analisis dibatalkan.', 'AbortError');
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
let workerJob = 0;

/** Copies only the rendered buffer, transfers that copy, and releases each worker. */
export function measureLoudnessInWorker(buffer: AudioBuffer, { signal }: { signal?: AbortSignal } = {}): Promise<LoudnessMeasurement> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./loudness.worker.ts', import.meta.url), { type: 'module' }), id = ++workerJob;
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(abortError()); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Analisis melewati batas waktu. Gunakan klip yang lebih pendek.')); }, 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; measurement?: LoudnessMeasurement; error?: string }>) => {
      if (data.id !== id) return;
      cleanup();
      if (data.error || !data.measurement) reject(new Error(data.error || 'Hasil analisis tidak tersedia.'));
      else resolve(data.measurement);
    };
    worker.onerror = () => { cleanup(); reject(new Error('Worker loudness gagal memproses audio.')); };
    try {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice());
      throwIfAborted(signal);
      worker.postMessage({ id, channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
    } catch (error) { cleanup(); reject(error); }
  });
}

let sourceCounter = 0;
const sourceIds = new WeakMap<AudioBuffer, number>();
/** Imported source buffers are immutable. Their object identity changes on replacement. */
export function loudnessSourceSignature(project: Project, clip: Clip): string {
  const source = media.get(clip.assetId)?.buffer;
  if (source && !sourceIds.has(source)) sourceIds.set(source, ++sourceCounter);
  const transitions = (project.crossfades ?? []).filter(fade => fade.leftId === clip.id || fade.rightId === clip.id).map(fade => ({ ...fade, bounds: crossfadeBounds(project, fade) }));
  return JSON.stringify([project.id, clip.id, clip.assetId, source ? sourceIds.get(source) : null, clip.start, clip.offset, clip.duration, clip.gain, clip.fadeIn, clip.fadeOut, clip.fadeInStart, clip.fadeOutEnd, clip.curve, clip.automation, clip.effects, clip.loudnessGain ?? 1, transitions]);
}
export type ClipLoudnessResult = { clipId: string; sourceSignature: string; measurement: LoudnessMeasurement };
export function isLoudnessResultCurrent(project: Project, result: ClipLoudnessResult): boolean {
  const clip = project.clips.find(clip => clip.id === result.clipId);
  return !!clip && loudnessSourceSignature(project, clip) === result.sourceSignature;
}
export async function measureClipLoudness(project: Project, clip: Clip, { signal }: { signal?: AbortSignal } = {}): Promise<ClipLoudnessResult> {
  throwIfAborted(signal);
  const sourceSignature = loudnessSourceSignature(project, clip), rendered = await renderClipAudio(project, clip.id, 48000);
  throwIfAborted(signal);
  const measurement = await measureLoudnessInWorker(rendered, { signal });
  throwIfAborted(signal);
  if (sourceSignature !== loudnessSourceSignature(project, clip)) throw new Error('Audio berubah selama analisis. Ukur kembali.');
  return { clipId: clip.id, sourceSignature, measurement };
}
