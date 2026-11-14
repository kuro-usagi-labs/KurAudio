import { measureLoudness } from './loudness';

// Each analysis owns a worker. Cancellation terminates it immediately, even
// while the synchronous DSP loop is busy; no cancellation message can be starved.
self.onmessage = ({ data }: MessageEvent<{ id: number; channels: Float32Array[]; sampleRate: number }>) => {
  try { self.postMessage({ id: data.id, measurement: measureLoudness(data.channels, data.sampleRate) }); }
  catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
