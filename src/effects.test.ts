import { describe, expect, it } from 'vitest';
import { denoiseChannel, fft } from './denoise';
import { defaultEffects, effectTail, emptyProject, makeClip, renderEndTime, validateProject } from './model';

describe('spectral denoise', () => {
  it('roundtrips an FFT without changing the samples', () => {
    const source = Float64Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.31) + Math.cos(i * 0.07)), re = source.slice(), im = new Float64Array(1024);
    fft(re, im); fft(re, im, true);
    expect(Math.max(...re.map((value, i) => Math.abs(value - source[i])))).toBeLessThan(1e-10);
  });
  it('bypasses exactly without mutating the original', () => { const source = new Float32Array([0, 0.1, -0.2, 0]); const out = denoiseChannel(source, 0); expect(out).toEqual(source); expect(out).not.toBe(source); });
  it('reduces stationary noise and preserves the foreground tone', () => {
    const rate = 16000; let seed = 18;
    const noise = Float32Array.from({ length: rate * 2 }, (_, i) => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2147483648 * 0.05 + (i >= rate / 2 && i < rate * 1.5 ? Math.sin(i * 2 * Math.PI * 440 / rate) * 0.4 : 0); });
    const soft = denoiseChannel(noise, 35), strong = denoiseChannel(noise, 85);
    const rms = (data: Float32Array) => Math.sqrt(data.slice(2000, 6000).reduce((sum, v) => sum + v * v, 0) / 4000);
    expect(rms(strong)).toBeLessThan(rms(noise) * 0.7); expect(rms(strong)).toBeLessThan(rms(soft));
    let tone = 0; for (let i = 12000; i < 20000; i++) tone += strong[i] * Math.sin(i * 2 * Math.PI * 440 / rate) * 2 / 8000;
    expect(tone).toBeGreaterThan(0.3); expect(strong.every(Number.isFinite)).toBe(true);
  });
  it('handles silence, very short clips and boundaries without NaN', () => {
    for (const length of [1, 320, 1024, 1777]) { const output = denoiseChannel(new Float32Array(length), 100); expect(output.length).toBe(length); expect(output.every(v => v === 0)).toBe(true); }
  });
});

describe('effect project integrity', () => {
  const fixture = () => { const p = emptyProject(), a = { id: 'a', name: 'voice.wav', duration: 2, channels: 1, sampleRate: 48000 }; p.assets = [a]; p.clips = [makeClip(a, p.tracks[0].id, 1)]; return p; };
  it('opens earlier projects without adding or enabling effects', () => { const p = fixture(); expect(validateProject(p)).toEqual(p); expect(effectTail(p.clips[0])).toBe(0); });
  it('retains parameters through project validation and keeps them independent', () => { const p = fixture(); p.clips[0].effects = { ...defaultEffects(), reverb: 40, room: 35, bass: -3, denoise: 25 }; const result = validateProject(JSON.parse(JSON.stringify(p))); expect(result).toEqual(p); result.clips[0].effects!.reverb = 100; expect(p.clips[0].effects.reverb).toBe(40); });
  it.each([['reverb', 101], ['denoise', -1], ['compression', NaN], ['decay', 10], ['roomSize', 'unknown'], ['echoTime', 0], ['bass', 13], ['bypassed', 'yes']])('rejects invalid %s', (key, value) => { const p = fixture(); p.clips[0].effects = { ...defaultEffects(), [key as string]: value }; expect(() => validateProject(p)).toThrow(); });
  it('includes all serial effect tails, and removes them on bypass', () => { const p = fixture(); p.clips[0].effects = { ...defaultEffects(), room: 50, reverb: 70, echo: 30, decay: 2, echoTime: 0.3 }; expect(renderEndTime(p)).toBeCloseTo(6.75); p.clips[0].effects.bypassed = true; expect(renderEndTime(p)).toBe(3); });
});
