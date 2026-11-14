import { detectSilence, type SilenceOptions } from './silenceDetection';
self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; rate: number; options: SilenceOptions }>) => {
  try { self.postMessage({ ranges: detectSilence(event.data.channels, event.data.rate, event.data.options) }); }
  catch (error) { self.postMessage({ error: String(error) }); }
};
