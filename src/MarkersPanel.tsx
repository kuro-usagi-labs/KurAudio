import { Flag, Trash } from '@phosphor-icons/react';
import { type Project, type AudioRange, editor, uid, endTime, MIN_CLIP, MAX_RENDER_SECONDS } from './model';
import { NumberField } from './Inspector';
export function MarkersPanel({ project, range, playhead, seek }: { project: Project; range: AudioRange | null; playhead: number; seek: (time: number) => void }) {
  const start = range?.start ?? 0;
  const loop = project.loop ?? { start, end: Math.min(start + MAX_RENDER_SECONDS, range?.end ?? Math.max(MIN_CLIP, endTime(project))), enabled: false };
  const update = (values: Partial<typeof loop>) => editor.edit('Atur loop', p => { p.loop = { ...loop, ...values }; });
  return <div className="session-section">
    <div className="session-heading"><h3>Loop</h3><button className={loop.enabled ? 'button selected' : 'button'} aria-pressed={loop.enabled} onClick={() => update({ enabled: !loop.enabled })}>Loop {loop.enabled ? 'aktif' : 'nonaktif'} <kbd>L</kbd></button></div>
    <div className="field-pair"><NumberField label="Mulai loop" value={loop.start} min={Math.max(0, loop.end - MAX_RENDER_SECONDS)} max={loop.end - MIN_CLIP} onCommit={start => update({ start })}/><NumberField label="Selesai loop" value={loop.end} min={loop.start + MIN_CLIP} max={loop.start + MAX_RENDER_SECONDS} onCommit={end => update({ end })}/></div>
    <button className="button" disabled={!range} onClick={() => range && update({ start: range.start, end: Math.min(range.end, range.start + MAX_RENDER_SECONDS) })}>Gunakan rentang terpilih</button>
    <div className="session-heading"><h3>Marker</h3><button className="button" disabled={(project.markers?.length ?? 0) >= 1024} onClick={() => editor.edit('Tambah marker', p => { (p.markers ??= []).push({ id: uid(), name: `Marker ${(p.markers?.length ?? 0) + 1}`, time: playhead }); })}><Flag size={14}/> Tambah di playhead</button></div>
    <div className="marker-list">{[...(project.markers ?? [])].sort((a, b) => a.time - b.time).map(marker => <div className="marker-row" key={marker.id}>
      <button className="icon-button" aria-label={`Ke marker ${marker.name}`} onClick={() => seek(marker.time)}><Flag size={15}/></button>
      <label className="field-label"><input aria-label={`Nama ${marker.name}`} value={marker.name} maxLength={80} onChange={e => editor.edit('Nama marker', p => { p.markers!.find(m => m.id === marker.id)!.name = e.target.value || 'Marker'; })}/></label>
      <NumberField label={`Waktu ${marker.name}`} value={marker.time} onCommit={time => editor.edit('Waktu marker', p => { p.markers!.find(m => m.id === marker.id)!.time = time; })}/>
      <button className="icon-button danger" aria-label={`Hapus marker ${marker.name}`} onClick={() => editor.edit('Hapus marker', p => { p.markers = p.markers!.filter(m => m.id !== marker.id); })}><Trash size={15}/></button>
    </div>)}</div>
  </div>;
}
