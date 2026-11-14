import { describe, expect, it } from 'vitest';
import { measureLoudness, loudnessMatch } from './loudness';

const rate = 48000;
function tone(seconds: number, level: number, frequency = 1000, phase = 0) {
  const amplitude = 10 ** (level / 20);
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate + phase));
}
function sequence(parts: [number, number][]) {
  const data = new Float32Array(Math.round(parts.reduce((sum, [seconds]) => sum + seconds, 0) * rate));
  let at = 0;
  for (const [seconds, level] of parts) { const part = tone(seconds, level); data.set(part, at); at += part.length; }
  return data;
}

describe('BS.1770 integrated loudness and reconstructed true peak', () => {
  // EBU Tech3341 Table1 cases1/2: stereo 1kHz peak -23/-33dBFS reads the same LUFS.
  it.each([-23, -33])('aligns the stereo 1kHz reference at %sdBFS within the EBU 0.1LU tolerance', level => {
    const data = tone(20, level), result = measureLoudness([data, data], rate);
    expect(Math.abs(result.integratedLufs! - level)).toBeLessThan(0.1);
    expect(result.blocks).toBe(197);
    expect(result.silent).toBe(false);
  });
  it('uses channel energy rather than stereo correlation or mono duplication', () => {
    const data = tone(2, -23), mono = measureLoudness([data], rate), stereo = measureLoudness([data, Float32Array.from(data, x => -x)], rate);
    expect(mono.integratedLufs).toBeCloseTo(-26.01, 1);
    expect(stereo.integratedLufs).toBeCloseTo(-23, 1);
  });
  it('rejects both low-level and silent blocks using the two-stage gate', () => {
    // EBU Tech3341 case4, including low but nonzero signal below the absolute gate.
    const data = sequence([[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]]), result = measureLoudness([data, data], rate);
    expect(Math.abs(result.integratedLufs! + 23)).toBeLessThan(0.1);
    expect(result.gatedBlocks).toBeGreaterThan(590);
    expect(result.gatedBlocks).toBeLessThan(610);
  });
  it('averages energy rather than dB across retained loud and quiet blocks', () => {
    // EBU Tech3341 case5. A dB mean would read about -24LUFS.
    const data = sequence([[20, -26], [20.1, -20], [20, -26]]);
    expect(Math.abs(measureLoudness([data, data], rate).integratedLufs! + 23)).toBeLessThan(0.1);
  });
  it('discards incomplete gating blocks and distinguishes insufficient duration from silence', () => {
    const short = measureLoudness([tone(0.399, -23)], rate);
    expect(short.integratedLufs).toBeNull(); expect(short.blocks).toBe(0); expect(short.silent).toBe(false);
    const silent = measureLoudness([new Float32Array(rate)], rate);
    expect(silent.integratedLufs).toBeNull(); expect(silent.truePeakDbtp).toBeNull(); expect(silent.silent).toBe(true);
    expect(measureLoudness([tone(0.499, -23)], rate).blocks).toBe(1);
  });
  it.each([[4, 0, -6.0206], [4, Math.PI / 4, -6.0206], [6, Math.PI / 3, -6.0206], [8, 3 * Math.PI / 8, -6.0206]])('passes EBU true-peak tone fs/%s with phase %s', (divisor, phase, expected) => {
    // EBU Tech3341 cases15–18, with specified 10ms boundary fades.
    const data = tone(0.5, -6.020599913, rate / divisor, phase);
    for (let i = 0; i < 480; i++) { data[i] *= i / 480; data[data.length - 1 - i] *= i / 480; }
    const result = measureLoudness([data, data], rate);
    expect(result.truePeakDbtp!).toBeGreaterThan(expected - 0.4);
    expect(result.truePeakDbtp!).toBeLessThan(expected + 0.2);
    if (divisor === 4 && phase) expect(result.truePeakDbtp! - result.samplePeakDbfs!).toBeGreaterThan(2.5);
  });
  it('retains positive floating-point headroom instead of clipping before analysis', () => {
    const data = tone(0.5, 3, 12000, Math.PI / 4);
    for (let i = 0; i < 480; i++) { data[i] *= i / 480; data[data.length - 1 - i] *= i / 480; }
    expect(measureLoudness([data], rate).truePeakDbtp!).toBeGreaterThan(2.6);
  });
  it('rejects malformed PCM and unsupported layouts rather than showing misleading measurements', () => {
    for (const channels of [[], [new Float32Array([NaN])], [new Float32Array([Infinity])], [new Float32Array(2), new Float32Array(1)], [tone(0.1, -23), tone(0.1, -23), tone(0.1, -23)]]) expect(() => measureLoudness(channels, rate)).toThrow();
    expect(() => measureLoudness([tone(1, -23)], 44100)).toThrow();
  });
});

describe('post-rack loudness matching', () => {
  it('reaches an available target by linear output gain', () => {
    const data = tone(2, -23), measurement = measureLoudness([data, data], rate);
    const result = loudnessMatch(measurement, 1, -16, -1);
    expect(result.available).toBe(true); expect(result.limited).toBe(false);
    expect(result.gain).toBeCloseTo(2.239, 2); expect(result.integratedLufs).toBeCloseTo(-16, 5);
  });
  it('caps gain at true-peak headroom and reports an unattainable target', () => {
    const measurement = { integratedLufs: -25, truePeakDbtp: -4, samplePeakDbfs: -5, blocks: 17, gatedBlocks: 17, silent: false, duration: 2 };
    const result = loudnessMatch(measurement, 1, -14, -1);
    expect(result.gain).toBeCloseTo(10 ** (3 / 20), 5); expect(result.limited).toBe(true);
    expect(result.integratedLufs).toBeCloseTo(-22, 5); expect(result.truePeakDbtp).toBeCloseTo(-1, 5);
  });
  it('uses the existing output gain when enforcing the persistent gain bound', () => {
    const measurement = { integratedLufs: -50, truePeakDbtp: -30, samplePeakDbfs: -31, blocks: 17, gatedBlocks: 17, silent: false, duration: 2 };
    const result = loudnessMatch(measurement, 8, -14, -1);
    expect(result.gain).toBe(16); expect(result.limited).toBe(true); expect(result.integratedLufs).toBeCloseTo(-43.9794, 4);
  });
  it('leaves silence and unmeasurable short audio unchanged', () => {
    expect(loudnessMatch(measureLoudness([new Float32Array(rate)], rate), 2, -16, -1)).toMatchObject({ available: false, gain: 2 });
    expect(loudnessMatch(measureLoudness([tone(0.1, -23)], rate), 1, -16, -1)).toMatchObject({ available: false, gain: 1 });
  });
});
