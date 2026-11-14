import { useEffect, useRef, useState } from 'react';
import { type Clip, type Project, editor } from './model';
import { media, playback } from './audio';
import { Fader } from './Fader';
import { removeSilences, mergeIntervals } from './editing';
import type { Interval, SilenceOptions } from './silenceDetection';
import { CheckField } from './CheckField';
import {onAppearanceChange} from './appearance';
type Removal = Interval & { trackId: string; clipId: string };

function Preview({ clip, removals }: { clip: Clip; removals: Removal[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!, audio = media.get(clip.assetId); if (!audio) return;
    const draw = () => { const style = getComputedStyle(el); ctx.clearRect(0, 0, el.width, el.height); ctx.fillStyle = style.color;
    const data = audio.peaks, rate = audio.buffer.sampleRate / 256;
    for (let x = 0; x < el.width; x++) { const first = Math.floor((clip.offset + x / el.width * clip.duration) * rate), last = Math.min(data.length / 2, Math.ceil((clip.offset + (x + 1) / el.width * clip.duration) * rate)); let peak = 0; for (let i = first; i < last; i++) peak = Math.max(peak, Math.abs(data[i * 2]), data[i * 2 + 1]); ctx.fillRect(x, el.height / 2 - peak * el.height / 2, 1, Math.max(1, peak * el.height)); }
    }; draw(); return onAppearanceChange(draw);
  }, [clip]);
  return <div className="silence-preview"><canvas ref={canvas} width={640} height={64} aria-label={`Preview hening ${clip.name}`}/>{removals.map((r, i) => <span key={i} style={{ left: `${(r.start - clip.start) / clip.duration * 100}%`, width: `${(r.end - r.start) / clip.duration * 100}%` }}/>)}</div>;
}
export function SilencePanel({ project, clips, onDone }: { project: Project; clips: Clip[]; onDone: () => void }) {
  const [options, setOptions] = useState<SilenceOptions>({ threshold: -40, minimum: 0.35, keep: 0.12 }), [removals, setRemovals] = useState<Removal[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [ripple, setRipple] = useState(true), [previewing, setPreviewing] = useState(false);
  const worker = useRef<Worker | null>(null), cancelled = useRef(false), abortAnalysis = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { cancelled.current = false; return () => { cancelled.current = true; abortAnalysis.current?.(); worker.current?.terminate(); playback.stop(); }; }, []);
  const change = (key: keyof SilenceOptions, value: number) => { playback.stop(); setPreviewing(false); setOptions({ ...options, [key]: value }); setRemovals(null); };
  const analyze = async () => {
    setBusy(true); setError(''); playback.stop(); setPreviewing(false); const result: Removal[] = [];
    try {
      for (const clip of clips) {
        const buffer = media.get(clip.assetId)?.buffer; if (!buffer) throw new Error(`Media tidak tersedia: ${clip.name}`);
        const instance = new Worker(new URL('./silence.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
        const first = Math.round(clip.offset * buffer.sampleRate), end = Math.round((clip.offset + clip.duration) * buffer.sampleRate);
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch).slice(first, end));
        const ranges = await new Promise<Interval[]>((resolve, reject) => {
          const timeout = setTimeout(() => { instance.terminate(); reject(new Error('Analisis melewati batas waktu.')); }, 120000);
          abortAnalysis.current = () => { clearTimeout(timeout); instance.terminate(); resolve([]); };
          instance.onerror = e => { clearTimeout(timeout); reject(new Error(e.message)); };
          instance.onmessage = e => { clearTimeout(timeout); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.ranges); };
          instance.postMessage({ channels, rate: buffer.sampleRate, options }, channels.map(c => c.buffer));
        });
        instance.terminate(); abortAnalysis.current = undefined; if (cancelled.current) return;
        result.push(...ranges.map(r => ({ start: clip.start + r.start, end: clip.start + r.end, trackId: clip.trackId, clipId: clip.id })));
      }
      setRemovals(result);
    } catch (e) { if (!cancelled.current) setError(String(e)); } finally { if (!cancelled.current) setBusy(false); }
  };
  const preview = structuredClone(project); if (removals) removeSilences(preview, removals, ripple);
  const unique = project.tracks.flatMap(track => mergeIntervals((removals ?? []).filter(r => r.trackId === track.id)));
  return <div className="session-section" aria-busy={busy}>
    <p className="modal-note">{clips.length?`${clips.length} klip dianalisis. Bagian berwarna akan dipangkas pada track yang dipilih.`:'Pilih klip yang tidak terkunci untuk memangkas hening.'}</p>
    {([['threshold', 'Batas hening', -70, -10, 1, 'dB'], ['minimum', 'Hening minimum', 0.1, 3, 0.05, 's'], ['keep', 'Jeda disisakan', 0, 1, 0.02, 's']] as const).map(([key, label, min, max, step, unit]) => <label key={key} className="analysis-control"><span>{label}<output>{options[key]} {unit}</output></span><Fader label={label} value={options[key]} min={min} max={max} step={step} unit={unit} muteAtMin={false} disabled={busy} onChange={value => change(key, value)}/></label>)}
    <CheckField checked={ripple} disabled={busy} onChange={value => { playback.stop(); setPreviewing(false); setRipple(value); }}>Tutup celah setelah dipangkas</CheckField>
    <button className="button" disabled={busy || !clips.length} onClick={() => void analyze()}>{busy ? 'Menganalisis…' : 'Analisis hening'}</button>
    {removals && <><p role="status" className="analysis-summary">{unique.length} bagian · {unique.reduce((sum, r) => sum + r.end - r.start, 0).toFixed(2)} s dipangkas</p>{clips.slice(0, 6).map(clip => <Preview key={clip.id} clip={clip} removals={removals.filter(r => r.clipId === clip.id)}/>)}<div className="modal-actions"><button className="button" disabled={busy || !removals.length} onClick={async () => { if (previewing) { playback.stop(); setPreviewing(false); return; } try { setPreviewing(true); await playback.play({ ...preview, loop: undefined }, Math.max(0, Math.min(...clips.map(c => c.start))), () => {}, () => setPreviewing(false)); } catch (e) { setError(String(e)); setPreviewing(false); } }}>{previewing ? 'Hentikan preview' : 'Putar preview'}</button><button className="button destructive" disabled={busy || !removals.length} onClick={() => { playback.stop(); editor.edit('Pangkas hening', p => removeSilences(p, removals, ripple)); onDone(); }}>Terapkan pemangkasan</button></div></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
