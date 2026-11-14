import { type Asset, type Clip, type Project, type AudioRange, clamp, endTime, renderEndTime, MAX_RENDER_SECONDS, uid, crossfadeBounds, curveGain, bakeCrossfades } from './model';
import { createEffectRack, effectiveDenoise, preparedBuffer, type EffectRack } from './effects';

export type Media = { buffer: AudioBuffer; bytes: Uint8Array; peaks: Float32Array };
export const media = new Map<string, Media>();
export const MAX_DECODED_BYTES = 256 * 1024 * 1024;
let context: AudioContext | null = null;
export const audioContext = () => context ??= new AudioContext({ latencyHint: 'interactive' });
export function peaksFor(buffer: AudioBuffer): Float32Array {
  const stride = 256, count = Math.ceil(buffer.length / stride), peaks = new Float32Array(count * 2);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < count; i++) {
    let lo = 0, hi = 0;
    for (let j = i * stride; j < Math.min(buffer.length, (i + 1) * stride); j++) {
      for (const ch of channels) { lo = Math.min(lo, ch[j]); hi = Math.max(hi, ch[j]); }
    }
    peaks[i * 2] = lo; peaks[i * 2 + 1] = hi;
  }
  return peaks;
}
export function putMedia(buffer: AudioBuffer, bytes: Uint8Array, name: string, id = uid(), additionalBytes = 0, destination = media): Asset {
  let total = additionalBytes + buffer.length * buffer.numberOfChannels * 4;
  for (const m of destination.values()) total += m.buffer.length * m.buffer.numberOfChannels * 4;
  if (total > MAX_DECODED_BYTES) throw new Error('Memori audio mencapai batas 256 MB. Simpan proyek dan gunakan berkas yang lebih pendek.');
  if (buffer.duration < 0.02 || buffer.duration > 7200 || buffer.numberOfChannels > 8) throw new Error('Audio harus berdurasi 0,02 detik sampai 2 jam, maksimal 8 kanal.');
  destination.set(id, { buffer, bytes, peaks: peaksFor(buffer) });
  return { id, name, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
}
export function envelope(c: Clip, elapsed: number): number {
  const a = c.fadeIn > 0 ? (c.fadeInStart ?? 0) + (1 - (c.fadeInStart ?? 0)) * clamp(elapsed / c.fadeIn, 0, 1) : 1;
  const b = c.fadeOut > 0 ? (c.fadeOutEnd ?? 0) + (1 - (c.fadeOutEnd ?? 0)) * clamp((c.duration - elapsed) / c.fadeOut, 0, 1) : 1;
  return c.gain * Math.min(a, b) * curveGain(c.curve, elapsed) * curveGain(c.automation, elapsed);
}
export function projectEnvelope(p: Project, c: Clip, elapsed: number): number {
  let gain = envelope(c, elapsed), time = c.start + elapsed;
  for (const fade of p.crossfades ?? []) {
    if (fade.leftId !== c.id && fade.rightId !== c.id) continue;
    const bounds = crossfadeBounds(p, fade); if (!bounds) continue;
    const phase = clamp((time - bounds.start) / bounds.duration, 0, 1);
    gain *= fade.leftId === c.id ? Math.cos(phase * Math.PI / 2) : Math.sin(phase * Math.PI / 2);
  }
  return gain;
}
export function scheduleProject(ctx: BaseAudioContext, p: Project, output: AudioNode, from = 0, at = 0, prepared = new Map<string, AudioBuffer>(), racks = new Map<string, EffectRack>(), cleanup: (() => void)[] = [], until = Infinity, outputGains = new Map<string, GainNode>(), trackGains?: Map<string, GainNode>): AudioBufferSourceNode[] {
  const solo = p.tracks.some(t => t.solo);
  const sources: AudioBufferSourceNode[] = [];
  for (const track of p.tracks) {
    if (!trackGains && (track.muted || (solo && !track.solo))) continue;
    const trackGain = ctx.createGain(); trackGain.gain.value = track.muted || (solo && !track.solo) ? 0 : track.gain; trackGain.connect(output); trackGains?.set(track.id,trackGain);cleanup.push(() => trackGain.disconnect());
    for (const c of p.clips.filter(c => c.trackId === track.id)) {
      const asset = media.get(c.assetId); if (!asset) throw new Error(`Media tidak tersedia: ${c.name}`);
      const elapsed = Math.max(0, from - c.start), remaining = Math.min(c.duration, until - c.start) - elapsed;
      if (remaining <= 0) continue;
      const when = at + Math.max(0, c.start - from), gain = ctx.createGain(), source = ctx.createBufferSource();
      source.buffer = prepared.get(c.id) ?? asset.buffer;
      gain.gain.setValueAtTime(projectEnvelope(p, c, elapsed), when);
      const marks = [c.fadeIn, c.duration - c.fadeOut, Math.min(c.duration, elapsed + remaining), ...(c.curve ?? []).map(point => point.time), ...(c.automation ?? []).map(point => point.time)];
      for (const fade of p.crossfades ?? []) if (fade.leftId === c.id || fade.rightId === c.id) {
        const bounds = crossfadeBounds(p, fade); if (bounds) for (let i = 0; i <= 64; i++) marks.push(bounds.start + bounds.duration * i / 64 - c.start);
      }
      // Products of linear fades/automation/baked curves are not themselves
      // linear. Subdivide curved segments so opposing envelopes cannot cancel
      // the whole clip just because both endpoint products happen to be zero.
      const ramp = (a: number, b: number, ga: number, gb: number, depth = 0) => {
        const middle = (a + b) / 2, gm = projectEnvelope(p, c, middle);
        const q1 = projectEnvelope(p, c, (3 * a + b) / 4), q3 = projectEnvelope(p, c, (a + 3 * b) / 4);
        const error = Math.max(Math.abs(gm - (ga + gb) / 2), Math.abs(q1 - (3 * ga + gb) / 4), Math.abs(q3 - (ga + 3 * gb) / 4));
        if (depth < 12 && error > 0.00002) { ramp(a, middle, ga, gm, depth + 1); ramp(middle, b, gm, gb, depth + 1); }
        else gain.gain.linearRampToValueAtTime(gb, when + b - elapsed);
      };
      let previous = elapsed;
      for (const mark of [...new Set(marks)].filter(t => t > elapsed && t <= elapsed + remaining).sort((a, b) => a - b)) { ramp(previous, mark, projectEnvelope(p, c, previous), projectEnvelope(p, c, mark)); previous = mark; }
      const rack = createEffectRack(ctx, c.effects), loudness = ctx.createGain(); racks.set(c.id, rack); outputGains.set(c.id, loudness);
      loudness.gain.value = c.loudnessGain ?? 1;
      source.connect(gain); gain.connect(rack.input); rack.output.connect(loudness); loudness.connect(trackGain); cleanup.push(() => { gain.disconnect(); rack.disconnect(); loudness.disconnect(); });
      source.start(when, c.offset + elapsed, remaining); sources.push(source);
    }
  }
  return sources;
}
async function prepareBuffers(p: Project, ctx: BaseAudioContext) {
  const buffers = new Map<string, AudioBuffer>();
  for (const clip of p.clips) { const source = media.get(clip.assetId); if (!source) throw new Error(`Media tidak tersedia: ${clip.name}`); buffers.set(clip.id, await preparedBuffer(clip.assetId, source.buffer, effectiveDenoise(clip), ctx)); }
  return buffers;
}
export async function renderProject(project: Project, sampleRate = project.sampleRate, range?: AudioRange): Promise<AudioBuffer> {
  const from = range ? Math.max(0, range.start - 12) : 0, duration = range ? range.end - from : renderEndTime(project);
  if (duration <= 0) throw new Error('Timeline masih kosong. Tambahkan audio terlebih dahulu.');
  if ((range ? range.end - range.start : endTime(project)) > MAX_RENDER_SECONDS) throw new Error('Ekspor versi ini dibatasi 15 menit per berkas.');
  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate), cleanup: (() => void)[] = [];
  const prepared = await prepareBuffers(project, offline);
  const scoped = range ? { ...project, clips: project.clips.filter(c => range.trackIds.includes(c.trackId)) } : project;
  try {
    scheduleProject(offline, scoped, offline.destination, from, 0, prepared, new Map(), cleanup, range?.end);
    const rendered = await offline.startRendering();
    if (!range) return rendered;
    const first = Math.round((range.start - from) * sampleRate), length = Math.max(1, Math.round((range.end - range.start) * sampleRate));
    const result = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    for (let ch = 0; ch < 2; ch++) result.copyToChannel(rendered.getChannelData(ch).subarray(first, first + length), ch);
    return result;
  }
  finally { cleanup.forEach(disconnect => disconnect()); }
}

