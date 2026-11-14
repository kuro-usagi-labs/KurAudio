import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Flag, ArrowsHorizontal } from '@phosphor-icons/react';
import { type AudioRange, type Crossfade, type Marker, type Project, editor, clamp, crossfadeBounds, formatTime, MIN_CLIP, MAX_RENDER_SECONDS } from './model';
import { moveRange } from './editing';

export function pointerGesture(event: ReactPointerEvent<HTMLElement>, move: (event: PointerEvent) => void, finish: () => void, cancel: () => void = () => {}) {
  event.preventDefault(); event.stopPropagation(); const el = event.currentTarget; el.setPointerCapture(event.pointerId); el.dataset.timelineGesture = 'true';
  const cleanup = () => { delete el.dataset.timelineGesture; el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', abort); el.removeEventListener('lostpointercapture', abort); document.removeEventListener('keydown', escape); window.removeEventListener('blur', abort); if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId); };
  const up = (e: PointerEvent) => { move(e); cleanup(); finish(); };
  const abort = () => { cleanup(); cancel(); };
  const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); abort(); } };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', abort); el.addEventListener('lostpointercapture', abort); document.addEventListener('keydown', escape); window.addEventListener('blur', abort);
  return cleanup;
}
export function RangeOverlay({ range, scale, stop }: { range: AudioRange; scale: number; stop: () => void }) {
  const [delta, setDelta] = useState(0), cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  const commit = (amount: number) => {
    stop(); let ids: string[] = [];
    editor.edit('Geser rentang', p => { ids = moveRange(p, range, amount); });
    editor.select(ids); editor.setRange({ ...range, start: range.start + amount, end: range.end + amount }); setDelta(0);
  };
  return <div className="range-overlay" style={{ left: (range.start + delta) * scale, width: Math.max(1, (range.end - range.start) * scale) }} data-testid="range-overlay">
    <button className="range-move" aria-label="Geser rentang" data-tooltip="Tarik untuk memindahkan audio dalam rentang" onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); commit(Math.max(-range.start, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.01))); } }} onPointerDown={e => {
      stop(); const x = e.clientX, scroll = e.currentTarget.closest('.timeline-scroll')!, initial = scroll.scrollLeft; let amount = 0;
      cleanup.current = pointerGesture(e, ev => { amount = Math.max(-range.start, (ev.clientX - x + scroll.scrollLeft - initial) / scale); setDelta(amount); }, () => { if (Math.abs(amount) > 0.001) commit(amount); }, () => setDelta(0));
    }}><ArrowsHorizontal size={13}/></button>
  </div>;
}
export function CrossfadeOverlay({ fade, project, scale, stop }: { fade: Crossfade; project: Project; scale: number; stop: () => void }) {
  const [draft, setDraft] = useState<number | null>(null), cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  const bounds = crossfadeBounds(project, { ...fade, duration: draft ?? fade.duration }); if (!bounds) return null;
  const update = (duration: number) => editor.edit('Panjang crossfade', p => { const target = p.crossfades?.find(f => f.id === fade.id); if (target) target.duration = duration; });
  return <div className="crossfade-overlay" style={{ left: bounds.start * scale, width: bounds.duration * scale }} data-testid="crossfade">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0 Q70 0 100 100 M0 100 Q30 0 100 0"/></svg>
    <button className="crossfade-handle" role="slider" aria-label="Panjang crossfade" aria-valuemin={MIN_CLIP} aria-valuemax={bounds.overlap} aria-valuenow={Number(bounds.duration.toFixed(3))} aria-valuetext={`${bounds.duration.toFixed(3)} detik`} data-tooltip={`Crossfade ${bounds.duration.toFixed(2)} s · tarik untuk mengatur`} onDoubleClick={() => update(bounds.overlap)} onKeyDown={e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); stop(); const next = e.key === 'Home' ? MIN_CLIP : e.key === 'End' ? bounds.overlap : fade.duration + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01); update(clamp(next, MIN_CLIP, bounds.overlap)); }
      if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); editor.edit('Hapus crossfade', p => { p.crossfades = p.crossfades?.filter(f => f.id !== fade.id); }); }
    }} onPointerDown={e => {
      stop(); const x = e.clientX; let duration = fade.duration;
      cleanup.current = pointerGesture(e, ev => { duration = clamp(fade.duration - (ev.clientX - x) / scale, MIN_CLIP, bounds.overlap); setDraft(duration); }, () => { update(duration); setDraft(null); }, () => setDraft(null));
    }}/>
  </div>;
}
export function TimelineMarker({ marker, scale, seek, stop }: { marker: Marker; scale: number; seek: (time: number) => void; stop: () => void }) {
  const [draft, setDraft] = useState<number | null>(null), cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  return <button className="timeline-marker" style={{ left: (draft ?? marker.time) * scale }} aria-label={`Marker ${marker.name}`} data-tooltip={`${marker.name} · ${formatTime(draft ?? marker.time, true)}`} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); seek(marker.time); } }} onPointerDown={e => {
    stop(); const x = e.clientX; let time = marker.time, dragged = false;
    cleanup.current = pointerGesture(e, ev => { dragged ||= Math.abs(ev.clientX - x) > 3; time = Math.max(0, marker.time + (ev.clientX - x) / scale); if (dragged) setDraft(time); }, () => { if (dragged) editor.edit('Geser marker', p => { const target = p.markers?.find(m => m.id === marker.id); if (target) target.time = time; }); else seek(marker.time); setDraft(null); }, () => setDraft(null));
  }}><Flag size={13} weight="fill"/></button>;
}
export function LoopBand({ loop, scale, stop }: { loop: NonNullable<Project['loop']>; scale: number; stop: () => void }) {
  const [draft, setDraft] = useState<typeof loop | null>(null), value = draft ?? loop, cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  return <div className={`loop-band ${loop.enabled ? 'enabled' : ''}`} style={{ left: value.start * scale, width: (value.end - value.start) * scale }} aria-label="Batas loop">
    {(['start', 'end'] as const).map(side => <button key={side} className={`loop-handle ${side}`} aria-label={side === 'start' ? 'Awal loop' : 'Akhir loop'} data-tooltip={formatTime(value[side], true)} onPointerDown={e => {
      stop(); const x = e.clientX; let next = loop;
      cleanup.current = pointerGesture(e, ev => { const amount = (ev.clientX - x) / scale; next = { ...loop, [side]: side === 'start' ? clamp(loop.start + amount, Math.max(0, loop.end - MAX_RENDER_SECONDS), loop.end - MIN_CLIP) : clamp(loop.end + amount, loop.start + MIN_CLIP, loop.start + MAX_RENDER_SECONDS) }; setDraft(next); }, () => { editor.edit('Batas loop', p => { p.loop = next; }); setDraft(null); }, () => setDraft(null));
    }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); stop(); const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.01); editor.edit('Batas loop', p => { p.loop = { ...loop, [side]: side === 'start' ? clamp(loop.start + delta, Math.max(0, loop.end - MAX_RENDER_SECONDS), loop.end - MIN_CLIP) : clamp(loop.end + delta, loop.start + MIN_CLIP, loop.start + MAX_RENDER_SECONDS) }; }); } }}/>) }
  </div>;
}
