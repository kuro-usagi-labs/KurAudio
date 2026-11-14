import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type DragEvent } from 'react';
import { Plus, LockSimple, LockSimpleOpen, LinkSimple } from '@phosphor-icons/react';
import { type Clip, type Project, type Track, editor, makeClip, makeTrack, MAX_TRACKS, clamp, fitFades, trimClip, snapTime, endTime, formatTime } from './model';
import { Waveform } from './Waveform';
import { playback } from './audio';
import { CommitTextField } from './CommitTextField';
import { Fader } from './Fader';
import { HEADER_WIDTH, syncTimelineScroll, updateTimelinePlayhead } from './timelineViewport';
import { type AudioRange, MIN_CLIP, addCrossfades, crossfadeBounds } from './model';
import { RangeOverlay, CrossfadeOverlay, TimelineMarker, LoopBand, pointerGesture } from './TimelineOverlays';
import { ClipMenu, type ClipAction } from './ClipMenu';
import { expandedSelection, isClipLocked, moveClips, trimClipInProject, insertClips, type RippleScope } from './editing';
import { AutomationOverlay } from './AutomationOverlay';
import './timeline-tools.css';

export { HEADER_WIDTH } from './timelineViewport';
export const TRACK_HEIGHT = 116;
type Props = { project: Project; selected: string[]; range: AudioRange | null; activeTrack: string; scale: number; onScale: (scale: number) => void; playhead: number; snap: boolean; tool: 'move' | 'cut' | 'range' | 'gain'; onSeek: (t: number) => void; onSplit: (time?: number, id?: string) => void; onImport: (files: File[], trackId?: string | null, at?: number) => void; onTrack: (id: string) => void; onGesture: () => void; trackHeight?: number; onClipAction?: (action: ClipAction, clipId: string) => void; canPaste?: boolean; rippleScope?: RippleScope; onError?: (message: string) => void };
type ClipMenuState = { clipId: string; x: number; y: number; origin: HTMLElement };
export function Timeline(props: Props) {
  const { project, selected, scale, playhead, onSeek, onTrack } = props;
  const trackHeight = clamp(Number.isFinite(props.trackHeight) ? props.trackHeight! : TRACK_HEIGHT, 104, 240);
  const [menu, setMenu] = useState<ClipMenuState | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const openMenu = (clipId: string, x: number, y: number, origin: HTMLElement) => {
    const clip = project.clips.find(c => c.id === clipId); if (!clip) return;
    props.onGesture();
    if (!selected.includes(clipId)) editor.select(expandedSelection(project, [clipId]));
    onTrack(clip.trackId); setMenu({ clipId, x, y, origin });
  };
  const dismissMenu = (restoreFocus: boolean) => { setMenu(null); if (restoreFocus && menu?.origin.isConnected) menu.origin.focus({ preventScroll: true }); };
  useEffect(() => { if (menu && !project.clips.some(c => c.id === menu.clipId)) setMenu(null); }, [menu, project.clips]);
  const scroll = useRef<HTMLDivElement>(null);
  const rangeCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => rangeCleanup.current?.(), []);
  const [visible, setVisible] = useState({ left: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = scroll.current!;
    const update = () => {
      syncTimelineScroll(el);
      setVisible(previous => previous.left === el.scrollLeft && previous.width === el.clientWidth && previous.height === el.clientHeight ? previous : { left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
    };
    const observer = new ResizeObserver(update); observer.observe(el); el.addEventListener('scroll', update); update();
    const resetDrop = () => el.querySelector('.track-bottom')?.classList.remove('is-drop-target');
    window.addEventListener('dragend', resetDrop);
    return () => { observer.disconnect(); el.removeEventListener('scroll', update); window.removeEventListener('dragend', resetDrop); };
  }, []);
  useLayoutEffect(() => updateTimelinePlayhead(scroll.current, playhead, scale), [playhead, scale]);
  const anchor = useRef<{ time: number; x: number } | null>(null);
  useEffect(() => {
    const el = scroll.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (el.querySelector('.audio-clip.dragging,.audio-clip.is-fading,[data-timeline-gesture]')) return;
      const x = Math.max(HEADER_WIDTH, event.clientX - el.getBoundingClientRect().left);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
      const next = clamp(scale * Math.exp(-clamp(delta, -200, 200) * 0.003), 4, 960);
      anchor.current = { time: Math.max(0, (el.scrollLeft + x - HEADER_WIDTH) / scale), x };
      props.onScale(next);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, props.onScale]);
  useLayoutEffect(() => { if (anchor.current && scroll.current) { scroll.current.scrollLeft = HEADER_WIDTH + anchor.current.time * scale - anchor.current.x; anchor.current = null; } }, [scale]);
  const duration = Math.max(30, endTime(project) + 10, (project.loop?.end ?? 0) + 10, (project.markers ?? []).reduce((end, marker) => Math.max(end, marker.time + 10), 0)), width = Math.max(800, duration * scale);
  const spacing = scale > 180 ? 0.5 : scale > 80 ? 1 : scale > 35 ? 2 : scale > 15 ? 5 : 10;
  const firstTick = Math.max(0, Math.floor(visible.left / scale / spacing) - 1), lastTick = Math.min(Math.ceil(width / scale / spacing), Math.ceil((visible.left + visible.width) / scale / spacing) + 1);
  const xToTime = (e: { clientX: number }, el: HTMLElement) => Math.max(0, (e.clientX - el.getBoundingClientRect().left) / scale);
  const selectMarquee = (event: ReactPointerEvent<HTMLDivElement>, trackId: string) => {
    if (event.button !== 0 || props.tool !== 'move' || event.target !== event.currentTarget) return;
    onTrack(trackId);
    const content = event.currentTarget.closest<HTMLElement>('.timeline-content')!, previous = [...selected], additive = event.shiftKey;
    const point = (e: { clientX: number; clientY: number }) => { const bounds = content.getBoundingClientRect(); return { x: Math.max(HEADER_WIDTH, e.clientX - bounds.left), y: e.clientY - bounds.top }; };
    const start = point(event), clientX = event.clientX, clientY = event.clientY; let moved = false;
    if (!additive) editor.select([]);
    rangeCleanup.current = pointerGesture(event, ev => {
      if(!moved&&Math.abs(ev.clientX-clientX)+Math.abs(ev.clientY-clientY)>3){moved=true;props.onGesture();}
      if (!moved) return;
      const end = point(ev), box = { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
      setMarquee(box);
      const bounds = content.getBoundingClientRect(), ids = project.clips.filter(clip => {
        const lane = content.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(clip.trackId)}"]`)!, row = lane.getBoundingClientRect();
        return HEADER_WIDTH + (clip.start + clip.duration) * scale >= box.left && HEADER_WIDTH + clip.start * scale <= box.left + box.width && row.bottom - bounds.top >= box.top && row.top - bounds.top <= box.top + box.height;
      }).map(clip => clip.id);
      editor.select(expandedSelection(project, [...(additive ? previous : []), ...ids]));
    }, () => { setMarquee(null); rangeCleanup.current = undefined; if (!moved) onSeek((start.x - HEADER_WIDTH) / scale); }, () => { setMarquee(null); editor.select(previous); rangeCleanup.current = undefined; });
  };
  const selectRange = (event: ReactPointerEvent<HTMLDivElement>, trackId: string) => {
    if (event.button !== 0 || props.tool !== 'range' || (event.target as HTMLElement).closest('button')) return;
    props.onGesture(); onTrack(trackId); const lane = event.currentTarget, start = xToTime(event, lane), previous = props.range;
    const trackIds = event.shiftKey ? project.tracks.map(t => t.id) : [trackId];
    editor.setRange({ start, end: start + MIN_CLIP, trackIds });
    rangeCleanup.current = pointerGesture(event, ev => { const end = xToTime(ev, lane); editor.setRange({ start: Math.min(start, end), end: Math.max(Math.min(start, end) + MIN_CLIP, Math.max(start, end)), trackIds }); }, () => {}, () => editor.setRange(previous));
  };
  const seekRuler = (e: ReactPointerEvent<HTMLDivElement>) => {
    if(e.button!==0)return;
    const el=e.currentTarget,initial=playback.playing?playback.position:playhead;
    rangeCleanup.current?.();onSeek(xToTime(e,el));
    rangeCleanup.current=pointerGesture(e,ev=>onSeek(xToTime(ev,el)),()=>{rangeCleanup.current=undefined;},()=>{rangeCleanup.current=undefined;onSeek(initial);});
  };
  const drop = (e: DragEvent<HTMLDivElement>, track?: Track) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.classList.remove('is-drop-target');
    if (track?.locked) { props.onError?.('Buka kunci track sebelum menambahkan audio.'); return; }
    if (!track && project.tracks.length >= MAX_TRACKS) return;
    const lane = track ? e.currentTarget : e.currentTarget.querySelector<HTMLElement>('.new-track-lane')!;
    const time = xToTime(e, lane), assetId = e.dataTransfer.getData('application/kuraudio-asset');
    if (assetId) {
      const asset = project.assets.find(a => a.id === assetId); if (!asset) return;
      const destination = track ?? makeTrack(project.tracks.length);
      const clip = makeClip(asset, destination.id, props.snap ? snapTime(time, project, [], playhead, scale, asset.duration) : time);
      props.onGesture();
      let inserted: string[] = [];
      editor.edit(track ? 'Tambahkan audio' : 'Audio di track baru', p => { if (!track) p.tracks.push(destination); inserted = insertClips(p, [clip], clip.start, props.rippleScope); if (!inserted.length && !track) p.tracks = p.tracks.filter(t => t.id !== destination.id); });
      const actual = inserted.filter(id => editor.get().project.clips.some(c => c.id === id));
      if (!actual.length) { props.onError?.('Audio tidak ditempatkan. Ripple terlalu dekat dengan tepi klip, atau track/transisi terkunci.'); return; }
      editor.select(actual); onTrack(destination.id);
    } else if (e.dataTransfer.files.length) props.onImport(Array.from(e.dataTransfer.files), track?.id ?? null, time);
  };
  return <section className="timeline" aria-label="Timeline audio" data-tool={props.tool} style={{ '--layout-track': `${trackHeight / 16}rem` } as React.CSSProperties}>
    <div className="timeline-scroll" ref={scroll} data-testid="timeline-scroll">
      <div className="timeline-content" style={{ width: width + HEADER_WIDTH, minHeight: '100%' }}>
        <div className={`ruler-row ${project.loop ? 'with-loop' : ''} ${project.markers?.length ? 'with-markers' : ''}`}><div className="ruler-label"><span>Track</span><span>mm:ss</span></div>
          <div className="ruler" onPointerDown={seekRuler}><div className="ruler-seek" role="slider" aria-label="Posisi playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Number(playhead.toFixed(3))} aria-valuetext={formatTime(playhead, true)} tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onSeek(clamp(playhead + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 0.1), 0, duration)); } }}>
            {Array.from({ length: Math.max(0, lastTick - firstTick + 1) }, (_, index) => firstTick + index).map(i => <span className="tick" style={{ left: i * spacing * scale }} key={i}>{formatTime(i * spacing, spacing < 1)}<i /></span>)}
            </div>
            {project.loop && <LoopBand loop={project.loop} scale={scale} stop={props.onGesture}/>}
            {(project.markers ?? []).map(marker => <TimelineMarker key={marker.id} marker={marker} scale={scale} seek={onSeek} stop={props.onGesture}/>)}
          </div>
        </div>
        {project.tracks.map((track, index) => <div className="track-row" key={track.id} style={{ '--track-color': `var(--track-${track.color % 3})` } as React.CSSProperties}>
          <TrackHeader track={track} index={index} activeTrack={props.activeTrack} onTrack={onTrack}/>
          <div className={`track-lane ${track.muted || (project.tracks.some(t => t.solo) && !track.solo) ? 'is-muted' : ''} ${track.locked ? 'is-locked' : ''}`} data-track-id={track.id} data-testid={`lane-${index}`} style={{ backgroundSize: `${spacing * scale}px 100%` }} onPointerDownCapture={e => selectRange(e, track.id)} onPointerDown={e => { if (props.tool === 'move') selectMarquee(e, track.id); else if (e.target === e.currentTarget) { editor.select([]); onTrack(track.id); onSeek(xToTime(e, e.currentTarget)); } }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = track.locked ? 'none' : 'copy'; }} onDrop={e => drop(e, track)}>
            {project.clips.filter(c => c.trackId === track.id).map(c => <TimelineClip key={c.id} clip={c} {...props} scroll={scroll.current} openMenu={openMenu} />)}
            {(project.crossfades ?? []).filter(f => crossfadeBounds(project, f)?.trackId === track.id).map(f => <div className="timeline-overlay-host" key={f.id} inert={props.tool !== 'move' || project.clips.some(c => (c.id === f.leftId || c.id === f.rightId) && isClipLocked(project, c))}><CrossfadeOverlay fade={f} project={project} scale={scale} stop={props.onGesture}/></div>)}
            {props.range?.trackIds.includes(track.id) && <div className="timeline-overlay-host" inert={props.tool !== 'range' || track.locked}><RangeOverlay range={props.range} scale={scale} stop={props.onGesture}/></div>}
          </div>
        </div>)}
        <div className="track-bottom" data-testid="new-track-drop" onDragOver={e => {
          if (!Array.from(e.dataTransfer.types).some(type => type === 'application/kuraudio-asset' || type === 'Files')) return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = project.tracks.length < MAX_TRACKS ? 'copy' : 'none';
          e.currentTarget.classList.toggle('is-drop-target', project.tracks.length < MAX_TRACKS);
        }} onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('is-drop-target'); }} onDrop={e => drop(e)}>
          <div className="new-track-header"><button className="add-track" disabled={project.tracks.length >= MAX_TRACKS} onClick={() => { const track = makeTrack(project.tracks.length); editor.edit('Tambah track', p => { p.tracks.push(track); }); onTrack(track.id); }}><Plus size={14}/> Tambah track</button></div>
          <div className="new-track-lane"><span className="new-track-hint"><Plus size={14}/> Track baru</span></div>
        </div>
        {marquee && <div className="selection-marquee" style={marquee} aria-hidden="true"/>}
      </div>
    </div>
    <div className="playhead-viewport" aria-hidden="true" style={{ width: Math.max(0, visible.width - HEADER_WIDTH), height: visible.height }}>
      <div className="playhead" data-testid="playhead"><div className="playhead-cap"/><div className="playhead-line"/></div>
    </div>
    {menu && <ClipMenu key={menu.clipId} x={menu.x} y={menu.y} canJoin={selected.length >= 2} canPaste={props.canPaste ?? false} canGroup={selected.length >= 2} canUngroup={project.clips.some(c => selected.includes(c.id) && c.groupId)} locked={project.clips.some(c => selected.includes(c.id) && isClipLocked(project, c))} hasClipLocks={project.clips.some(c => selected.includes(c.id) && c.locked)} onDismiss={dismissMenu} onAction={action => {
      props.onGesture(); dismissMenu(true);
      if (props.onClipAction) props.onClipAction(action, menu.clipId);
      else if (action === 'split') props.onSplit(undefined, menu.clipId);
    }}/>}
  </section>;
}

