import { describe, it, expect, vi } from 'vitest';
import { createEffectRack } from './effects';
import { defaultEffects, effectEnabled, toggleEffect, resolveEffects, effectTail, emptyProject, makeClip, validateProject, type Effects, type EffectKind } from './model';

describe('explicit effect activation', () => {
  it('infers legacy active modules without changing old projects', () => {
    const legacy = { ...defaultEffects(), reverb: 30, bass: -3 };
    expect(effectEnabled(legacy, 'reverb')).toBe(true);
    expect(effectEnabled(legacy, 'equalizer')).toBe(true);
    expect(effectEnabled(legacy, 'denoise')).toBe(false);
    expect(resolveEffects(legacy)).toEqual(legacy);
  });
  it.each(['denoise', 'reverb', 'room', 'echo', 'compression'] as EffectKind[])('enables %s with an audible default', kind => {
    const enabled = toggleEffect(defaultEffects(), kind, true);
    expect(effectEnabled(enabled, kind)).toBe(true);
    expect(resolveEffects(enabled)[kind as keyof Effects]).toBeGreaterThan(0);
  });
  it('disables a module without losing its values or changing other modules', () => {
    const original = { ...defaultEffects(), reverb: 37, decay: 3.2, room: 22 };
    const off = toggleEffect(original, 'reverb', false);
    expect(off.reverb).toBe(37); expect(off.decay).toBe(3.2);
    expect(resolveEffects(off).reverb).toBe(0); expect(resolveEffects(off).room).toBe(22);
    expect(toggleEffect(off, 'reverb', true).reverb).toBe(37);
    expect(original).not.toHaveProperty('enabled');
  });
  it('keeps an explicitly enabled zero amount open and restores zero after toggling', () => {
    const zero = { ...toggleEffect(defaultEffects(), 'reverb', true), reverb: 0 };
    expect(effectEnabled(zero, 'reverb')).toBe(true);
    expect(toggleEffect(toggleEffect(zero, 'reverb', false), 'reverb', true).reverb).toBe(0);
  });
  it('supports neutral EQ activation and mutes both bands when unchecked', () => {
    const neutral = toggleEffect(defaultEffects(), 'equalizer', true);
    expect(effectEnabled(neutral, 'equalizer')).toBe(true);
    expect(neutral.bass).toBe(0);
    const off = toggleEffect({ ...neutral, bass: -6, treble: 3 }, 'equalizer', false);
    expect(resolveEffects(off)).toMatchObject({ bass: 0, treble: 0 });
    expect(toggleEffect(off, 'equalizer', true)).toMatchObject({ bass: -6, treble: 3 });
  });
  it('excludes disabled effect tails while keeping their stored settings', () => {
    const clip = makeClip({ id: 'a', name: 'a.wav', duration: 1, sampleRate: 48000, channels: 1 }, 't', 0);
    clip.effects = toggleEffect({ ...defaultEffects(), reverb: 40, echo: 20, compression: 10, room: 20 }, 'reverb', false);
    expect(effectTail(clip)).toBeCloseTo(.006 + .25 + .28 * 5);
    clip.effects.bypassed = true; expect(effectTail(clip)).toBe(0);
  });
  function project() { const p = emptyProject(); const a = { id: 'a', name: 'a.wav', duration: 1, sampleRate: 48000, channels: 1 }; p.assets.push(a); p.clips.push({ ...makeClip(a, p.tracks[0].id, 0), effects: toggleEffect(defaultEffects(), 'reverb', true) }); return p; }
  it('roundtrips flags through project validation with independent copies', () => {
    const p = project(), next = validateProject(JSON.parse(JSON.stringify(p)));
    expect(next.clips[0].effects?.enabled?.reverb).toBe(true);
    next.clips[0].effects!.enabled!.reverb = false;
    expect(p.clips[0].effects?.enabled?.reverb).toBe(true);
  });
  it.each([null, [], { reverb: 'true' }, { unknown: true }, { equalizer: 1 }])('rejects malformed activation flags: %j', enabled => {
    const p = project(); (p.clips[0].effects as unknown as { enabled: unknown }).enabled = enabled;
    expect(() => validateProject(p)).toThrow();
  });
});

describe('live impulse changes while a module is disabled', () => {
  function context() {
    const convolvers: { buffer: { length: number; getChannelData: (channel: number) => Float32Array } | null }[] = [];
    const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
    const node = () => { const n = { connect: () => n, disconnect() {}, gain: param(), frequency: param(), threshold: param(), ratio: param(), attack: param(), release: param(), knee: param(), delayTime: param() }; return n; };
    const ctx = {
      sampleRate: 48000, currentTime: 0, createGain: node, createBiquadFilter: node, createDynamicsCompressor: node, createDelay: node,
      createConvolver: () => { const n = { ...node(), buffer: null }; convolvers.push(n); return n; },
      createBuffer: (channels: number, length: number) => { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, getChannelData: (channel: number) => data[channel] }; },
    };
    return { ctx: ctx as unknown as BaseAudioContext, convolvers };
  }
  it.each(['reverb', 'room'] as const)('refreshes %s when a disabled preset changes its space', kind => {
    vi.stubGlobal('OfflineAudioContext', class {});
    try {
      const { ctx, convolvers } = context(), initial = { ...defaultEffects(), reverb: 20, room: 20 };
      const rack = createEffectRack(ctx, initial), index = kind === 'room' ? 0 : 1, before = convolvers[index].buffer;
      const off = { ...initial, decay: 4, roomSize: 'hall' as const, enabled: { reverb: false, room: false } };
      rack.update(off);
      expect(convolvers[index].buffer).toBe(before);
      rack.update({ ...off, enabled: { reverb: true, room: true } });
      const buffer = convolvers[index].buffer!;
      expect(buffer).not.toBe(before);
      if (kind === 'reverb') expect(buffer.length).toBe(192000);
      else expect(buffer.getChannelData(0).findIndex(value => value !== 0)).toBe(1210);
    } finally { vi.unstubAllGlobals(); }
  });
});
