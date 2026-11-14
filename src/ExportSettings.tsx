import { CheckField } from './CheckField';
import { formatTime, type AudioRange, type Project } from './model';
import { resolveExportScope, exportFilename, estimateExportBytes, type ExportScope, type ExportFormat } from './exportScope';
export type { ExportScope, ExportFormat } from './exportScope';
type Props = { project: Project; range: AudioRange | null; selected: string[]; scope: ExportScope; setScope: (value: ExportScope) => void; format: ExportFormat; setFormat: (value: ExportFormat) => void; name: string; setName: (value: string) => void; sampleRate: number; setSampleRate: (value: number) => void; bits: number; setBits: (value: number) => void; bitrate: number; setBitrate: (value: number) => void; normalize: boolean; setNormalize: (value: boolean) => void };
export function ExportSettings(p: Props) {
  let summary: ReturnType<typeof resolveExportScope> | undefined, error = '';
  try { summary = resolveExportScope(p.project, p.selected, p.range, p.scope); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const filename = exportFilename(p.name, p.format, p.project.name);
  const bytes = summary ? estimateExportBytes(summary.duration, p.format, p.sampleRate, p.bits, p.bitrate) : 0;
  return <div className="export-settings">
    <label className="field-label">Nama berkas<input aria-label="Nama berkas ekspor" value={p.name} maxLength={160} onChange={e => p.setName(e.target.value)}/></label>
    <fieldset className="option-field"><legend>Cakupan</legend><div className="segmented">{([['project', 'Seluruh proyek'], ['selected', 'Klip terpilih'], ['range', 'Rentang']] as const).map(([value, label]) => <button key={value} aria-pressed={p.scope === value} disabled={value === 'selected' ? !p.selected.length : value === 'range' ? !p.range : false} onClick={() => p.setScope(value)}>{label}</button>)}</div></fieldset>
    <fieldset className="option-field"><legend>Format</legend><div className="segmented">{(['wav', 'mp3'] as const).map(format => <button key={format} aria-pressed={p.format === format} onClick={() => p.setFormat(format)}>{format.toUpperCase()}</button>)}</div></fieldset>
    <fieldset className="option-field"><legend>Sample rate</legend><div className="segmented">{[44100, 48000].map(rate => <button key={rate} aria-pressed={p.sampleRate === rate} onClick={() => p.setSampleRate(rate)}>{rate / 1000} kHz</button>)}</div></fieldset>
    {p.format === 'wav' ? <fieldset className="option-field"><legend>Bit depth</legend><div className="segmented">{[16, 24].map(bits => <button key={bits} aria-pressed={p.bits === bits} onClick={() => p.setBits(bits)}>{bits}-bit</button>)}</div></fieldset> : <fieldset className="option-field"><legend>Kualitas MP3</legend><div className="segmented">{[128, 192, 256, 320].map(bitrate => <button key={bitrate} aria-pressed={p.bitrate === bitrate} onClick={() => p.setBitrate(bitrate)}>{bitrate} kbps</button>)}</div></fieldset>}
    <CheckField checked={p.normalize} onChange={p.setNormalize}>Normalisasi peak ke −1 dBFS</CheckField>
    {summary ? <div className="export-result" role="status" aria-label="Ringkasan ekspor"><strong data-tooltip={filename}>{filename}</strong><span>{p.scope === 'project' ? 'Seluruh proyek' : p.scope === 'selected' ? 'Klip terpilih' : 'Rentang'} · {summary.clipCount} klip · {formatTime(summary.duration, true)}</span><span>{formatTime(summary.start, true)} → {formatTime(summary.end, true)} · {p.format.toUpperCase()} · ≈ {(bytes / 1048576).toFixed(2)} MB</span></div> : <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