function TrackHeader({track,index,activeTrack,onTrack}:{track:Track;index:number;activeTrack:string;onTrack:(id:string)=>void}) {
  const [gainDrafts,setGainDrafts]=useState<Record<string,number>>({});
  useEffect(()=>setGainDrafts({}),[track.gain]);
  return (<div className={`track-header ${track.muted ? 'is-muted' : ''} ${activeTrack === track.id ? 'active-track' : ''}`} onClick={() => onTrack(track.id)} data-tooltip={activeTrack === track.id ? 'Track tujuan penempatan audio' : 'Klik untuk memilih track tujuan'}>
            <div className="track-title"><span className="track-index">{String(index + 1).padStart(2, '0')}</span><CommitTextField aria-label={`Nama track ${index + 1}`} value={track.name} maxLength={160} fallback="Track" onCommit={value => editor.edit('Ubah nama track', p => { p.tracks[index].name = value; })} onFocus={() => onTrack(track.id)} /></div>
            <div className="track-actions"><button className={`tiny-button ${track.muted ? 'selected' : ''}`} data-tooltip="Mute track" aria-label={`Mute ${track.name}`} aria-pressed={track.muted} onClick={() => editor.edit('Mute track', p => { p.tracks[index].muted = !track.muted; })}><span aria-hidden="true">M</span></button>
              <button className={`tiny-button ${track.solo ? 'selected' : ''}`} data-tooltip="Solo track" aria-label={`Solo ${track.name}`} aria-pressed={track.solo} onClick={() => editor.edit('Solo track', p => { p.tracks[index].solo = !track.solo; })}><span aria-hidden="true">S</span></button>
              <button className={`tiny-button track-lock ${track.locked ? 'selected' : ''}`} aria-label={`${track.locked ? 'Buka kunci' : 'Kunci'} ${track.name}`} aria-pressed={!!track.locked} data-tooltip={track.locked ? 'Buka kunci track' : 'Kunci track'} onClick={() => editor.edit(track.locked ? 'Buka kunci track' : 'Kunci track', p => { p.tracks[index].locked = !track.locked; })}>{track.locked ? <LockSimple size={12}/> : <LockSimpleOpen size={12}/>}</button>
            </div>
            <div className="track-volume-row"><Fader label={`Volume ${track.name}`} value={(gainDrafts[track.id] ?? track.gain) <= 0 ? -60 : Math.round(20 * Math.log10(gainDrafts[track.id] ?? track.gain))} onChange={value => {const gain=value<=-60?0:Math.pow(10,value/20);setGainDrafts(d=>({...d,[track.id]:gain}));playback.previewTrackGain(track.id,gain);}} onCancel={()=>{setGainDrafts({});playback.previewTrackGain(track.id,track.gain);}} onCommit={value=>{setGainDrafts(d=>{const next={...d};delete next[track.id];return next;});editor.edit('Volume track',p=>{p.tracks.find(t=>t.id===track.id)!.gain=value<=-60?0:Math.pow(10,value/20);});}}/><span className="track-gain">{(gainDrafts[track.id] ?? track.gain) === 0 ? '−∞' : (20 * Math.log10(gainDrafts[track.id] ?? track.gain)).toFixed(0)} dB</span></div>
          </div>);
}

