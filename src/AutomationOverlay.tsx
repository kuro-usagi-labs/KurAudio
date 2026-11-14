import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp, editor, type Clip, type GainPoint } from './model';
import './automation.css';

type Props = { clip: Clip; scale: number; active: boolean; locked: boolean; onGesture: () => void; onSelect: () => void };

/** Editable volume stays separate from envelopes baked by crossfade editing. */
export function AutomationOverlay({ clip, scale, active, locked, onGesture, onSelect }: Props) {
  const surface = useRef<HTMLDivElement>(null), cleanup = useRef<(() => void) | null>(null);
  const [draft, setDraft] = useState<GainPoint[] | null>(null), [cursor, setCursor] = useState({ time: clip.duration / 2, gain: 1 });
  const points = draft ?? clip.automation ?? [];
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => { cleanup.current?.(); setDraft(null); }, [active, locked, scale]);
  const commit = (next: GainPoint[], label = 'Volume automation') => {
    if (locked) return;
    editor.edit(label, p => { const target = p.clips.find(c => c.id === clip.id); if (target) target.automation = next; });
  };
  const add = (point: GainPoint) => {
    if (!active || locked) return;
    onGesture(); onSelect();
    const time = clamp(point.time, 0, clip.duration), next = [...(clip.automation ?? []).filter(p => Math.abs(p.time - time) > 1e-7), { time, gain: clamp(point.gain, 0, 2) }].sort((a, b) => a.time - b.time);
    commit(next, 'Tambah titik volume');
    const index = next.findIndex(p => p.time === time);
    requestAnimationFrame(() => surface.current?.querySelector<HTMLButtonElement>(`[data-point-index="${index}"]`)?.focus({ preventScroll: true }));
  };
  const pointAt = (event: { clientX: number; clientY: number }): GainPoint => {
    const box = surface.current!.getBoundingClientRect();
    return { time: clamp((event.clientX - box.left) / scale, 0, clip.duration), gain: clamp((1 - (event.clientY - box.top) / box.height) * 2, 0, 2) };
  };
  const drag = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (!active || locked || event.button !== 0 || cleanup.current) return;
    event.preventDefault(); event.stopPropagation(); onGesture(); onSelect();
    const target = event.currentTarget, initial = (clip.automation ?? []).map(p => ({ ...p })), first = initial[index], x = event.clientX, y = event.clientY;
    const scroll = target.closest('.timeline-scroll')!, initialScroll = scroll.scrollLeft, height = surface.current!.getBoundingClientRect().height;
    let next = initial, finished = false;
    target.focus({ preventScroll: true }); target.setPointerCapture(event.pointerId); target.dataset.timelineGesture = 'true';
    const move = (ev: PointerEvent) => {
      const left = index ? initial[index - 1].time + 1e-7 : 0, right = index < initial.length - 1 ? initial[index + 1].time - 1e-7 : clip.duration;
      next = initial.map((p, i) => i === index ? { time: clamp(first.time + (ev.clientX - x + scroll.scrollLeft - initialScroll) / scale, left, right), gain: clamp(first.gain - (ev.clientY - y) / height * 2, 0, 2) } : p);
      setDraft(next);
    };
    const finish = (ev?: PointerEvent, cancelled = false) => {
      if (finished) return; finished = true;
      if (ev && !cancelled) move(ev);
      release(); setDraft(null);
      if (!cancelled && JSON.stringify(next) !== JSON.stringify(initial)) commit(next, 'Geser titik volume');
    };
    const cancel = () => finish(undefined, true);
    const escape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); } };
    const release = () => {
      delete target.dataset.timelineGesture;
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel);
      document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel); cleanup.current = null;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    cleanup.current = cancel;
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', cancel); target.addEventListener('lostpointercapture', cancel);
    document.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel);
  };
  const line = points.length ? [{ time: 0, gain: points[0].gain }, ...points, { time: clip.duration, gain: points.at(-1)!.gain }] : [{ time: 0, gain: 1 }, { time: clip.duration, gain: 1 }];
  return <div ref={surface} className={`automation-overlay ${active ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`} role={active ? 'group' : undefined} tabIndex={active && !locked ? 0 : undefined} aria-label={active ? `Automation volume ${clip.name}, Enter tambah titik, panah geser kursor` : undefined} data-timeline-gesture={draft ? 'true' : undefined} onPointerDown={event => { if (active) { event.stopPropagation(); onSelect(); } }} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); add(pointAt(event)); }} onKeyDown={event => {
    if (event.target !== event.currentTarget || !active || locked) return;
    if (['Enter', 'Insert', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Insert') add(cursor);
      else setCursor(p => ({ time: event.key === 'Home' ? 0 : event.key === 'End' ? clip.duration : clamp(p.time + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * (event.shiftKey ? 0.1 : 0.01), 0, clip.duration), gain: clamp(p.gain + (event.key === 'ArrowUp' ? 0.05 : event.key === 'ArrowDown' ? -0.05 : 0), 0, 2) }));
    }
  }}>
    <svg className="automation-line" viewBox={`0 0 ${Math.max(0.001, clip.duration)} 2`} preserveAspectRatio="none" aria-hidden="true"><polyline points={line.map(p => `${p.time},${2 - p.gain}`).join(' ')}/></svg>
    {active && !locked && <span className="automation-cursor" style={{ left: cursor.time * scale, top: `${(1 - cursor.gain / 2) * 100}%` }} aria-hidden="true"/>}
    {active && !locked && points.map((point, index) => <button key={index} type="button" className="automation-point" data-point-index={index} style={{ left: `clamp(12px, ${point.time * scale}px, calc(100% - 12px))`, top: `clamp(12px, ${(1 - point.gain / 2) * 100}%, calc(100% - 12px))` }} role="slider" aria-label={`Volume titik ${index + 1} ${clip.name}`} aria-valuemin={0} aria-valuemax={2} aria-valuenow={Number(point.gain.toFixed(3))} aria-valuetext={`${point.time.toFixed(3)} detik, ${point.gain === 0 ? 'hening' : (20 * Math.log10(point.gain)).toFixed(1) + ' dB'}`} onPointerDown={event => drag(event, index)} onKeyDown={event => {
      if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); if (cleanup.current) return; onGesture();
      const next = (clip.automation ?? []).map(p => ({ ...p }));
      if (event.key === 'Delete' || event.key === 'Backspace') { next.splice(index, 1); commit(next, 'Hapus titik volume'); requestAnimationFrame(() => surface.current?.focus({ preventScroll: true })); return; }
      const min = index ? next[index - 1].time + 1e-7 : 0, max = index < next.length - 1 ? next[index + 1].time - 1e-7 : clip.duration;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') next[index].time = event.key === 'Home' ? min : event.key === 'End' ? max : clamp(point.time + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01), min, max);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') next[index].gain = clamp(point.gain + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01), 0, 2);
      commit(next, 'Ubah titik volume');
    }}/>)}
  </div>;
}
