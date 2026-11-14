import { describe, expect, it } from 'vitest';
import { curveGain, makeClip, validateProject, emptyProject } from './model';
import { envelope } from './audio';
import { nearestZeroCrossing, splitClipSafe } from './precision';

describe('sample-aware cut assistance', () => {
  it('finds the closest actual crossing and returns a sample boundary', () => {
    const pcm = new Float32Array([0.8, 0.7, 0.3, -0.1, -0.4, -0.6, -0.8, -0.4, 0.2, 0.5]);
    expect(nearestZeroCrossing([pcm], 1000, 0.005, 0.004)).toBe(0.003);
    expect(nearestZeroCrossing([pcm], 1000, 0.007, 0.004)).toBe(0.008);
  });
  it('does not confuse opposite stereo phases with silence or invent crossings outside the radius', () => {
    const left = new Float32Array([0.8, 0.5, 0.3, -0.1, -0.4, -0.6, -0.8, -0.4, 0.2, 0.5]), right = left.map(n => -n);
    expect(nearestZeroCrossing([left, right], 1000, 0.005, 0.004)).toBe(0.003);
    expect(nearestZeroCrossing([new Float32Array(10).fill(0.5)], 1000, 0.0054, 0.002)).toBe(0.005);
  });
  it('bounds malformed, silent, empty and end-of-buffer requests without nonfinite results', () => {
    expect(nearestZeroCrossing([new Float32Array(10)], 1000, 0.0044)).toBe(0.004);
    expect(nearestZeroCrossing([new Float32Array(10)], 1000, 4)).toBe(0.009);
    expect(nearestZeroCrossing([], 48000, 2)).toBe(2);
    expect(nearestZeroCrossing([new Float32Array([NaN, NaN, NaN])], 1000, 0.001)).toBe(0.001);
    expect(nearestZeroCrossing([], 0, NaN)).toBe(0);
  });
});

describe('safe split taper', () => {
  it('keeps original envelopes and editable volume outside the three millisecond cut edges', () => {
    const p = emptyProject(), asset = { id: 's', name: 'voice.wav', duration: 10, sampleRate: 48000, channels: 1 };
    p.assets = [asset];
    const original = { ...makeClip(asset, p.tracks[0].id, 1), gain: 0.7, fadeIn: 2, fadeOut: 2, curve: [{ time: 0, gain: 0.9 }, { time: 10, gain: 0.7 }], automation: [{ time: 0, gain: 2 }, { time: 10, gain: 0 }] };
    for (const at of [1.5, 5, 10.5]) {
      const pieces = splitClipSafe(original, at); expect(pieces).toHaveLength(2); p.clips = pieces; validateProject(p);
      for (const c of pieces) {
        for (let t = 0.004; t < c.duration - 0.004; t += 0.033) expect(envelope(c, t)).toBeCloseTo(envelope(original, c.start - original.start + t), 5);
        expect(curveGain(c.automation, 0.02)).toBeCloseTo(curveGain(original.automation, c.start - original.start + 0.02));
      }
      expect(envelope(pieces[0], pieces[0].duration)).toBe(0); expect(envelope(pieces[1], 0)).toBe(0);
      expect(pieces[1].offset).toBeCloseTo(at - original.start);
    }
  });
  it('tapers only valid cuts and permits an explicitly disabled safe fade', () => {
    const asset = { id: 's', name: 'voice.wav', duration: 1, sampleRate: 48000, channels: 1 }, c = makeClip(asset, 'track', 0);
    expect(splitClipSafe(c, 0.001)).toEqual([c]);
    const [a, b] = splitClipSafe(c, 0.5, 0); expect(envelope(a, a.duration)).toBe(1); expect(envelope(b, 0)).toBe(1);
  });
  it('keeps a densely baked envelope valid when tiny cut-edge points are added', () => {
    const p = emptyProject(), asset = { id: 's', name: 'voice.wav', duration: 10, sampleRate: 48000, channels: 1 }; p.assets = [asset];
    const c = { ...makeClip(asset, p.tracks[0].id, 0), curve: Array.from({ length: 4096 }, (_, i) => ({ time: 0.1 + i * 7 / 4095, gain: i % 2 })) };
    p.clips = splitClipSafe(c, 8); expect(() => validateProject(p)).not.toThrow(); expect(envelope(p.clips[0], 8)).toBe(0);
  });
});
