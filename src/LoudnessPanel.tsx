import { useEffect, useRef, useState } from 'react';
import { ChartBar, LockSimple, Stop, Waveform } from '@phosphor-icons/react';
import { type Project, editor } from './model';
import { isClipLocked } from './editing';
import { isLoudnessResultCurrent, loudnessMatch, measureClipLoudness, type ClipLoudnessResult } from './loudness';
import './loudness.css';

type Row = { clipId: string; result?: ClipLoudnessResult; error?: string };
const number = (value: number | null) => value === null ? '—' : value.toFixed(1);

export function LoudnessPanel({ project, selected, onBeforeWork, onApplied }: { project: Project; selected: string[]; onBeforeWork: () => void; onApplied?: () => void }) {
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [target, setTarget] = useState('-16'), [ceiling, setCeiling] = useState('-1');
  const [rows, setRows] = useState<Row[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null), measureButton = useRef<HTMLButtonElement>(null);
  const selectedKey = selected.join('|');
  useEffect(() => { controller.current?.abort(); controller.current = null; setBusy(false); setRows([]); }, [project, scope, selectedKey]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const clips = project.clips.filter(clip => scope === 'all' || selected.includes(clip.id));
  const clipsById = new Map(project.clips.map(clip => [clip.id, clip]));
  const targetNumber = Number(target), peakNumber = Number(ceiling);
  const validTargets = target.trim() !== '' && ceiling.trim() !== '' && Number.isFinite(targetNumber) && targetNumber >= -70 && targetNumber <= 0 && Number.isFinite(peakNumber) && peakNumber >= -20 && peakNumber <= 0;
  const matches = rows.flatMap(row => {
    const clip = clipsById.get(row.clipId);
    return row.result && clip && validTargets && isLoudnessResultCurrent(project, row.result) ? [{ clip, result: row.result, match: loudnessMatch(row.result.measurement, clip.loudnessGain ?? 1, targetNumber, peakNumber) }] : [];
  });
  const matchesById = new Map(matches.map(item => [item.clip.id, item]));
  const applicable = matches.filter(item => item.match.available && !isClipLocked(project, item.clip) && Math.abs(item.match.gain - (item.clip.loudnessGain ?? 1)) > 0.000001);
  const cancel = () => {
    controller.current?.abort(); controller.current = null; setBusy(false); setRows([]); setMessage('Analisis dibatalkan.');
    requestAnimationFrame(() => measureButton.current?.focus());
  };
  const measure = async () => {
    onBeforeWork(); controller.current?.abort();
    const work = new AbortController(); controller.current = work;
    setRows([]); setMessage(''); setBusy(true);
    const output: Row[] = [], sourceProject = project;
    try {
      for (const clip of clips) {
        if (work.signal.aborted) return;
        try {
          const result = await measureClipLoudness(sourceProject, clip, { signal: work.signal });
          if (work.signal.aborted || controller.current !== work) return;
          const current = editor.get().project;
          if (!isLoudnessResultCurrent(current, result)) { setMessage('Audio berubah. Ukur kembali.'); setRows([]); return; }
          output.push({ clipId: clip.id, result });
        } catch (error) {
          if (work.signal.aborted || controller.current !== work) return;
          output.push({ clipId: clip.id, error: error instanceof Error ? error.message : String(error) });
        }
        setRows([...output]);
      }
      setMessage(`${output.filter(row => row.result).length} klip selesai diukur.`);
    } finally { if (controller.current === work) { controller.current = null; setBusy(false); } }
  };
  const apply = () => {
    if (busy || !validTargets || !applicable.length) return;
    const current = editor.get().project;
    if (current.id !== project.id || rows.some(row => row.result && !isLoudnessResultCurrent(current, row.result))) { setRows([]); setMessage('Audio berubah. Ukur kembali.'); return; }
    onBeforeWork();
    const ids = new Set(applicable.map(item => item.clip.id));
    const measuredById = new Map(rows.map(row => [row.clipId, row.result]));
    editor.edit('Cocokkan loudness klip', draft => {
      for (const clip of draft.clips) {
        if (!ids.has(clip.id) || isClipLocked(draft, clip)) continue;
        const measured = measuredById.get(clip.id);
        if (!measured || !isLoudnessResultCurrent(draft, measured)) continue;
        clip.loudnessGain = loudnessMatch(measured.measurement, clip.loudnessGain ?? 1, targetNumber, peakNumber).gain;
      }
    });
    setMessage(`Loudness ${applicable.length} klip dicocokkan. Ukur kembali untuk memeriksa hasil.`); onApplied?.();
  };
  return <section className="loudness-panel" aria-label="Pencocokan loudness" aria-busy={busy}>
    <div className="loudness-intro"><ChartBar size={23} weight="light"/><div><h3>Loudness</h3><p>Cocokkan keras suara tiap klip setelah efek, fade, dan otomasi.</p></div></div>
    <div className="loudness-scope" role="group" aria-label="Cakupan klip"><button aria-pressed={scope === 'selected'} onClick={() => setScope('selected')}>Klip terpilih <span>{selected.length}</span></button><button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Semua klip <span>{project.clips.length}</span></button></div>
    <p className="loudness-scope-note">Diukur per klip. Volume, mute, dan solo track tidak ikut diukur.</p>
    <div className="loudness-targets"><label><span>Target loudness</span><div><input aria-label="Target loudness" type="number" min={-70} max={0} step={0.5} value={target} onChange={event => setTarget(event.target.value)}/><small>LUFS</small></div></label><label><span>Batas true peak</span><div><input aria-label="Batas true peak" type="number" min={-20} max={0} step={0.1} value={ceiling} onChange={event => setCeiling(event.target.value)}/><small>dBTP</small></div></label></div>
    {!validTargets && <p className="loudness-notice" role="alert">Target harus −70 sampai 0 LUFS; true peak −20 sampai 0 dBTP.</p>}
    <div className="loudness-actions"><button ref={measureButton} onClick={() => void measure()} disabled={busy || !clips.length}><Waveform size={16}/>Ukur loudness</button>{busy && <button onClick={cancel}><Stop size={14}/>Batalkan analisis</button>}</div>
    <div className="loudness-status" role="status" aria-live="polite">{busy ? `Mengukur ${Math.min(rows.length + 1, clips.length)} dari ${clips.length} klip…` : message || (!clips.length ? 'Pilih klip di timeline atau gunakan Semua klip.' : 'Siap mengukur klip dalam cakupan ini.')}</div>
    {!!rows.length && <ul className="loudness-results" aria-label="Hasil loudness">{rows.map(row => {
      const clip = clipsById.get(row.clipId); if (!clip) return null;
      const measurement = row.result?.measurement, prediction = matchesById.get(clip.id)?.match, locked = isClipLocked(project, clip);
      return <li key={clip.id} data-loudness-result={clip.id} data-loudness-limited={prediction?.limited || undefined}><div className="loudness-result-name"><strong title={clip.name}>{clip.name}</strong>{locked && <span className="loudness-locked"><LockSimple size={12}/>Terkunci</span>}</div>
        {row.error ? <p className="loudness-notice">{row.error}</p> : measurement && <>
          <div className="loudness-readings"><span><strong>{number(measurement.integratedLufs)}</strong> LUFS</span><span><strong>{number(measurement.truePeakDbtp)}</strong> dBTP</span></div>
          {!prediction?.available ? <p>{measurement.silent ? 'Hening · tidak diubah' : !measurement.blocks ? 'Kurang dari 400 ms · tidak diubah' : 'Di bawah ambang ukur · tidak diubah'}</p> : !locked && <p className={prediction.limited ? 'loudness-notice' : 'loudness-prediction'}>{prediction.limited ? prediction.limitReason === 'peak' ? 'Terbatas true peak' : prediction.limitReason === 'gain' ? 'Terbatas gain maksimum' : 'Terbatas ambang ukur' : 'Prediksi'} · {number(prediction.integratedLufs)} LUFS / {number(prediction.truePeakDbtp)} dBTP</p>}
        </>}
      </li>;
    })}</ul>}
    <button className="primary loudness-apply" disabled={busy || !validTargets || !applicable.length} onClick={apply}>Terapkan pencocokan{applicable.length ? ` · ${applicable.length} klip` : ''}</button>
    <p className="loudness-footnote">Gain dibatasi oleh headroom puncak tiap klip. Target yang melebihi batas ditandai; puncak gabungan track bisa lebih tinggi.</p>
  </section>;
}
