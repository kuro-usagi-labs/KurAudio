export type SilenceOptions = { threshold: number; minimum: number; keep: number };
export type Interval = { start: number; end: number };
/** RMS uses the loudest channel so opposite stereo phases cannot cancel speech. */
export function detectSilence(channels: Float32Array[], rate: number, options: SilenceOptions): Interval[] {
  if (!channels.length || !Number.isFinite(rate) || rate < 8000) throw new Error('Audio analisis tidak valid.');
  const stride = Math.max(1, Math.round(rate * 0.01)), length = Math.min(...channels.map(c => c.length));
  const limit = Math.pow(10, options.threshold / 20), result: Interval[] = [];
  let beginning = -1;
  const finish = (end: number) => {
    if (beginning < 0) return;
    const start = beginning / rate, stop = end / rate;
    if (stop - start >= options.minimum && stop - start - options.keep >= 0.02) result.push({ start: start + options.keep / 2, end: stop - options.keep / 2 });
    beginning = -1;
  };
  for (let first = 0; first < length; first += stride) {
    const end = Math.min(first + stride, length); let loudest = 0;
    for (const data of channels) { let sum = 0; for (let i = first; i < end; i++) sum += data[i] * data[i]; loudest = Math.max(loudest, Math.sqrt(sum / (end - first))); }
    if (loudest <= limit) { if (beginning < 0) beginning = first; } else finish(first);
  }
  finish(length); return result;
}