/** Render the actual clip and its FX tail without track mix controls or leading timeline silence. */
export async function renderClipAudio(project: Project, clipId: string, sampleRate = 48000): Promise<AudioBuffer> {
  const scoped = structuredClone(project), clip = scoped.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Klip sudah tidak tersedia.');
  // Freeze only this clip's crossfade before removing its neighbours. Automation
  // remains independent and follows the same graph as playback/export.
  bakeCrossfades(scoped, [clipId]);
  scoped.clips = [{ ...clip, start: 0 }]; scoped.crossfades = []; scoped.loop = undefined;
  scoped.tracks = scoped.tracks.filter(t => t.id === clip.trackId).map(t => ({ ...t, gain: 1, muted: false, solo: false }));
  return renderProject(scoped, sampleRate);
}
class Playback {
  sources: AudioBufferSourceNode[] = [];
  analyser: AnalyserNode | null = null;
  master: GainNode | null = null;
  playing = false;
  private from = 0;
  private at = 0;
  private frame = 0;
  private duration = 0;
  private epoch = 0;
  private updating = 0;
  private racks = new Map<string, EffectRack>();
  private outputGains = new Map<string, GainNode>();
  private trackGains = new Map<string, GainNode>();
  private loopNodes = new Map<string, {source:AudioBufferSourceNode;fade:GainNode}>();
  private cleanup: (() => void)[] = [];
  private denoiseSignature = '';
  private project: Project | null = null;
  private loop: { start: number; end: number } | null = null;
  private limit: number | null = null;
  private onTick: (time: number, peak: number) => void = () => {};
  private onEnd: () => void = () => {};
  private signature(p: Project) { return p.clips.map(c => `${c.id}:${effectiveDenoise(c)}`).join('|'); }
  updateMix(p:Project) {
    if(this.project)this.project={...this.project,tracks:this.project.tracks.map(track=>p.tracks.find(t=>t.id===track.id)??track)};
    const solo=p.tracks.some(t=>t.solo),now=audioContext().currentTime;
    for(const track of p.tracks){const gain=this.trackGains.get(track.id)?.gain;if(gain){gain.cancelScheduledValues(now);gain.setTargetAtTime(track.muted||(solo&&!track.solo)?0:track.gain,now,.01);}}
  }
  previewTrackGain(id:string,value:number){if(!this.project)return;this.updateMix({...this.project,tracks:this.project.tracks.map(t=>t.id===id?{...t,gain:value}:t)});}
  private async renderLoopStems(p:Project,loop:{start:number;end:number},isCurrent:()=>boolean){
    const tracks=p.tracks.filter(t=>p.clips.some(c=>c.trackId===t.id));
    // Keep headroom for the previous stems while an effects update crossfades in.
    const frames=Math.ceil((loop.end-loop.start)*audioContext().sampleRate);
    if(frames*2*4*tracks.length>MAX_DECODED_BYTES)throw new Error('Memori loop melebihi 256 MB. Pendekkan rentang loop atau kurangi track berisi audio.');
    const stems=new Map<string,AudioBuffer>();
    for(const track of tracks){if(!isCurrent())return stems;
      const scoped={...p,tracks:[{...track,gain:1,muted:false,solo:false}],clips:p.clips.filter(c=>c.trackId===track.id)};
      stems.set(track.id,await renderProject(scoped,audioContext().sampleRate,{...loop,trackIds:[track.id]}));
    }return stems;
  }
  private installLoopStems(stems:Map<string,AudioBuffer>,when:number,offset:number,swap=false){
    const ctx=audioContext(),previous=this.loopNodes;this.loopNodes=new Map();
    for(const [id,buffer] of stems){let gain=this.trackGains.get(id);if(!gain){gain=ctx.createGain();gain.connect(this.master!);this.trackGains.set(id,gain);this.cleanup.push(()=>gain!.disconnect());}
      const source=ctx.createBufferSource(),fade=ctx.createGain();source.buffer=buffer;source.loop=true;source.connect(fade);fade.connect(gain);
      if(swap){fade.gain.setValueAtTime(0,when);fade.gain.linearRampToValueAtTime(1,when+.02);}source.onended=()=>{source.disconnect();fade.disconnect();};source.start(when,offset);this.loopNodes.set(id,{source,fade});
    }
    for(const {source,fade} of previous.values()){fade.gain.setValueAtTime(fade.gain.value,when);fade.gain.linearRampToValueAtTime(0,when+.02);source.stop(when+.021);}
    this.sources=[...this.loopNodes.values()].map(n=>n.source);if(this.project)this.updateMix(this.project);
  }
  previewEffects(clipId: string, effects: import('./model').Effects) { this.racks.get(clipId)?.update(effects); if (this.project) this.duration = Math.min(this.limit ?? Infinity, renderEndTime({ ...this.project, clips: this.project.clips.map(c => c.id === clipId ? { ...c, effects } : c) })); }
  async updateEffects(p: Project) {
    if (this.limit !== null && this.project) {
      const updates = new Map(p.clips.map(c => [c.id, c]));
      p = { ...this.project, clips: this.project.clips.map(c => { const update = updates.get(c.id); return update ? { ...c, effects: update.effects, loudnessGain: update.loudnessGain } : c; }) };
    }
    this.project = p;
    const ticket = ++this.updating, epoch = this.epoch;
    this.duration = Math.min(this.limit ?? Infinity, renderEndTime(p));
    for (const clip of p.clips) {
      this.racks.get(clip.id)?.update(clip.effects);
      const gain = this.outputGains.get(clip.id)?.gain;
      if (gain) { gain.cancelScheduledValues(audioContext().currentTime); gain.setTargetAtTime(clip.loudnessGain ?? 1, audioContext().currentTime, 0.012); }
    }
    if(this.loop){
      const stems=await this.renderLoopStems(p,this.loop,()=>ticket===this.updating&&epoch===this.epoch&&this.playing);
      if(ticket!==this.updating||epoch!==this.epoch||!this.playing)return;
      const when=audioContext().currentTime+.025,offset=(this.position-this.loop.start+.025)%(this.loop.end-this.loop.start);
      this.installLoopStems(stems,when,offset,true);this.denoiseSignature=this.signature(p);return;
    }
    if (this.signature(p) !== this.denoiseSignature) {
      await prepareBuffers(p, audioContext());
      if (ticket !== this.updating || epoch !== this.epoch || !this.playing) return;
      await this.play({...p,tracks:this.project?.tracks??p.tracks}, this.position, this.onTick, this.onEnd, this.limit ?? undefined);
    }
  }
  get position() {
    if (!this.playing) return this.from;
    const elapsed = Math.max(0, audioContext().currentTime - this.at);
    return this.loop ? this.loop.start + (this.from - this.loop.start + elapsed) % (this.loop.end - this.loop.start) : Math.min(this.duration, this.from + elapsed);
  }
  async play(p: Project, from: number, onTick: (time: number, peak: number) => void, onEnd: () => void, until?: number) {
    this.stop(); this.project=p;const ticket = this.epoch, ctx = audioContext(); await ctx.resume(); if (ticket !== this.epoch) return false;
    const prepared = await prepareBuffers(p, ctx); if (ticket !== this.epoch) return false;
    this.limit = until !== undefined && Number.isFinite(until) ? Math.max(0, until) : null;
    this.loop = this.limit === null && p.loop?.enabled ? { start: p.loop.start, end: p.loop.end } : null;
    const loopMix = this.loop ? await this.renderLoopStems(p,this.loop,()=>ticket===this.epoch) : null;
    if (ticket !== this.epoch) return false;
    p={...p,tracks:this.project?.tracks??p.tracks};this.onTick = onTick; this.onEnd = onEnd; this.denoiseSignature = this.signature(p); this.project = p;
    this.duration = Math.min(this.limit ?? Infinity, renderEndTime(p));
    if (this.limit !== null && (from >= this.duration || this.duration <= 0)) return false;
    this.from = from >= this.duration ? 0 : Math.max(0, from); this.at = ctx.currentTime + 0.035;
    if (this.loop && (from < this.loop.start || from >= this.loop.end)) this.from = this.loop.start;
    else if (this.loop) this.from = from;
    this.master = ctx.createGain(); this.master.gain.value = 1;
    if (this.limit !== null) this.master.gain.setValueAtTime(0, this.at + this.duration - this.from);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.master.connect(this.analyser); this.analyser.connect(ctx.destination);
    if (loopMix && this.loop) {
      this.installLoopStems(loopMix,this.at,this.from-this.loop.start);
    } else this.sources = scheduleProject(ctx, p, this.master, this.from, this.at, prepared, this.racks, this.cleanup, this.limit ?? Infinity, this.outputGains,this.trackGains);
    if (this.limit !== null) for (const source of this.sources) source.stop(this.at + this.duration - this.from);
    this.playing = true;
    const wave = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      if (!this.playing) return;
      this.analyser!.getFloatTimeDomainData(wave); let peak = 0; for (const n of wave) peak = Math.max(peak, Math.abs(n));
      onTick(this.position, peak);
      if (!this.loop && this.position >= this.duration) { this.stop(); onEnd(); } else this.frame = requestAnimationFrame(tick);
    };
    tick(); return true;
  }
  stop() {
    this.epoch++; this.updating++;
    const pos = this.position; this.playing = false; this.from = pos;
    cancelAnimationFrame(this.frame); this.sources.forEach(s => { try { s.stop(); s.disconnect(); } catch { /* already stopped */ } });
    this.loopNodes.forEach(n=>n.fade.disconnect());this.loopNodes.clear();this.trackGains.clear();this.cleanup.forEach(disconnect => disconnect()); this.cleanup = []; this.racks.clear(); this.outputGains.clear();
    this.sources = []; this.master?.disconnect(); this.analyser?.disconnect(); this.master = null; this.analyser = null;
    return pos;
  }
}
export const playback = new Playback();

