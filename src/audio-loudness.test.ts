import { expect, it } from 'vitest';
import { envelope } from './audio';
import { emptyProject, makeClip } from './model';

it('multiplies editable volume automation with baked transitions and clip gain', () => {
  const project = emptyProject(), clip = Object.assign(makeClip({ id: 'audio', name: 'test', duration: 2, sampleRate: 48000, channels: 1 }, project.tracks[0].id, 0), {
    gain: 0.5, curve: [{ time: 0, gain: 0.5 }, { time: 2, gain: 0.5 }],
    automation: [{ time: 0, gain: 1 }, { time: 2, gain: 2 }], loudnessGain: 4,
  });
  expect(envelope(clip, 1)).toBeCloseTo(0.375, 8);
});
