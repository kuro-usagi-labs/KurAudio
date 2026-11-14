class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.running = false; this.chunk = new Float32Array(4096); this.at = 0; this.frames = 0; this.meterFrames = 0; this.peak = 0;
    this.port.onmessage = event => {
      if (event.data.type === 'start') { this.running = true; this.frames = 0; this.at = 0; this.maximum = event.data.maximum; }
      if (event.data.type === 'stop') this.finish();
    };
  }
  flush() { if (this.at) { const samples = this.chunk.slice(0, this.at); this.port.postMessage({ samples }, [samples.buffer]); this.at = 0; } }
  finish() { this.running = false; this.flush(); this.port.postMessage({ finished: true }); }
  process(inputs) {
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0; for (const channel of channels) value += channel[i] / channels.length;
      this.peak = Math.max(this.peak, Math.abs(value)); this.meterFrames++;
      if (this.running) { this.chunk[this.at++] = value; this.frames++; if (this.at === this.chunk.length) this.flush(); if (this.frames >= this.maximum) this.finish(); }
      if (this.meterFrames >= 2048) { this.port.postMessage({ peak: this.peak, elapsed: this.frames / sampleRate }); this.peak = 0; this.meterFrames = 0; }
    }
    return true;
  }
}
registerProcessor('kuraudio-capture', CaptureProcessor);
