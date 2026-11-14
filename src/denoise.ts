/** Stationary-noise suppression: STFT, quiet-frame profile, soft spectral mask. */
export function fft(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; } }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let r = 1, im = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2, tr = real[b] * r - imag[b] * im, ti = real[b] * im + imag[b] * r;
        real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti;
        const next = r * wr - im * wi; im = r * wi + im * wr; r = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
}

export function denoiseChannel(input: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return input.slice();
  const strength = Math.min(1, amount / 100), size = 1024, hop = 256, bins = size / 2 + 1;
  const window = Float64Array.from({ length: size }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / size)));
  const re = new Float64Array(size), im = new Float64Array(size), profile = new Float64Array(bins);
  const load = (start: number) => { for (let i = 0; i < size; i++) { re[i] = (input[start + i] || 0) * window[i]; im[i] = 0; } };
  // Sample across the whole source, then learn from its quietest fifth.
  const count = Math.min(96, Math.max(1, Math.ceil(input.length / hop)));
  const candidates = Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index / Math.max(1, count - 1) * Math.max(0, input.length - size));
    let power = 0; for (let i = start; i < Math.min(input.length, start + size); i++) power += input[i] ** 2;
    return { start, power };
  }).sort((a, b) => a.power - b.power);
  const quiet = candidates.slice(0, Math.max(1, Math.ceil(candidates.length * 0.2)));
  for (const { start } of quiet) { load(start); fft(re, im); for (let k = 0; k < bins; k++) profile[k] += (re[k] ** 2 + im[k] ** 2) / quiet.length; }
  const output = new Float32Array(input.length), weights = new Float32Array(input.length), smooth = new Float64Array(bins).fill(1);
  const floor = 10 ** (-(6 + 24 * strength) / 20), subtraction = 0.5 + strength * 2.5;
  for (let start = -size + hop; start < input.length; start += hop) {
    load(start); fft(re, im);
    for (let k = 0; k < bins; k++) {
      const power = re[k] ** 2 + im[k] ** 2;
      const noise = (profile[Math.max(0, k - 1)] + profile[k] * 2 + profile[Math.min(bins - 1, k + 1)]) / 4;
      const mask = Math.max(floor, Math.sqrt(Math.max(0, 1 - subtraction * noise / Math.max(1e-20, power))));
      smooth[k] = smooth[k] * 0.25 + mask * 0.75;
      const gain = 1 - strength + strength * smooth[k];
      re[k] *= gain; im[k] *= gain;
      if (k > 0 && k < size / 2) { re[size - k] *= gain; im[size - k] *= gain; }
    }
    fft(re, im, true);
    for (let i = 0; i < size; i++) { const at = start + i; if (at >= 0 && at < input.length) { output[at] += re[i] * window[i]; weights[at] += window[i] ** 2; } }
  }
  for (let i = 0; i < output.length; i++) output[i] = weights[i] > 1e-8 ? output[i] / weights[i] : input[i];
  return output;
}