function TimelineClip(props: Props & { clip: Clip; scroll: HTMLDivElement | null; openMenu: (clipId: string, x: number, y: number, origin: HTMLElement) => void }) {
  const { clip, selected, project, scale, snap, playhead } = props;
  const element = useRef<HTMLDivElement>(null), chosen = selected.includes(clip.id);
  const groupIds = expandedSelection(project, [clip.id]), locked = project.clips.some(c => groupIds.includes(c.id) && isClipLocked(project, c));
  const gestureCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => gestureCleanup.current?.(), []);
  const fadeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => fadeCleanup.current?.(), []);
  useEffect(() => { gestureCleanup.current?.(); fadeCleanup.current?.(); }, [props.tool, scale, locked]);
  const [fadePreview, setFadePreview] = useState<Clip | null>(null);
  const [preview, setPreview] = useState<Clip | null>(null), [gesture, setGesture] = useState<'move' | 'trim' | null>(null), view = preview ?? fadePreview ?? clip;
  const fadeValue = (source: Clip, side: 'fadeIn' | 'fadeOut', value: number) => fitFades({ ...source, [side]: clamp(value, 0, source.duration - source[side === 'fadeIn' ? 'fadeOut' : 'fadeIn']), ...(side === 'fadeIn' ? { fadeInStart: undefined } : { fadeOutEnd: undefined }) });
  const commitFade = (side: 'fadeIn' | 'fadeOut', value: number) => editor.edit(side === 'fadeIn' ? 'Fade in' : 'Fade out', p => { p.clips = p.clips.map(c => c.id === clip.id ? fadeValue(c, side, value) : c); });
  const fadeDrag = (event: ReactPointerEvent<HTMLButtonElement>, side: 'fadeIn' | 'fadeOut') => {
    if (event.button !== 0 || props.tool !== 'move' || locked || gestureCleanup.current || fadeCleanup.current) return;
    event.preventDefault(); event.stopPropagation(); props.onGesture(); props.onTrack(clip.trackId);
    if (!chosen) editor.select(groupIds);
    const target = event.currentTarget, pointerId = event.pointerId, initialX = event.clientX, initialScroll = props.scroll?.scrollLeft ?? 0;
    let value = clip[side], finished = false;
    target.focus({ preventScroll: true }); target.setPointerCapture(pointerId); target.dataset.timelineGesture = 'true';
    setFadePreview(clip);
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - initialX + (props.scroll?.scrollLeft ?? 0) - initialScroll) / scale;
      const next = fadeValue(clip, side, clip[side] + (side === 'fadeIn' ? delta : -delta));
      value = next[side]; setFadePreview(next);
    };
    const cleanup = () => {
      delete target.dataset.timelineGesture;
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel);
      document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel); fadeCleanup.current = null;
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    };
    const finish = (ev?: PointerEvent, cancelled = false) => {
      if (finished) return; finished = true;
      if (ev && !cancelled) move(ev);
      cleanup(); setFadePreview(null);
      if (!cancelled && Math.abs(value - clip[side]) > 0.000001) commitFade(side, value);
    };
    const cancel = () => finish(undefined, true);
    const escape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); } };
    fadeCleanup.current = cancel;
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', cancel); target.addEventListener('lostpointercapture', cancel);
    document.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel);
  };
  function drag(e: ReactPointerEvent<HTMLDivElement>, side?: 'left' | 'right') {
    if (e.button !== 0 || gestureCleanup.current || fadeCleanup.current) return;
    e.stopPropagation(); e.preventDefault();
    if (props.tool === 'gain' || props.tool === 'range') { editor.select(groupIds); props.onTrack(clip.trackId); return; }
    if (props.tool === 'cut') { if (!locked) { const time = clip.start + (e.clientX - element.current!.getBoundingClientRect().left) / scale; props.onSplit(time, clip.id); } else editor.select(groupIds); return; }
    const target = element.current!, bounds = target.getBoundingClientRect();
    if (!side) {
      const hitWidth = (target.querySelector('.trim-handle')?.getBoundingClientRect().width ?? 0) + (locked ? 0 : 1);
      const left = e.clientX - bounds.left, right = bounds.right - e.clientX;
      if (Math.min(left, right) <= hitWidth) side = left <= right ? 'left' : 'right';
    }
    if (e.shiftKey && !side) { editor.select(chosen ? selected.filter(id => !groupIds.includes(id)) : [...selected, ...groupIds]); return; }
    const ids = [clip.id, ...expandedSelection(project, !side && chosen ? selected : groupIds).filter(id => id !== clip.id)]; editor.select(ids); props.onTrack(clip.trackId);
    if (locked || project.clips.some(c => ids.includes(c.id) && isClipLocked(project, c))) { target.focus({ preventScroll: true }); return; }
    const moving = project.clips.filter(c => ids.includes(c.id)), initialX = e.clientX, initialY = e.clientY, initialScroll = props.scroll?.scrollLeft || 0, initialTop = props.scroll?.scrollTop || 0;
    for (const animation of target.getAnimations()) if (animation instanceof CSSAnimation && animation.animationName === 'clip-arrive') animation.finish();
    target.focus({ preventScroll: true }); target.setPointerCapture(e.pointerId);
    let activated = false;
    const bottom = props.scroll?.querySelector<HTMLElement>('.track-bottom');
    let delta = 0, newTrack: string | null = clip.trackId;
    const originals = new Map(moving.map(c => [c.id, { c, el: props.scroll?.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(c.id)}"]`)! }]));
    const sourceDuration = project.assets.find(a => a.id === clip.assetId)!.duration;
    let pointer = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
    const apply = () => {
      const ev = pointer;
      if (!activated) {
        if (Math.hypot(ev.clientX - initialX, ev.clientY - initialY) < 4) return;
        activated = true; props.onGesture(); setGesture(side ? 'trim' : 'move');
        target.classList.add('dragging'); if (side) target.classList.add('trimming');
      }
      const raw = (ev.clientX - initialX + (props.scroll?.scrollLeft || 0) - initialScroll) / scale;
      if (side) {
        let edge = (side === 'left' ? clip.start : clip.start + clip.duration) + raw;
        if (snap && !ev.altKey) edge = snapTime(edge, project, ids, playhead, scale, 0, { grid: false, threshold: 4 });
        delta = edge - (side === 'left' ? clip.start : clip.start + clip.duration);
        const next = trimClip(clip, side, delta, sourceDuration);
        setPreview(next);
      } else {
        const minStart = Math.min(...moving.map(c => c.start));
        let start = clip.start + Math.max(-minStart, raw);
        if (snap && !ev.altKey) start = snapTime(start, project, ids, playhead, scale, clip.duration);
        delta = Math.max(-minStart, start - clip.start);
        const laneRects = Array.from(props.scroll!.querySelectorAll<HTMLElement>('.track-lane')).map(l => ({ id: l.dataset.trackId!, rect: l.getBoundingClientRect() }));
        const hovered = laneRects.find(l => ev.clientY >= l.rect.top && ev.clientY < l.rect.bottom);
        const bottomRect = bottom?.getBoundingClientRect(), viewport = props.scroll!.getBoundingClientRect();
        const anchorIndex = project.tracks.findIndex(t => t.id === clip.trackId), relative = moving.map(c => project.tracks.findIndex(t => t.id === c.trackId) - anchorIndex);
        const createTrack = project.tracks.length + Math.max(0, ...relative) < MAX_TRACKS && bottomRect && ev.clientY >= bottomRect.top && ev.clientY < Math.min(bottomRect.bottom, viewport.bottom) && ev.clientX >= viewport.left && ev.clientX < viewport.right;
        const proposed = createTrack ? project.tracks.length : hovered ? project.tracks.findIndex(t => t.id === hovered.id) : anchorIndex;
        const valid = relative.every(offset => proposed + offset >= 0 && proposed + offset < MAX_TRACKS && !project.tracks[proposed + offset]?.locked);
        newTrack = valid ? createTrack ? null : hovered?.id ?? clip.trackId : clip.trackId;
        bottom?.classList.toggle('is-drop-target', newTrack === null);
        const destinationTop = newTrack === null ? bottomRect!.top : laneRects.find(l => l.id === newTrack)!.rect.top;
        const dy = destinationTop - laneRects.find(l => l.id === clip.trackId)!.rect.top;
        for (const { c, el } of originals.values()) if (el) { el.style.left = `${(c.start + delta) * scale}px`; el.style.transform = `translateY(${dy}px)`; el.dispatchEvent(new Event('kuraudio:waveform-preview')); }
      }
    };
    const move = (event: PointerEvent) => { pointer = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey }; apply(); };
    let frame = 0, previousTime = performance.now();
    const autoscroll = (time: number) => {
      const elapsed = Math.min(0.04, (time - previousTime) / 1000); previousTime = time;
      if (activated && props.scroll && Math.abs(pointer.clientX - initialX) > 3) {
        const bounds = props.scroll.getBoundingClientRect(), left = bounds.left + HEADER_WIDTH + 4, right = bounds.left + props.scroll.clientWidth - 4;
        const distance = pointer.clientX < left ? pointer.clientX - left : pointer.clientX > right ? pointer.clientX - right : 0;
        const before = props.scroll.scrollLeft;
        if (distance) props.scroll.scrollLeft += Math.sign(distance) * Math.min(720, 120 + Math.abs(distance) * 10) * elapsed;
        if (props.scroll.scrollLeft !== before) apply();
      }
      if (activated && !side && props.scroll && Math.abs(pointer.clientY - initialY) > 3) {
        const bounds = props.scroll.getBoundingClientRect(), top = bounds.top + 40, bottom = bounds.top + props.scroll.clientHeight - 16;
        const distance = pointer.clientY < top ? pointer.clientY - top : pointer.clientY > bottom ? pointer.clientY - bottom : 0;
        const before = props.scroll.scrollTop;
        if (distance) props.scroll.scrollTop += Math.sign(distance) * Math.min(720, 120 + Math.abs(distance) * 10) * elapsed;
        if (props.scroll.scrollTop !== before) apply();
      }
      frame = requestAnimationFrame(autoscroll);
    };
    let finished = false;
    const cleanup = () => {
      cancelAnimationFrame(frame);
      bottom?.classList.remove('is-drop-target');
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel);
      document.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); gestureCleanup.current = null;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    };
    const finish = (ev?: PointerEvent, cancelled = false) => {
      if (finished) return; finished = true; cleanup();
      target.classList.remove('dragging', 'trimming'); setPreview(null); setGesture(null);
      if (!side) for (const { c, el } of originals.values()) if (el) { el.style.left = `${c.start * scale}px`; el.style.transform = ''; el.dispatchEvent(new Event('kuraudio:waveform-preview')); }
      if (cancelled) { if (props.scroll) { props.scroll.scrollLeft = initialScroll; props.scroll.scrollTop = initialTop; } return; }
      if (!activated) return;
      editor.edit(side ? 'Trim klip' : 'Geser klip', p => {
        if (side) trimClipInProject(p, clip.id, side, delta, sourceDuration, props.rippleScope);
        else {
          const destination = newTrack === null ? makeTrack(p.tracks.length) : null;
          if (destination) p.tracks.push(destination);
          moveClips(p, ids, delta, { ripple: props.rippleScope, destinationTrackId: destination?.id ?? newTrack! });
          addCrossfades(p, ids);
          props.onTrack(destination?.id ?? newTrack!);
        }
      });
    };
    const cancel = () => finish(undefined, true);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
    gestureCleanup.current = cancel;
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', cancel); target.addEventListener('lostpointercapture', cancel);
    document.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    frame = requestAnimationFrame(autoscroll);
  }
  return <div ref={element} className={`audio-clip ${chosen ? 'is-selected' : ''} ${locked ? 'is-locked' : ''} ${clip.groupId ? 'is-grouped' : ''} ${props.tool === 'cut' ? 'cut-tool' : ''} ${gesture ? 'dragging' : ''} ${gesture === 'trim' ? 'trimming' : ''} ${fadePreview ? 'is-fading' : ''}`} style={{ left: view.start * scale, width: Math.max(3, view.duration * scale) }} data-clip-id={clip.id} data-testid="audio-clip" role="group" tabIndex={0} aria-label={`${clip.name}, mulai ${formatTime(view.start, true)}, durasi ${formatTime(view.duration, true)}${chosen ? ', dipilih' : ''}${locked ? ', terkunci' : ''}${clip.groupId ? ', dalam grup' : ''}`} aria-haspopup="menu" onContextMenu={e => {
    e.preventDefault(); e.stopPropagation(); if (!gestureCleanup.current && !fadeCleanup.current) props.openMenu(clip.id, e.clientX, e.clientY, e.currentTarget);
  }} onPointerDown={e => drag(e)} onKeyDown={e => {
    if (gestureCleanup.current && e.key !== 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); props.openMenu(clip.id, Math.max(HEADER_WIDTH, rect.left + 18), rect.top + 26, e.currentTarget); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); props.onGesture(); editor.select(groupIds); }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && props.tool === 'move') { e.preventDefault(); e.stopPropagation(); if (locked) return; props.onGesture(); const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.01); editor.edit('Geser klip', p => moveClips(p, [clip.id, ...(chosen ? selected : groupIds).filter(id => id !== clip.id)], d, { ripple: props.rippleScope })); }
  }}>
    <div className="clip-title"><span>{clip.name}</span>{(locked || clip.groupId) && <i className="clip-status" aria-hidden="true">{locked && <LockSimple size={11}/>} {clip.groupId && <LinkSimple size={11}/>}</i>}<small>{formatTime(view.duration, !!preview)}</small></div>
    <div className="clip-waveform"><div className="waveform-source" style={{ left: -view.offset * scale, width: project.assets.find(asset => asset.id === clip.assetId)!.duration * scale }}>
      <Waveform assetId={clip.assetId} offset={view.offset} duration={view.duration} scale={scale}/>
    </div></div>
    {view.fadeIn > 0 && <div className="fade-overlay fade-in" style={{ width: Math.min(100, view.fadeIn / view.duration * 100) + '%' }}/>} {view.fadeOut > 0 && <div className="fade-overlay fade-out" style={{ width: Math.min(100, view.fadeOut / view.duration * 100) + '%' }}/>}
    {props.tool === 'move' && !locked && <div className="clip-fade-controls">{(['fadeIn', 'fadeOut'] as const).map(side => <button key={side} type="button" className={`fade-handle fade-handle-${side === 'fadeIn' ? 'in' : 'out'}`} role="slider" aria-label={`${side === 'fadeIn' ? 'Fade in' : 'Fade out'} ${clip.name}`} aria-valuemin={0} aria-valuemax={Number((view.duration - view[side === 'fadeIn' ? 'fadeOut' : 'fadeIn']).toFixed(3))} aria-valuenow={Number(view[side].toFixed(3))} aria-valuetext={`${view[side].toFixed(3)} detik`} data-tooltip={`${side === 'fadeIn' ? 'Fade in' : 'Fade out'} ${view[side].toFixed(2)} s · tarik untuk mengatur`} style={{ '--fade-position': `${view[side] * scale}px` } as React.CSSProperties} onPointerDown={e => fadeDrag(e, side)} onKeyDown={e => {
      if (fadeCleanup.current) { e.preventDefault(); e.stopPropagation(); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); props.onGesture();
        const value = e.key === 'Home' ? 0 : e.key === 'End' ? clip.duration : clip[side] + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01);
        commitFade(side, value);
      } else if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); }
    }}/>)}</div>}
    {(props.tool === 'gain' || clip.automation?.length) ? <AutomationOverlay clip={clip} scale={scale} active={props.tool === 'gain'} locked={locked} onGesture={props.onGesture} onSelect={() => { editor.select(groupIds); props.onTrack(clip.trackId); }}/> : null}
    {props.tool === 'move' && !locked && <><div className="trim-handle left" data-tooltip="Tarik untuk trim awal" onPointerDown={e => drag(e, 'left')}/><div className="trim-handle right" data-tooltip="Tarik untuk trim akhir" onPointerDown={e => drag(e, 'right')}/></>}
  </div>;
}