export function pcmBytes(buffer: AudioBuffer, normalize: boolean): { bytes: Uint8Array; peak: number } {
  const channels = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))];
  let peak = 0; for (const ch of channels) for (const n of ch) peak = Math.max(peak, Math.abs(n));
  const scale = normalize && peak > 0 ? 0.891250938 / peak : 1;
  const bytes = new Uint8Array(buffer.length * 8), view = new DataView(bytes.buffer);
  for (let f = 0; f < buffer.length; f++) for (let ch = 0; ch < 2; ch++) view.setFloat32((f * 2 + ch) * 4, channels[ch][f] * scale, true);
  return { bytes, peak };
}
export function encodeWav(buffer: AudioBuffer, bits = 24, normalize = false): { bytes: Uint8Array; peak: number } {
  const pcm = pcmBytes(buffer, normalize), bytesPerSample = bits / 8, dataLength = buffer.length * 2 * bytesPerSample;
  const bytes = new Uint8Array(44 + dataLength), v = new DataView(bytes.buffer), f = new DataView(pcm.bytes.buffer);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLength, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * 2 * bytesPerSample, true); v.setUint16(32, 2 * bytesPerSample, true); v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, dataLength, true);
  for (let i = 0; i < buffer.length * 2; i++) {
    const sample = clamp(f.getFloat32(i * 4, true), -1, 1);
    if (bits === 16) v.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    else { const n = Math.round(sample * (sample < 0 ? 8388608 : 8388607)); const at = 44 + i * 3; v.setUint8(at, n & 255); v.setUint8(at + 1, (n >> 8) & 255); v.setUint8(at + 2, (n >> 16) & 255); }
  }
  return { bytes, peak: pcm.peak };
}

