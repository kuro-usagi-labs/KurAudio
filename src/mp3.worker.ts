import { Mp3Encoder } from '@breezystack/lamejs';
self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; rate: number; bitrate: number; normalize: boolean }>) => {
  try {
    const { channels, rate, bitrate, normalize } = event.data, length = channels[0].length;
    let peak = 0; for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    const gain = normalize && peak ? Math.pow(10, -1 / 20) / peak : 1, encoder = new Mp3Encoder(2, rate, bitrate), chunks: Uint8Array[] = [];
    for (let first = 0; first < length; first += 1152) {
      const count = Math.min(1152, length - first), pcm = channels.map(channel => {
        const result = new Int16Array(count);
        for (let i = 0; i < count; i++) { const value = Math.max(-1, Math.min(1, channel[first + i] * gain)); result[i] = Math.round(value * (value < 0 ? 32768 : 32767)); }
        return result;
      });
      const bytes = encoder.encodeBuffer(pcm[0], pcm[1]); if (bytes.length) chunks.push(bytes.slice());
      if (first % (1152 * 64) === 0) self.postMessage({ progress: first / length });
    }
    const final = encoder.flush(); if (final.length) chunks.push(final.slice());
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    self.postMessage({ bytes, peak }, { transfer: [bytes.buffer] });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
