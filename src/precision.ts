import { clamp, curveGain, splitClip, type Clip } from './model';

/** Keep every channel separate: a stereo downmix can cancel while both channels are loud. */
export function nearestZeroCrossing(channels: readonly Float32Array[], sampleRate: number, time: number, radiusSeconds = 0.005): number {
  const requested = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return requested;
  const length = Math.min(...channels.map(channel => channel.length)); if (!length) return requested;
  const target = clamp(requested * sampleRate, 0, length - 1), fallback = Math.round(target);
  const radius = Number.isFinite(radiusSeconds) ? Math.max(0, radiusSeconds) * sampleRate : 0;
  let best = fallback, bestChannels = 0, bestDistance = Infinity, bestEnergy = Infinity;
  for (let i = Math.max(0, Math.ceil(target - radius)); i <= Math.min(length - 1, Math.floor(target + radius)); i++) {
    let crossings = 0, energy = 0;
    for (const channel of channels) {
      const sample = channel[i], previous = channel[Math.max(0, i - 1)];
      if (!Number.isFinite(sample) || !Number.isFinite(previous)) continue;
      energy += sample * sample;
      if (sample === 0 || previous < 0 && sample > 0 || previous > 0 && sample < 0) crossings++;
    }
    const distance = Math.abs(i - target);
    // Prefer a boundary shared by all channels, then the nearest such boundary.
    if (crossings > 0 && (crossings > bestChannels || crossings === bestChannels && (distance < bestDistance || distance === bestDistance && energy < bestEnergy))) {
      best = i; bestChannels = crossings; bestDistance = distance; bestEnergy = energy;
    }
  }
  return best / sampleRate;
}

function taperCut(clip: Clip, side: 'left' | 'right', seconds: number): Clip {
  const width = Math.min(seconds, clip.duration), from = side === 'left' ? 0 : clip.duration - width;
  const marks = new Set([0, clip.duration, ...(clip.curve ?? []).map(point => point.time)]);
  for (let i = 0; i <= 16; i++) marks.add(from + width * i / 16);
  const previous = clip.curve;
  return { ...clip, curve: [...marks].sort((a, b) => a - b).map(time => ({ time, gain: curveGain(previous, time) * clamp(side === 'left' ? time / width : (clip.duration - time) / width, 0, 1) })) };
}

/** Add tiny cut-edge tapers to the baked envelope, preserving editable volume and existing fades. */
export function splitClipSafe(clip: Clip, time: number, seconds = 0.003): Clip[] {
  const pieces = splitClip(clip, time);
  if (pieces.length !== 2 || !Number.isFinite(seconds) || seconds <= 0) return pieces;
  return [taperCut(pieces[0], 'right', seconds), taperCut(pieces[1], 'left', seconds)];
}