export function encodeFloatWav(buffer: AudioBuffer): Uint8Array {
  // Internal bounces retain floating-point headroom. PCM export alone clamps/normalizes.
  const pcm = pcmBytes(buffer, false).bytes, bytes = new Uint8Array(44 + pcm.length), v = new DataView(bytes.buffer);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 2, true); v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * 8, true); v.setUint16(32, 8, true); v.setUint16(34, 32, true); str(36, 'data'); v.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
  return bytes;
}

export function demoMedia(): { assets: Asset[]; clips: Clip[] } {
  const ctx = audioContext();
  const generate = (name: string, duration: number, fn: (t: number) => number) => {
    const b = ctx.createBuffer(2, Math.round(duration * ctx.sampleRate), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const data = b.getChannelData(ch); for (let i = 0; i < data.length; i++) data[i] = fn(i / ctx.sampleRate + ch * 0.00012); }
    return putMedia(b, encodeWav(b, 16).bytes, name);
  };
  const voice = generate('Demo • melodi.wav', 7.2, t => Math.sin(2 * Math.PI * [261.63, 329.63, 392, 440, 392, 329.63, 293.66, 261.63][Math.floor(t * 2) % 8] * t) * 0.19 * Math.pow(Math.sin(Math.PI * (t * 2 % 1)), 2));
  const music = generate('Demo • ambient.wav', 24, t => (Math.sin(t * 2 * Math.PI * 130.81) + Math.sin(t * 2 * Math.PI * 164.81) + Math.sin(t * 2 * Math.PI * 196)) * 0.035 * Math.min(1, t) * Math.min(1, 24 - t));
  const effect = generate('Demo • transisi.wav', 1.8, t => Math.sin(2 * Math.PI * (360 * t + 240 * t * t)) * Math.sin(Math.PI * t / 1.8) * 0.12);
  return { assets: [voice, music, effect], clips: [] };
}
