import { denoiseChannel } from './denoise';
type Job = { id: number; channels: Float32Array[]; amount: number };
const scope = globalThis as unknown as { onmessage: (e: MessageEvent<Job>) => void; postMessage: (value: unknown, transfer?: Transferable[]) => void };
scope.onmessage = ({ data }) => {
  try { const channels = data.channels.map(channel => denoiseChannel(channel, data.amount)); scope.postMessage({ id: data.id, channels }, channels.map(c => c.buffer)); }
  catch (error) { scope.postMessage({ id: data.id, error: String(error) }); }
};
