export async function encodeMp3(buffer: AudioBuffer, bitrate: number, normalize: boolean, onProgress: (progress: number) => void = () => {}): Promise<{ bytes: Uint8Array; peak: number }> {
  if (![128, 192, 256, 320].includes(bitrate)) throw new Error('Bitrate MP3 tidak didukung.');
  const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
  const channels = [buffer.getChannelData(0).slice(), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice()];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Encoder MP3 melewati batas waktu. Coba bagian audio yang lebih pendek.')), 240000);
    const finish = (error?: Error, value?: { bytes: Uint8Array; peak: number }) => { clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(value!); };
    worker.onerror = event => finish(new Error(event.message));
    worker.onmessage = event => { if (event.data.error) finish(new Error(event.data.error)); else if (event.data.bytes) finish(undefined, event.data); else onProgress(event.data.progress); };
    worker.postMessage({ channels, rate: buffer.sampleRate, bitrate, normalize }, channels.map(ch => ch.buffer));
  });
}
