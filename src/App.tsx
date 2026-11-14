import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type CSSProperties } from 'react';
import { Scissors, Magnet, ArrowCounterClockwise, ArrowClockwise, Play, Pause, Stop, SkipBack, SkipForward, Plus, Minus, Copy, Trash, LinkSimple, X, FileAudio, Check, Warning, Keyboard, CornersOut, FloppyDisk, ArrowDown, Cursor, MagnifyingGlass, ArrowUpRight, SidebarSimple, SlidersHorizontal, SplitHorizontal } from '@phosphor-icons/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { editor, emptyProject, makeClip, makeTrack, MAX_TRACKS, uid, endTime, formatTime, splitClip, deleteClips, renderEndTime, type Project, type Clip } from './model';
import { media, playback, renderProject, demoMedia, encodeWav, encodeFloatWav, putMedia, pcmBytes } from './audio';
import { autosave, clearRecovery, decodeRecovery, deserializeProject, desktop, download, importBytes, installMedia, pickAudio, pickProject, readRecovery, readProjectFile, saveProject, serializeProject, toBase64 } from './storage';
import { CommitTextField } from './CommitTextField';
import { commitActiveDraft } from './draftInput';
import { resolveShortcut, shortcutContext } from './shortcutPolicy';
import { Timeline, HEADER_WIDTH } from './Timeline';
import { updateTimelinePlayhead } from './timelineViewport';
import { Inspector } from './Inspector';
import { Modal } from './Modal';
import { Tooltip } from './Tooltip';
import { Presence } from './Presence';
import { HomeScreen } from './HomeScreen';
import { isolateRange, deleteRange, copyRange } from './editing';
import { addCrossfades, bakeCrossfades, MIN_CLIP } from './model';
import { NumberField } from './Inspector';
import { ExportSettings, type ExportScope, type ExportFormat } from './ExportSettings';
import { encodeMp3 } from './mp3';
import { MarkersPanel } from './MarkersPanel';
import { SilencePanel } from './SilencePanel';
import { RecordPanel } from './RecordPanel';
import { recorder, type RecordedAudio } from './recording';
import { Selection, Flag, Intersect, Repeat, Microphone } from '@phosphor-icons/react';
import { MediaPreview } from './MediaAudition';
import { mediaPreview } from './mediaPreview';
import { MediaItem } from './MediaItem';
import { PanelResizer, PlaybackReview, WorkspaceControls, RippleControls } from './ComfortControls';
import { loadWorkspace, saveWorkspace,defaultWorkspaceView,workspaceLayouts, type WorkspaceView } from './workspace';
import {loadAppPreferences,saveAppPreferences,type AppPreferences} from './appPreferences';
import {ApplicationSettings} from './ApplicationSettings';
import {Menubar,type AppMenu,type MenuEntry} from './Menubar';
import {version as appVersion} from '../package.json';
import { listRecentProjects, rememberRecentProject, readRecentProject, forgetRecentProject, type RecentProject } from './recentProjects';
import { resolveExportScope, exportFilename } from './exportScope';
import type { ClipAction } from './ClipMenu';
import {isClipLocked,isArrangementLocked,expandedSelection,groupClips,ungroupClips,setClipsLocked,insertClips,freshClipCopies,type RippleScope} from './editing';
import {nearestZeroCrossing,splitClipSafe} from './precision';
import {HistoryPanel} from './HistoryPanel';
import {createCheckpoint,listCheckpoints,readCheckpoint,deleteCheckpoint,type CheckpointSummary} from './checkpoints';
import {LoudnessPanel} from './LoudnessPanel';
import {BrandMark} from './BrandMark';
import {ClockCounterClockwise} from '@phosphor-icons/react';
import {watchAppearance} from './appearance';

function IconButton({ label, children, active, disabled, onClick, danger = false }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void; danger?: boolean }) {
  return <button className={`icon-button ${active ? 'selected' : ''} ${danger ? 'danger' : ''}`} aria-label={label} data-tooltip={label} aria-pressed={active === undefined ? undefined : active} disabled={disabled} onClick={onClick}>{children}</button>;
}
function focusPanelTrigger(panel: 'media' | 'properties') {
  requestAnimationFrame(() => Array.from(document.querySelectorAll<HTMLElement>(panel === 'properties' ? '.properties-toggle,.mobile-tabs button:last-child' : '.media-toggle,.mobile-tabs button:first-child')).find(el => el.getClientRects().length)?.focus());
}
export default function App() {
  const state = useSyncExternalStore(editor.subscribe, editor.get), { project, selected, range } = state;
  const [preferences,setPreferences]=useState(loadAppPreferences),[preferencesStatus,setPreferencesStatus]=useState('');
  const preferencesRef=useRef(preferences);preferencesRef.current=preferences;
  useLayoutEffect(()=>watchAppearance(preferences.appearance,()=>setPreferencesStatus('Tema diterapkan. Tampilan jendela belum dapat diperbarui.')),[preferences.appearance]);
  useEffect(()=>{document.documentElement.dataset.reduceMotion=String(preferences.motion==='reduced');},[preferences.motion]);
  useEffect(()=>{mediaPreview.setVolume(preferences.previewVolume);},[preferences.previewVolume]);
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventFileNavigation); window.addEventListener('drop', preventFileNavigation);
    return () => { window.removeEventListener('dragover', preventFileNavigation); window.removeEventListener('drop', preventFileNavigation); };
  }, []);
  useEffect(() => { if (screen === 'editor') document.querySelector<HTMLElement>('.main-editor h1')?.focus({ preventScroll: true }); }, [screen]);
  const [scale, setScale] = useState(48), [position, setPosition] = useState(0), [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [snap,setSnap]=useState(true),[rippleScope,setRippleScope]=useState<RippleScope>('off'),[tool,setTool]=useState<'move'|'cut'|'range'|'gain'>('move');
  const [libraryTab,setLibraryTab]=useState<'media'|'history'>('media'),[zeroCross,setZeroCross]=useState(false),[safeCuts,setSafeCuts]=useState(false);
  const [checkpoints,setCheckpoints]=useState<CheckpointSummary[]>([]),[checkpointBusy,setCheckpointBusy]=useState(false),[checkpointStatus,setCheckpointStatus]=useState('');
  const [activeTrack, setActiveTrack] = useState(project.tracks[0].id), [search, setSearch] = useState('');
  const targetTrack = project.tracks.find(track => track.id === activeTrack)?.id ?? project.tracks[0].id;
  const chosenClips=project.clips.filter(c=>selected.includes(c.id)),editableClips=chosenClips.filter(c=>!isArrangementLocked(project,c));
  const canModifySelection=!!chosenClips.length&&editableClips.length===chosenClips.length;
  const [modal, setModal] = useState<'help' | 'export' | 'unsaved' | 'recovery' | 'tools' | 'settings' | 'about' | null>(null), [busy, setBusy] = useState('');
  const [toolsTab,setToolsTab]=useState<'markers'|'silence'|'record'|'loudness'>('markers'),[analysisClips,setAnalysisClips]=useState<Clip[]>([]),[recording,setRecording]=useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav'), [exportScope, setExportScope] = useState<ExportScope>('project'), [exportName, setExportName] = useState(''), [bitrate, setBitrate] = useState(192);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null), [autosaveState, setAutosaveState] = useState('Pemulihan belum dibuat');
  const [savedStamp, setSavedStamp] = useState(JSON.stringify(project)), [projectPath, setProjectPath] = useState<string | null>(null);
  const [sampleRate, setSampleRate] = useState(48000), [bits, setBits] = useState(24), [normalize, setNormalize] = useState(true), [peakWarning, setPeakWarning] = useState(false);
  const [ready, setReady] = useState(false), [mobilePanel, setMobilePanel] = useState<'media' | 'properties' | null>(null);
  const [desktopWindow, setDesktopWindow] = useState(() => window.innerWidth >= 900);
  useEffect(() => { const query = window.matchMedia('(min-width: 900px)'); const changed = () => setDesktopWindow(query.matches); query.addEventListener('change', changed); return () => query.removeEventListener('change', changed); }, []); // ds-allow-hardcode: matches the CSS media breakpoint.
  const [wideWindow, setWideWindow] = useState(() => window.innerWidth >= 1200);
  useEffect(() => { const query = window.matchMedia('(min-width: 1200px)'); const changed = () => setWideWindow(query.matches); query.addEventListener('change', changed); return () => query.removeEventListener('change', changed); }, []); // ds-allow-hardcode: matches the CSS inspector breakpoint; media queries cannot use CSS variables.
  const [mediaOpen, setMediaOpen] = useState(true), [inspectorOpen, setInspectorOpen] = useState(false);
  const [autoInspector,setAutoInspector]=useState(true);
  const [sizes, setSizes] = useState({ mediaWidth: 224, inspectorWidth: 280, trackHeight: 116 }), [followPlayhead, setFollowPlayhead] = useState(true);
  const [resizing, setResizing] = useState(false), [restoring, setRestoring] = useState(false), [recentProjects, setRecentProjects] = useState<RecentProject[]>([]), [fileOrigin, setFileOrigin] = useState<'new' | 'opened' | 'saved' | 'downloaded'>('new');
  const hasSavedFile = fileOrigin !== 'new';
  const projectFile=useRef({path:projectPath,origin:fileOrigin});projectFile.current={path:projectPath,origin:fileOrigin};
  const playbackStart = useRef(0), follow = useRef(true); follow.current = followPlayhead;
  const scrollRestore = useRef<(WorkspaceView & { projectId: string }) | null>(null), persistView = useRef<() => void>(() => {});
  const mediaVisible = desktopWindow ? mediaOpen && (wideWindow || mobilePanel !== 'properties') : mobilePanel === 'media';
  useEffect(() => { if (autoInspector&&selected.length === 1 && window.innerWidth >= 1200) setInspectorOpen(true); }, [selected,autoInspector]);
  const scaleValue = useRef(scale); scaleValue.current = scale;
  const [clipboard, setClipboard] = useState<Clip[]>([]);
  const playhead = useRef(0), timeElement = useRef<HTMLOutputElement>(null), meter = useRef<HTMLDivElement>(null), peakLabel = useRef<HTMLSpanElement>(null);
  const audioInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null), pending = useRef<(() => void | Promise<void>) | null>(null);
  const recovery = useRef<Awaited<ReturnType<typeof readRecovery>>>(null), closing = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), operation = useRef(false);
  const restoreTicket=useRef(0);
  const recordedCommit = useRef<(data: RecordedAudio) => void>(() => {});
  const recordClosing = useRef(false);
  const projectStamp = JSON.stringify(project), dirty = projectStamp !== savedStamp;
  const latest = useRef({ project, dirty, savedStamp, busy, modal, ready, screen, panel: !wideWindow ? mobilePanel : null }); latest.current = { project, dirty, savedStamp, busy, modal, ready, screen, panel: !wideWindow ? mobilePanel : null };
  persistView.current = () => {
    if (screen !== 'editor' || restoring) return;
    const scroller = document.querySelector<HTMLElement>('.timeline-scroll');
    saveWorkspace(project.id,{scale,tool,mediaOpen,inspectorOpen,autoInspector,snap,followPlayhead,libraryTab,rippleScope,zeroCross,safeCuts,...sizes,scrollLeft:scroller?.scrollLeft??0,scrollTop:scroller?.scrollTop??0});
  };
  useEffect(() => {
    if (screen !== 'editor' || restoring) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => persistView.current(), 250); };
    const store = () => persistView.current(), scroller = document.querySelector('.timeline-scroll');
    schedule(); scroller?.addEventListener('scroll', schedule); window.addEventListener('pagehide', store);
    return () => { clearTimeout(timer); scroller?.removeEventListener('scroll', schedule); window.removeEventListener('pagehide', store); };
  },[screen,project.id,scale,tool,mediaOpen,inspectorOpen,followPlayhead,sizes,restoring,libraryTab,rippleScope,zeroCross,safeCuts,snap,autoInspector]);
  useLayoutEffect(() => {
    if (screen !== 'editor' || scrollRestore.current?.projectId !== project.id) return;
    const frame = requestAnimationFrame(() => {
      const saved = scrollRestore.current, scroller = document.querySelector<HTMLElement>('.timeline-scroll');
      if (saved?.projectId !== project.id || !scroller) return;
      scroller.scrollLeft = saved.scrollLeft; scroller.scrollTop = saved.scrollTop;
      updateTimelinePlayhead(scroller, playhead.current, scaleValue.current);
      scrollRestore.current = null; setRestoring(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [screen, project.id, scale, sizes]);
  const refreshRecents = useCallback(() => { void listRecentProjects().then(setRecentProjects); }, []);
  useEffect(refreshRecents, [refreshRecents]);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const refreshCheckpoints=useCallback(()=>{const id=editor.get().project.id;void listCheckpoints(id).then(entries=>{if(editor.get().project.id===id)setCheckpoints(entries);}).catch(()=>{if(editor.get().project.id===id)setCheckpointStatus('Cadangan lokal tidak dapat dibaca.');});},[]);
  const checkpoint=useCallback((snapshot:Project,reason:string,manual=false)=>{
    if(manual)setCheckpointBusy(true);
    return createCheckpoint(snapshot,reason).then(()=>{if(editor.get().project.id===snapshot.id){setCheckpointStatus('Cadangan versi tersimpan');refreshCheckpoints();}if(manual)notify('Cadangan versi dibuat.');}).catch(error=>{if(editor.get().project.id===snapshot.id)setCheckpointStatus('Cadangan gagal. Simpan berkas .kura.');if(manual)notify(String(error),true);}).finally(()=>{if(manual)setCheckpointBusy(false);});
  },[notify,refreshCheckpoints]);
  useEffect(()=>{setCheckpoints([]);setCheckpointStatus('');if(screen==='editor')refreshCheckpoints();},[project.id,screen,refreshCheckpoints]);
  useEffect(()=>{if(screen!=='editor'||!dirty||!project.assets.length||!preferences.automaticCheckpoints)return;const timer=setTimeout(()=>void checkpoint(project,'Otomatis'),preferences.checkpointSeconds*1000);return()=>clearTimeout(timer);},[screen,project,dirty,checkpoint,preferences.automaticCheckpoints,preferences.checkpointSeconds]);
  const playIntent=useRef(false),transportRequest=useRef(0),seekTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const playbackScope=useRef<{source:Project;until?:number}|null>(null);
  const startPlaybackRef=useRef<(source:Project,from:number,until?:number)=>Promise<void>>(async()=>{});
  const stop = useCallback(() => { playIntent.current=false;transportRequest.current++;if(seekTimer.current)clearTimeout(seekTimer.current);seekTimer.current=null;setPreparing(false);mediaPreview.pause(); const t = playback.playing ? playback.stop() : playhead.current; playback.stop(); setPlaying(false); playhead.current = t; setPosition(t); if (meter.current) meter.current.style.width = '0%'; }, []);
  const seek = useCallback((t: number) => {
    mediaPreview.pause();
    const resume=playIntent.current||playback.playing;transportRequest.current++;if(seekTimer.current)clearTimeout(seekTimer.current);
    playback.stop(); setPlaying(resume); t = Math.max(0, t); playhead.current = t; setPosition(t);
    if(resume){playIntent.current=true;setPreparing(true);const target=t;seekTimer.current=setTimeout(()=>{seekTimer.current=null;if(!playIntent.current)return;const p=editor.get().project,scope=playbackScope.current;const source=scope?.until!==undefined?{...scope.source,tracks:p.tracks,clips:scope.source.clips.map(c=>{const next=p.clips.find(n=>n.id===c.id);return next?{...c,effects:next.effects,loudnessGain:next.loudnessGain}:c;})}:p;void startPlaybackRef.current(source,target,scope?.until);},40);}
    if (timeElement.current) timeElement.current.textContent = formatTime(t, true);
    updateTimelinePlayhead(document.querySelector<HTMLElement>('.timeline-scroll'), t, scaleValue.current, true);
    if (meter.current) meter.current.style.width = '0%';
  }, []);
  const startPlayback = useCallback(async (source: Project, from: number, until?: number) => {
    mediaPreview.pause();
    if (!endTime(source)) { notify('Tambahkan audio ke timeline terlebih dahulu.'); return; }
    const duration = Math.min(until ?? Infinity, renderEndTime(source));
    const anchor = until === undefined && source.loop?.enabled && (from < source.loop.start || from >= source.loop.end)
      ? source.loop.start : from >= duration ? 0 : Math.max(0, from);
    const ticket=++transportRequest.current;playIntent.current=true;playbackScope.current={source,until};setPlaying(true);setPreparing(true);
    try {
      await playback.play(source, from, (t, peak) => {
        playhead.current = t;
        if (timeElement.current) timeElement.current.textContent = formatTime(t, true);
        updateTimelinePlayhead(document.querySelector<HTMLElement>('.timeline-scroll'), t, scaleValue.current, follow.current);
        if (meter.current) { meter.current.style.width = `${Math.min(100, peak * 100)}%`; meter.current.dataset.clipping = String(peak > 1); }
        if (peakLabel.current) peakLabel.current.textContent = peak > 0.0001 ? `${(20 * Math.log10(peak)).toFixed(1)} dB` : '−∞ dB';
      }, () => { if(ticket!==transportRequest.current)return;playIntent.current=false;setPlaying(false); setPosition(playhead.current); if (meter.current) meter.current.style.width = '0%'; }, until);
      if(ticket!==transportRequest.current)return;
      playIntent.current=playback.playing;if (playback.playing) playbackStart.current = anchor;
      setPlaying(playback.playing);
    } catch (e) { if(ticket===transportRequest.current){playIntent.current=false;setPlaying(false);notify(String(e), true);} } finally { if(ticket===transportRequest.current)setPreparing(false); }
  }, [notify]);
  startPlaybackRef.current=startPlayback;
  const togglePlay = useCallback(async () => { if (playIntent.current || playback.playing) { stop(); return; } await startPlayback(editor.get().project, playhead.current); }, [startPlayback, stop]);
  const reviewSelection = () => {
    const snapshot = editor.get();
    try { const scoped = resolveExportScope(snapshot.project, snapshot.selected, snapshot.range, snapshot.range ? 'range' : 'selected'); stop(); seek(scoped.start); const source = scoped.range ? { ...scoped.project, clips: scoped.project.clips.filter(c => scoped.range!.trackIds.includes(c.trackId)) } : scoped.project; void startPlayback(source, scoped.start, scoped.end); }
    catch (e) { notify(e instanceof Error ? e.message : String(e)); }
  };
  const reviewAround = () => { const p = editor.get().project, cursor = Math.min(renderEndTime(p), Math.max(0, playhead.current)), start = Math.max(0, cursor - 1), end = Math.min(renderEndTime(p), cursor + 1); stop(); seek(start); void startPlayback(p, start, end); };
  const returnToPlayback = () => { stop(); seek(playbackStart.current); };
  const previewAsset = (id: string) => { if (mediaPreview.get().assetId === id && mediaPreview.get().playing) mediaPreview.pause(); else { stop(); void mediaPreview.play(id).catch(e => notify(String(e), true)); } };
  const previousProject = useRef(project);
  useEffect(() => {
    const previous = previousProject.current; previousProject.current = project;
    const shape = (p: Project) => JSON.stringify({sampleRate:p.sampleRate,loop:p.loop,crossfades:p.crossfades,tracks:p.tracks.map(t=>t.id),clips:p.clips.map(({effects:_effects,loudnessGain:_loudness,name:_name,locked:_locked,groupId:_group,...clip})=>clip)});
    if(previous===project)return;
    if(shape(previous)!==shape(project)){stop();return;}
    playback.updateMix(project);
    const effects=(p:Project)=>JSON.stringify(p.clips.map(c=>[c.effects,c.loudnessGain]));
    if(effects(previous)!==effects(project)){
      if(playback.playing){const ticket=transportRequest.current;setPreparing(true);void playback.updateEffects(project).catch(e=>notify(String(e),true)).finally(()=>{if(ticket===transportRequest.current)setPreparing(false);});}
      else if(playIntent.current){const scope=playbackScope.current;const source=scope?.until!==undefined?{...scope.source,tracks:project.tracks,clips:scope.source.clips.map(c=>{const updated=project.clips.find(next=>next.id===c.id);return updated?{...c,effects:updated.effects,loudnessGain:updated.loudnessGain}:c;})}:project;void startPlaybackRef.current(source,playhead.current,scope?.until);}
    }
  }, [project, stop, notify]);
  useEffect(() => { if (timeElement.current) timeElement.current.textContent = formatTime(position, true); }, [position]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (modal) setToast(t => t?.error ? t : null); }, [modal]);
  useEffect(() => {
    let alive = true;
    readRecovery().then(value => { if (!alive) return; if (value && (value.project.assets.length || value.project.clips.length)) { recovery.current = value; setModal('recovery'); } else setReady(true); }).catch(() => { if (alive) { setReady(true); notify('Pemulihan otomatis tidak tersedia di perangkat ini.', true); } });
    return () => { alive = false; };
  }, [notify]);
  useEffect(() => {
    if (!ready || screen !== 'editor' || modal === 'recovery' || closing.current) return;
    setAutosaveState('Menyimpan pemulihan…');
    const timer = setTimeout(() => { if (closing.current) return; autosave(project, dirty).then(() => setAutosaveState('Pemulihan tersimpan')).catch(() => { setAutosaveState('Pemulihan gagal'); notify('Pemulihan otomatis gagal. Simpan proyek dengan Ctrl+S.', true); }); }, 900);
    autosaveTimer.current = timer;
    return () => { clearTimeout(timer); if (autosaveTimer.current === timer) autosaveTimer.current = null; };
  }, [project, dirty, ready, screen, modal, notify]);
  useEffect(() => {
    if (!desktop) return;
    getCurrentWindow().setTitle(screen === 'home' ? 'KurAudio' : `${dirty ? '• ' : ''}${project.name} | KurAudio`).catch(() => {});
  }, [project.name, dirty, screen]);
  const finishClose = useCallback(async () => {
    if (closing.current) return;
    persistView.current(); closing.current = true; stop(); mediaPreview.clear(); recorder.cancel();
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      // An acknowledged discard must not return as crash recovery on next launch.
      // Storage failure must never make the window impossible to close.
      if (latest.current.ready) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([clearRecovery(latest.current.project.id).catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
        clearTimeout(timer);
      }
      await getCurrentWindow().destroy();
    } catch (error) {
      closing.current = false;
      if (latest.current.ready) void autosave(latest.current.project, latest.current.dirty).catch(() => {});
      notify(`Gagal menutup aplikasi: ${error}. Coba tutup kembali.`, true);
    }
  }, [notify, stop]);
  useEffect(() => {
    if (desktop) return;
    const before = (e: BeforeUnloadEvent) => { if (!commitActiveDraft() || JSON.stringify(editor.get().project)!==latest.current.savedStamp) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let cleanup: (() => void) | undefined, cancelled = false;
    getCurrentWindow().onCloseRequested(async e => {
      e.preventDefault();
      if (closing.current) return;
      if (operation.current || latest.current.busy) { notify('Tunggu proses saat ini selesai.'); return; }
      if (recorder.hasPending) {
        if (recordClosing.current) return;
        recordClosing.current = true;
        try { const data = await recorder.finish(); if (data) recordedCommit.current(data); setRecording(false); pending.current = finishClose; setModal('unsaved'); }
        catch (error) { notify(`Rekaman gagal diselesaikan: ${error}`, true); }
        finally { recordClosing.current = false; }
        return;
      }
      if(!commitActiveDraft())return;
      if (JSON.stringify(editor.get().project)!==latest.current.savedStamp) { pending.current = finishClose; setModal('unsaved'); }
      else void finishClose();
    }).then(fn => { if (cancelled) fn(); else cleanup = fn; }).catch(error => notify(`Pengaman tutup aplikasi gagal: ${error}`, true));
    return () => { cancelled = true; cleanup?.(); };
  }, [notify, finishClose]);
  const guarded = (action: () => void | Promise<void>) => { if (busy || operation.current || !commitActiveDraft()) return; if (JSON.stringify(editor.get().project)!==latest.current.savedStamp) { pending.current = action; setModal('unsaved'); } else void action(); };
  const saveCurrent = async (as = false) => {
    if (operation.current || !commitActiveDraft()) return false; operation.current = true;
    stop(); setBusy('Menyimpan proyek…');
    const snapshot = editor.get().project;
    try {
      persistView.current(); const content = desktop ? undefined : serializeProject(snapshot);
      const path = await saveProject(snapshot, projectPath, as, content); if (!path) return false;
      projectFile.current={path:path==='browser'?null:path,origin:path==='browser'?'downloaded':'saved'};setProjectPath(projectFile.current.path); setSavedStamp(JSON.stringify(snapshot)); setFileOrigin(projectFile.current.origin);
      void checkpoint(snapshot,'Simpan proyek');
      void rememberRecentProject({ id: snapshot.id, name: snapshot.name, path: path === 'browser' ? null : path, content }).then(refreshRecents);
      notify(desktop ? 'Proyek disimpan.' : 'Berkas proyek diunduh.'); return true;
    }
    catch (e) { notify(`Gagal menyimpan: ${e}`, true); return false; } finally { operation.current = false; setBusy(''); }
  };
  const applyProject = (p: Project, decoded?: Parameters<typeof installMedia>[0], path: string | null = null, fromFile = false) => {
    if(latest.current.screen==='editor'&&latest.current.dirty&&editor.get().project.assets.length)void checkpoint(editor.get().project,'Sebelum menutup');
    restoreTicket.current++;persistView.current(); const defaults=preferencesRef.current,view = loadWorkspace(p.id,{snap:defaults.snap,zeroCross:defaults.zeroCross,safeCuts:defaults.safeCuts,followPlayhead:defaults.followPlayhead}); scrollRestore.current = { ...view, projectId: p.id }; setRestoring(true);
    stop(); mediaPreview.clear(); if (decoded) installMedia(decoded); else media.clear(); editor.load(p); setProjectPath(path); setFileOrigin(fromFile ? 'opened' : 'new'); setSavedStamp(JSON.stringify(p)); setActiveTrack(p.tracks[0].id); playbackStart.current = 0; seek(0); setSearch('');
    setNormalize(!p.clips.some(c=>c.loudnessGain!==undefined));setClipboard([]);setScale(view.scale);setTool(view.tool);setMediaOpen(view.mediaOpen);setInspectorOpen(view.inspectorOpen);setAutoInspector(view.autoInspector??true);setSnap(view.snap??true);setFollowPlayhead(view.followPlayhead);setLibraryTab(view.libraryTab??'media');setRippleScope(view.rippleScope??'off');setZeroCross(view.zeroCross??false);setSafeCuts(view.safeCuts??false);setSizes({mediaWidth:view.mediaWidth,inspectorWidth:view.inspectorWidth,trackHeight:view.trackHeight});setMobilePanel(null);setScreen('editor');
  };
  const newProject = () => guarded(() => applyProject(emptyProject()));
  const goHome = () => guarded(async () => {
    if (operation.current) return;
    operation.current = true; stop(); setBusy('Menutup proyek…');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try { await clearRecovery(editor.get().project.id); applyProject(emptyProject()); setScreen('home'); }
    catch (e) { notify(`Gagal menutup proyek: ${e}`, true); }
    finally { operation.current = false; setBusy(''); }
  });
  const openContent = async (content: string, path: string | null) => {
    setBusy('Membuka proyek dan audio…');
    try { const { project: p, decoded } = await deserializeProject(content); applyProject(p, decoded, path, true); void rememberRecentProject({ id: p.id, name: p.name, path, content: path ? undefined : content }).then(refreshRecents); notify('Proyek dibuka.'); }
    catch (e) { notify(`Gagal membuka: ${e}`, true); } finally { setBusy(''); }
  };
  const readAndOpenProject = async (file: File) => {
    if (operation.current) return; operation.current = true; setBusy('Membaca proyek…');
    try { await openContent(await readProjectFile(file), null); } catch (e) { notify(String(e), true); } finally { operation.current = false; setBusy(''); }
  };
  const openProject = async () => {
    if (operation.current) return;
    if (!desktop) { projectInput.current?.click(); return; }
    operation.current = true; setBusy('Pilih proyek…');
    try { const doc = await pickProject(); if (doc) await openContent(doc.content, doc.path); }
    catch (e) { notify(String(e), true); } finally { operation.current = false; setBusy(''); }
  };
  const openRecent = (entry: RecentProject) => guarded(async () => {
    if (operation.current) return; operation.current = true; stop(); setBusy('Membuka proyek terakhir…');
    try {
      const saved = await readRecentProject(entry.id); if (!saved) throw new Error('Proyek tidak tersedia di daftar terakhir. Buka kembali dari berkas.');
      if (saved.entry.path && !desktop) throw new Error('Buka berkas proyek ini dari aplikasi desktop.');
      const content = saved.entry.path ? await invoke<string>('read_project', { path: saved.entry.path }) : saved.content;
      if (!content) throw new Error('Salinan proyek tidak tersedia. Buka kembali dari berkas.');
      await openContent(content, saved.entry.path);
    } catch (e) { notify(`Proyek tidak dapat dibuka: ${e}. Gunakan Buka dari berkas jika lokasinya berubah.`, true); }
    finally { operation.current = false; setBusy(''); }
  });
  const addImports = async (files: { name: string; bytes: Uint8Array }[], trackId?: string | null, at = playhead.current) => {
    if (!files.length) return;
    stop(); setBusy('Membaca audio…');
    const added: { asset: Awaited<ReturnType<typeof importBytes>>; clip?: Clip }[] = [], errors: string[] = [];
    let start = at;
    try {
      const current = editor.get().project;
      if (trackId === null && current.tracks.length >= MAX_TRACKS) throw new Error('Batas 128 track telah tercapai.');
      const track = trackId === null ? makeTrack(current.tracks.length) : current.tracks.find(t => t.id === trackId) ?? current.tracks[0];
      if(trackId!==undefined&&track.locked)throw new Error('Track terkunci. Buka kuncinya atau pilih track lain.');
      for (const file of files) {
        setBusy(`Membaca ${file.name}…`);
        try { const asset = await importBytes(file.bytes, file.name); const clip = trackId !== undefined ? makeClip(asset, track.id, start) : undefined; if (clip) start += asset.duration; added.push({ asset, clip }); }
        catch (e) { errors.push(`${file.name}: ${e}`); }
      }
      if(added.length){
        editor.edit('Impor audio',p=>{if(trackId===null)p.tracks.push(track);p.assets.push(...added.map(entry=>entry.asset));const clips=added.flatMap(entry=>entry.clip?[entry.clip]:[]);if(clips.length)insertClips(p,clips,at,rippleScope);});
        const inserted=added.flatMap(entry=>entry.clip&&editor.get().project.clips.some(c=>c.id===entry.clip!.id)?[entry.clip.id]:[]);
        setSearch('');setLibraryTab('media');if(inserted.length){editor.select(inserted);setActiveTrack(track.id);setMobilePanel(null);}else{setMediaOpen(true);setMobilePanel(window.innerWidth<900?'media':null);}notify(`${added.length} audio ditambahkan ke ${inserted.length?'timeline':'media'}.${trackId!==undefined&&!inserted.length?' Ripple terlalu dekat dengan tepi klip.':''}`);
      }
      if (errors.length) notify(errors.join('\n'), true);
    } finally { setBusy(''); }
  };
  const importFiles = async (files: File[], trackId?: string | null, at?: number) => {
    if (!files.length || busy || operation.current || latest.current.modal || !latest.current.ready) return;
    const projectFile = files.find(f => f.name.toLowerCase().endsWith('.kura'));
    if (projectFile) {
      guarded(() => readAndOpenProject(projectFile)); return;
    }
    if (latest.current.screen === 'home') {
      operation.current = true; setBusy('Membaca audio…');
      // Decode into an isolated collection. A rejected drop must not replace a session.
      const staged = new Map<string, NonNullable<ReturnType<typeof media.get>>>();
      const assets: Project['assets'] = [], errors: string[] = [];
      try {
        for (const file of files) {
          setBusy(`Membaca ${file.name}…`);
          try {
            if (assets.length >= 1000) throw new Error('Batas 1000 media telah tercapai.');
            if (file.size > 100 * 1024 * 1024) throw new Error('Batas ukuran per berkas adalah 100 MB.');
            assets.push(await importBytes(new Uint8Array(await file.arrayBuffer()), file.name, staged));
          } catch (e) { errors.push(`${file.name}: ${e}`); }
        }
        if (assets.length) {
          applyProject(emptyProject(), staged);
          editor.edit('Impor audio', p => {
            p.assets.push(...assets); let cursor = 0;
            for (const asset of assets) { p.clips.push(makeClip(asset, p.tracks[0].id, cursor)); cursor += asset.duration; }
          });
          editor.select(editor.get().project.clips.map(clip => clip.id));
          setMediaOpen(true); setLibraryTab('media'); setMobilePanel(null);
          if (!errors.length) notify(`${assets.length} audio ditambahkan ke timeline.`);
        }
        if (errors.length) notify(errors.join('\n'), true);
      } finally { operation.current = false; setBusy(''); }
      return;
    }
    operation.current = true; stop(); setBusy('Membaca audio…');
    try {
      for (const file of files) if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name}: batas ukuran 100 MB.`);
      await addImports(await Promise.all(files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))), trackId, at);
    } catch (e) { notify(String(e), true); } finally { operation.current = false; setBusy(''); }
  };
  const importAudio = async () => {
    if (operation.current) return;
    if (!desktop) { audioInput.current?.click(); return; }
    operation.current = true; stop(); setBusy('Pilih audio…');
    try { const files = await pickAudio(); if (files) await addImports(files); } catch (e) { notify(String(e), true); } finally { operation.current = false; setBusy(''); }
  };
  const insertAsset = (asset: Project['assets'][number]) => {
    if(project.tracks.find(t=>t.id===targetTrack)?.locked){notify('Track terkunci. Pilih track lain.');return;}
    const origin = document.activeElement, clip = makeClip(asset, targetTrack, playhead.current);
    editor.edit('Tambah audio',p=>{insertClips(p,[clip],clip.start,rippleScope);});if(!editor.get().project.clips.some(c=>c.id===clip.id)){notify('Ripple terlalu dekat dengan tepi klip. Geser playhead atau matikan ripple.');return;}editor.select([clip.id]);setActiveTrack(targetTrack);setMobilePanel(null);
    requestAnimationFrame(() => {
      if (latest.current.modal || latest.current.screen !== 'editor' || document.activeElement !== origin && document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(`[data-clip-id="${clip.id}"]`)?.focus({ preventScroll: true });
    });
  };
  const split = (time = playhead.current, id?: string) => {
    if (playback.playing) { stop(); time = id ? time : playhead.current; }
    const current=editor.get(),candidates=current.project.clips.filter(c=>(id?c.id===id:!current.selected.length||current.selected.includes(c.id))&&!isClipLocked(current.project,c)&&time>c.start+MIN_CLIP&&time<c.start+c.duration-MIN_CLIP);
    if(zeroCross&&candidates.length===1){const c=candidates[0],buffer=media.get(c.assetId)?.buffer;if(buffer){time=Math.max(c.start+MIN_CLIP,Math.min(c.start+c.duration-MIN_CLIP,c.start+nearestZeroCrossing(Array.from({length:buffer.numberOfChannels},(_,ch)=>buffer.getChannelData(ch)),buffer.sampleRate,c.offset+time-c.start)-c.offset));seek(time);}}
    let count = 0;
    const ids=candidates.map(c=>c.id),before=editor.get().revision;
    editor.edit('Potong klip',p=>{bakeCrossfades(p,ids);p.clips=p.clips.flatMap(c=>{if(!ids.includes(c.id))return[c];const pieces=safeCuts?splitClipSafe(c,time):splitClip(c,time);if(pieces.length>1)count++;return pieces;});});
    if(!count)notify('Letakkan playhead di tengah klip yang tidak terkunci.');else if(editor.get().revision===before)notify('Klip atau transisinya terkunci.');
  };
  const copyClips = (cut = false) => {
    if(range){const source=cut?{...project,clips:project.clips.filter(c=>!isArrangementLocked(project,c))}:project,copies=copyRange(source,range);if(!copies.length){if(cut)notify('Tidak ada audio yang bisa diedit dalam rentang ini.');return;}if(cut){const revision=editor.get().revision;editor.edit('Cut rentang',p=>deleteRange(p,range,rippleScope));if(editor.get().revision===revision)return;editor.setRange(null);}setClipboard(copies);return;}
    const ids=expandedSelection(project,selected),draft=structuredClone(project);if(!ids.length)return;
    if(cut&&ids.some(id=>isClipLocked(project,project.clips.find(c=>c.id===id)!))){notify('Buka kunci pilihan sebelum melakukan cut.');return;}
    bakeCrossfades(draft,ids);
    if(cut){editor.edit('Cut klip',p=>{p.clips=deleteClips(p,ids,rippleScope).clips;});if(editor.get().project.clips.some(c=>ids.includes(c.id))){notify('Pilihan atau transisinya terkunci.');return;}editor.select([]);}
    setClipboard(draft.clips.filter(c=>ids.includes(c.id)));
  };
  const pasteClips = () => {
    const chosen = clipboard.filter(c => project.assets.some(a => a.id === c.assetId)); if (!chosen.length) return;
    const start = Math.min(...chosen.map(c => c.start));
    const clips=freshClipCopies(chosen).map(c=>({...c,start:playhead.current+c.start-start,trackId:chosen.length===1?targetTrack:(project.tracks.some(t=>t.id===c.trackId)?c.trackId:targetTrack)}));
    if(clips.some(c=>project.tracks.find(t=>t.id===c.trackId)?.locked)){notify('Track tujuan terkunci.');return;}
    editor.edit('Paste klip',p=>{insertClips(p,clips,playhead.current,rippleScope);});const inserted=clips.filter(c=>editor.get().project.clips.some(actual=>actual.id===c.id));if(!inserted.length){notify('Ripple terlalu dekat dengan tepi klip. Geser playhead atau matikan ripple.');return;}editor.select(inserted.map(c=>c.id));
  };
  const duplicate = () => {
    const chosen = project.clips.filter(c => selected.includes(c.id)); if (!chosen.length) return;
    const duration = Math.max(...chosen.map(c => c.start + c.duration)) - Math.min(...chosen.map(c => c.start));
    if(chosen.some(c=>isClipLocked(project,c))){notify('Buka kunci pilihan sebelum menduplikat.');return;}
    const draft=structuredClone(project);bakeCrossfades(draft,chosen.map(c=>c.id));const copies=freshClipCopies(draft.clips.filter(c=>selected.includes(c.id))).map(c=>({...c,start:c.start+duration}));
    editor.edit('Duplikat klip',p=>{insertClips(p,copies,Math.min(...copies.map(c=>c.start)),rippleScope);});const inserted=copies.filter(c=>editor.get().project.clips.some(actual=>actual.id===c.id));if(!inserted.length){notify('Ripple terlalu dekat dengan tepi klip. Geser playhead atau matikan ripple.');return;}editor.select(inserted.map(c=>c.id));
  };
  const remove=(forceRipple:boolean|RippleScope=rippleScope)=>{if(range){const editable=project.clips.some(c=>range.trackIds.includes(c.trackId)&&c.start<range.end&&c.start+c.duration>range.start&&!isArrangementLocked(project,c));if(!editable){notify('Tidak ada audio yang bisa diedit dalam rentang ini.');return;}const revision=editor.get().revision;editor.edit('Hapus rentang',p=>deleteRange(p,range,forceRipple));if(editor.get().revision!==revision)editor.setRange(null);return;}if(!selected.length)return;if(chosenClips.some(c=>isArrangementLocked(project,c))){notify('Pilihan atau transisinya terkunci.');return;}const revision=editor.get().revision;editor.edit('Hapus klip',p=>{p.clips=deleteClips(p,selected,forceRipple).clips;});if(editor.get().revision!==revision)editor.select([]);};
  const join = async () => {
    if (operation.current) return;
    const clips = project.clips.filter(c => selected.includes(c.id));
    if (clips.length < 2) return;
    if(clips.some(c=>isClipLocked(project,c))){notify('Buka kunci pilihan sebelum menyambung.');return;}
    if (new Set(clips.map(c => c.trackId)).size > 1) { notify('Pilih klip pada track yang sama untuk menyambung.', true); return; }
    operation.current = true; setBusy('Menyambungkan audio…'); stop();
    try {
      const start = Math.min(...clips.map(c => c.start)), track = project.tracks.find(t => t.id === clips[0].trackId)!;
      const scoped = structuredClone(project); bakeCrossfades(scoped, selected);
      const buffer = await renderProject({ ...scoped, tracks: [{ ...track, muted: false, solo: false, gain: 1 }], clips: scoped.clips.filter(c => selected.includes(c.id)).map(c => ({ ...c, start: c.start - start })) });
      const name = `Sambungan ${project.assets.length + 1}.wav`, asset = putMedia(buffer, encodeFloatWav(buffer), name), clip = makeClip(asset, track.id, start);
      editor.edit('Sambungkan klip', p => { p.assets.push(asset); p.clips = p.clips.filter(c => !selected.includes(c.id)); p.clips.push(clip); }); editor.select([clip.id]); notify('Klip tersambung.');
    } catch (e) { notify(String(e), true); } finally { operation.current = false; setBusy(''); }
  };
  const loadDemo = () => guarded(() => {
    stop(); media.clear(); const p = emptyProject(), demo = demoMedia(); p.name = 'Sesi eksplorasi'; p.assets = demo.assets;
    const a = makeClip(demo.assets[0], p.tracks[0].id, 1.5), b = { ...makeClip(demo.assets[0], p.tracks[0].id, 11), offset: 1, duration: 5.8 };
    a.fadeIn = 0.12; a.fadeOut = 0.3;
    const music = makeClip(demo.assets[1], p.tracks[1].id, 0); music.fadeIn = 1.5; music.fadeOut = 2;
    p.clips = [a, b, music, makeClip(demo.assets[2], p.tracks[2].id, 8.7), makeClip(demo.assets[2], p.tracks[2].id, 18)];
    applyProject(p, new Map(media)); setSavedStamp(''); notify('Demo dimuat.');
  });
  const doExport = async () => {
    if (operation.current) return; operation.current = true; setBusy('Menyiapkan ekspor…');
    let path: string | null = null;
    try {
      const filename = exportFilename(exportName, exportFormat, project.name);
      const { project: scoped, range: exportRange } = resolveExportScope(project, selected, range, exportScope);
      if (desktop) { path = await save({ defaultPath: filename, filters: [{ name: exportFormat.toUpperCase() + ' Audio', extensions: [exportFormat] }] }); if (!path) return; }
      stop(); setBusy('Merender campuran audio…');
      const buffer = await renderProject(scoped, sampleRate, exportRange), pcm = pcmBytes(buffer, normalize);
      if (pcm.peak > 1 && !normalize && !peakWarning) { setPeakWarning(true); notify('Peak melewati 0 dBFS. Aktifkan normalisasi atau klik ekspor lagi untuk menyimpan dengan clipping.', true); return; }
      if (exportFormat === 'mp3') {
        const encoded = await encodeMp3(buffer, bitrate, normalize, progress => setBusy(`Mengenkode MP3… ${Math.round(progress * 100)}%`));
        if (desktop && path) await invoke('export_mp3', { path, bytesBase64: toBase64(encoded.bytes) }); else download(encoded.bytes, filename, 'audio/mpeg');
      } else {
        setBusy('Menulis berkas WAV…');
        if (desktop && path) await invoke('export_wav', { path, pcmBase64: toBase64(pcm.bytes), sampleRate, bits }); else download(encodeWav(buffer, bits, normalize).bytes, filename, 'audio/wav');
      }
      setModal(null); notify(`${exportFormat.toUpperCase()} berhasil diekspor${path ? ` ke ${path}` : ''}.`);
    } catch (e) { notify(`Gagal ekspor: ${e}`, true); } finally { operation.current = false; setBusy(''); }
  };
  const isolate = () => { if (!range) return; stop(); let ids: string[] = []; editor.edit('Pisahkan rentang', p => { ids = isolateRange(p, range); }); editor.select(ids); setTool('move'); };
  const toggleLoop = () => { stop(); editor.edit('Loop playback', p => { const bounds = range ? { start: range.start, end: Math.min(range.end, range.start + 900) } : p.loop ?? { start: 0, end: Math.max(MIN_CLIP, Math.min(900, endTime(p))) }; p.loop = { ...bounds, enabled: !p.loop?.enabled }; }); };
  const addMarker = () => { if ((project.markers?.length ?? 0) >= 1024) return; editor.edit('Tambah marker', p => { (p.markers ??= []).push({ id: uid(), name: `Marker ${(p.markers?.length ?? 0) + 1}`, time: playhead.current }); }); };
  const openTools = (tab: typeof toolsTab = 'markers') => { stop();const editable={...project,clips:project.clips.filter(c=>!isArrangementLocked(project,c))};setAnalysisClips(range ? copyRange(editable, range) : editable.clips.filter(c => selected.length ? selected.includes(c.id) : c.trackId === targetTrack)); setToolsTab(tab); setModal('tools'); };
  const openExport = (scope: ExportScope = 'project') => { stop(); setPeakWarning(false); setExportScope(scope); setExportName(project.name); setModal('export'); };
  const commitRecording = (data: RecordedAudio) => {
    const snapshot=editor.get().project,requested=snapshot.tracks.find(t=>t.id===targetTrack),needsTrack=!requested||requested.locked;
    const track=needsTrack?(snapshot.tracks.length<MAX_TRACKS?{...makeTrack(snapshot.tracks.length),name:'Rekaman'}:null):requested;
    const asset=putMedia(data.buffer,data.bytes,`Rekaman ${new Date().toLocaleTimeString('id-ID').replaceAll('.', '-')}.wav`),clip=track?makeClip(asset,track.id,playhead.current):null;
    editor.edit('Rekam mikrofon',p=>{p.assets.push(asset);if(needsTrack&&track)p.tracks.push(track);if(clip)insertClips(p,[clip],clip.start,rippleScope);});
    const inserted=clip&&editor.get().project.clips.some(c=>c.id===clip.id);
    if(inserted){editor.select([clip.id]);setActiveTrack(clip.trackId);}else{setMediaOpen(true);setMobilePanel(window.innerWidth<900?'media':null);}setLibraryTab('media');setRecording(false);setModal(null);
    notify(inserted?(needsTrack?'Rekaman ditambahkan ke track baru.':'Rekaman ditambahkan ke track.'):clip?'Ripple terlalu dekat dengan tepi klip. Rekaman disimpan di Media.':'Batas track tercapai. Rekaman disimpan di Media.');
  };
  recordedCommit.current = commitRecording;
  const fitTimeline = () => { const el = document.querySelector('.timeline-scroll'); if (el) { setScale(Math.min(960, Math.max(4, (el.clientWidth - HEADER_WIDTH - 70) / Math.max(8, endTime(project))))); el.scrollLeft = 0; } };
  const fitSelection = () => {
    const snapshot = editor.get(), clips = snapshot.project.clips.filter(c => snapshot.selected.includes(c.id));
    const bounds = snapshot.range ?? (clips.length ? { start: Math.min(...clips.map(c => c.start)), end: Math.max(...clips.map(c => c.start + c.duration)) } : null), el = document.querySelector<HTMLElement>('.timeline-scroll');
    if (!bounds || !el) return;
    const nextScale = Math.min(960, Math.max(4, (el.clientWidth - HEADER_WIDTH - 60) / Math.max(0.1, bounds.end - bounds.start)));
    setScale(nextScale); requestAnimationFrame(() => { el.scrollLeft = Math.max(0, bounds.start * nextScale - 24); });
  };
  const clipAction = (action: ClipAction, clipId: string) => {
    const current = editor.get(); if (!current.selected.includes(clipId)) editor.select([clipId]);
    if (action === 'split') split(); else if (action === 'copy') copyClips(); else if (action === 'cut') copyClips(true); else if (action === 'paste') pasteClips(); else if (action === 'duplicate') duplicate(); else if (action === 'delete') remove(); else if (action === 'join') void join(); else if (action === 'export') openExport('selected'); else if (action === 'effects') { setAutoInspector(true);setInspectorOpen(true); setMobilePanel('properties'); window.dispatchEvent(new CustomEvent('kuraudio:effects',{detail:clipId})); }
    else if(action==='group'||action==='ungroup'){stop();const ids=editor.get().selected;editor.edit(action==='group'?'Grupkan klip':'Pisahkan grup',p=>action==='group'?groupClips(p,ids):ungroupClips(p,ids));editor.select(ids);}
    else if(action==='lock'||action==='unlock'){stop();editor.edit(action==='lock'?'Kunci klip':'Buka kunci klip',p=>setClipsLocked(p,editor.get().selected,action==='lock'));}
    else if(action==='loudness')openTools('loudness');
    else if(action==='precision'){stop();const c=editor.get().project.clips.find(c=>c.id===clipId);if(c&&(playhead.current<c.start||playhead.current>c.start+c.duration))seek(c.start+c.duration/2);setAutoInspector(true);setInspectorOpen(true);setMobilePanel('properties');window.dispatchEvent(new CustomEvent('kuraudio:precision',{detail:clipId}));}
  };
  const showHistory=()=>{stop();setLibraryTab('history');setMediaOpen(true);setMobilePanel(window.innerWidth<1200?'media':null);};
  const restoreCheckpoint=(id:string)=>guarded(async()=>{
    if(operation.current)return;operation.current=true;stop();setBusy('Memulihkan versi…');const {origin,path}=projectFile.current,projectId=editor.get().project.id,revision=editor.get().revision,ticket=++restoreTicket.current;
    try{const record=await readCheckpoint(id);if(!record||record.project.id!==projectId)throw Error('Versi cadangan tidak tersedia untuk proyek ini.');const decoded=await decodeRecovery({project:record.project,time:record.summary.time,dirty:true,media:record.media});if(editor.get().project.id!==projectId||editor.get().revision!==revision||restoreTicket.current!==ticket)throw Error('Proyek berubah selama pemulihan. Ulangi dari versi yang dipilih.');applyProject(decoded.project,decoded.decoded,path,origin!=='new');setFileOrigin(origin);setSavedStamp('');setLibraryTab('history');refreshCheckpoints();notify('Versi dipulihkan. Simpan untuk memperbarui berkas proyek.');}
    catch(error){notify(`Cadangan tidak dapat dipulihkan: ${error}`,true);}finally{operation.current=false;setBusy('');}
  });
  const changePreferences=(next:AppPreferences)=>{setPreferences(next);setPreferencesStatus(saveAppPreferences(next)?'':'Penyimpanan lokal tidak tersedia. Berlaku untuk sesi ini.');};
  const openSettings=()=>{stop();setModal('settings');};
  const setPanel=(panel:'media'|'properties',visible:boolean)=>{
    if(panel==='media'){setMediaOpen(visible);if(!wideWindow)setMobilePanel(visible?(desktopWindow?null:'media'):null);}
    else{setInspectorOpen(visible);setAutoInspector(visible);if(!wideWindow)setMobilePanel(visible?'properties':null);}
  };
  const inspectorVisible=wideWindow?inspectorOpen:mobilePanel==='properties';
  const applyLayout=(view:typeof workspaceLayouts[number]['view']|typeof defaultWorkspaceView)=>{
    setMediaOpen(view.mediaOpen);setInspectorOpen(view.inspectorOpen);setAutoInspector(view.autoInspector??true);
    setSizes({mediaWidth:view.mediaWidth,inspectorWidth:view.inspectorWidth,trackHeight:view.trackHeight});
    setLibraryTab('media');setMobilePanel(!wideWindow&&view.inspectorOpen?'properties':null);
  };
  const requestQuit=()=>{if(desktop)void getCurrentWindow().close().catch(error=>notify(`Gagal menutup aplikasi: ${error}`,true));};
  const hasProject=screen==='editor',hasSelection=!!selected.length||!!range;
  const rangeEditable=!!range&&project.clips.some(c=>range.trackIds.includes(c.trackId)&&c.start<range.end&&c.start+c.duration>range.start&&!isArrangementLocked(project,c));
  const fileEntries:MenuEntry[]=[
    {id:'new',label:'Proyek baru',shortcut:'Ctrl+N',action:newProject},
    {id:'open',label:'Buka proyek…',shortcut:'Ctrl+O',action:()=>guarded(openProject)},
    ...recentProjects.slice(0,5).flatMap((entry,index):MenuEntry[]=>[...(index===0?[{id:'recent-heading',separator:true as const,label:'Terakhir dibuka'}]:[]),{id:'recent-'+entry.id,label:entry.name,action:()=>openRecent(entry)}]),
    {id:'file-source',separator:true},
    {id:'import',label:'Impor audio…',shortcut:'Ctrl+I',disabled:!hasProject,action:()=>void importAudio()},
    {id:'save',label:'Simpan',shortcut:'Ctrl+S',disabled:!hasProject,action:()=>void saveCurrent()},
    {id:'save-as',label:'Simpan sebagai…',shortcut:'Ctrl+Shift+S',disabled:!hasProject,action:()=>void saveCurrent(true)},
    {id:'export',label:'Ekspor audio…',shortcut:'Ctrl+E',disabled:!hasProject||!project.clips.length,action:()=>openExport(range?'range':'project')},
    {id:'file-close',separator:true},
    {id:'close-project',label:'Tutup proyek',disabled:!hasProject,action:goHome},
    ...(desktop?[{id:'quit',label:'Keluar KurAudio',shortcut:'Ctrl+Q',action:requestQuit}]:[]),
  ];
  const menus:AppMenu[]=[
    {id:'file',label:'File',accessKey:'f',entries:fileEntries},
    {id:'edit',label:'Edit',accessKey:'e',entries:[
      {id:'undo',label:'Undo',shortcut:'Ctrl+Z',disabled:!hasProject||!state.undoCount,action:()=>editor.undo()},
      {id:'redo',label:'Redo',shortcut:'Ctrl+Shift+Z',disabled:!hasProject||!state.redoCount,action:()=>editor.redo()},
      {id:'edit-clipboard',separator:true},
      {id:'cut',label:'Cut',shortcut:'Ctrl+X',disabled:!hasProject||!(range?rangeEditable:canModifySelection),action:()=>copyClips(true)},
      {id:'copy',label:'Salin',shortcut:'Ctrl+C',disabled:!hasProject||!hasSelection,action:()=>copyClips()},
      {id:'paste',label:'Tempel',shortcut:'Ctrl+V',disabled:!hasProject||!clipboard.length,action:pasteClips},
      {id:'select-all',label:'Pilih semua klip',shortcut:'Ctrl+A',disabled:!hasProject||!project.clips.length,action:()=>editor.select(project.clips.map(c=>c.id))},
      {id:'edit-clips',separator:true},
      {id:'split',label:'Potong di playhead',shortcut:'Ctrl+B',disabled:!hasProject||!project.clips.length,action:()=>split()},
      {id:'duplicate',label:'Duplikat',shortcut:'Ctrl+D',disabled:!hasProject||!canModifySelection,action:duplicate},
      {id:'delete',label:'Hapus',shortcut:'Delete',disabled:!hasProject||!(range?rangeEditable:canModifySelection),danger:true,action:()=>remove()},
      {id:'edit-groups',separator:true},
      {id:'group',label:'Grupkan klip',shortcut:'Ctrl+G',disabled:!hasProject||!canModifySelection||selected.length<2,action:()=>clipAction('group',selected[0])},
      {id:'ungroup',label:'Pisahkan grup',shortcut:'Ctrl+Shift+G',disabled:!hasProject||!canModifySelection||!chosenClips.some(c=>c.groupId),action:()=>clipAction('ungroup',selected[0])},
      {id:'lock',label:chosenClips.length&&chosenClips.every(c=>c.locked)?'Buka kunci klip':'Kunci klip',shortcut:'Ctrl+L',disabled:!hasProject||!selected.length,action:()=>clipAction(chosenClips.every(c=>c.locked)?'unlock':'lock',selected[0])},
    ]},
    {id:'window',label:'Window',accessKey:'w',entries:[
      {id:'media',label:'Media',checked:mediaVisible&&libraryTab==='media',disabled:!hasProject,action:()=>{setLibraryTab('media');setPanel('media',!(mediaVisible&&libraryTab==='media'));}},
      {id:'history',label:'Riwayat',shortcut:'Ctrl+Shift+H',checked:mediaVisible&&libraryTab==='history',disabled:!hasProject,action:()=>{if(mediaVisible&&libraryTab==='history')setPanel('media',false);else showHistory();}},
      {id:'inspector',label:'Properti & efek',checked:inspectorVisible,disabled:!hasProject,action:()=>setPanel('properties',!inspectorVisible)},
      {id:'layouts',separator:true,label:'Layout'},
      ...workspaceLayouts.map(layout=>({id:layout.id,label:layout.label,checked:hasProject&&layout.view.mediaOpen===mediaOpen&&layout.view.inspectorOpen===inspectorOpen&&layout.view.trackHeight===sizes.trackHeight&&layout.view.inspectorWidth===sizes.inspectorWidth&&layout.view.mediaWidth===sizes.mediaWidth,radio:true,disabled:!hasProject,action:()=>applyLayout(layout.view)})),
      {id:'reset-layout',label:'Reset layout',disabled:!hasProject,action:()=>applyLayout(defaultWorkspaceView)},
      {id:'zoom-separator',separator:true},
      {id:'fit',label:'Sesuaikan timeline',shortcut:'F',disabled:!hasProject,action:fitTimeline},
      {id:'fit-selection',label:'Zoom ke seleksi',shortcut:'Shift+F',disabled:!hasProject||!hasSelection,action:fitSelection},
    ]},
    {id:'settings',label:'Pengaturan',accessKey:'p',action:openSettings},
    {id:'help',label:'Bantuan',accessKey:'b',entries:[
      {id:'shortcuts',label:'Pintasan keyboard',shortcut:'F1 / ?',action:()=>setModal('help')},
      {id:'about',label:'Tentang KurAudio',action:()=>setModal('about')},
    ]},
  ];
  const menuBar=<Menubar menus={menus} disabled={!ready||!!busy||!!modal}/>;
  const restoreEditorAfterClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.detail === 0) return; // Keyboard activation retains its local control focus.
    const target = event.target as HTMLElement;
    if (target.closest('[role="menu"],[role="menubar"],[role="dialog"],.asset-item,.media-preview,.audio-clip')) return;
    let control = target.closest<HTMLElement>('button,input,label');
    if (control?.tagName === 'LABEL') control = control.querySelector('input');
    if (control instanceof HTMLInputElement && !['checkbox','radio','range'].includes(control.type)) return;
    if (!control && !target.closest('.track-header')) return;
    if (control?.hasAttribute('aria-haspopup')) return;
    const origin = document.activeElement;
    requestAnimationFrame(() => {
      if (latest.current.modal || latest.current.busy || latest.current.screen !== 'editor') return;
      if (document.activeElement !== origin || document.querySelector('.comfort-popover,[role="menu"],[role="dialog"]')) return;
      document.querySelector<HTMLElement>('.main-editor h1')?.focus({preventScroll:true});
    });
  };
  const actions = useRef({ importAudio, split, duplicate, copyClips, pasteClips, remove, join, saveCurrent, openProject, guarded, togglePlay, seek, fitTimeline, newProject, toggleLoop, addMarker, openExport, openTools, reviewSelection, reviewAround, returnToPlayback, fitSelection,clipAction,showHistory,openSettings });
  actions.current = { importAudio, split, duplicate, copyClips, pasteClips, remove, join, saveCurrent, openProject, guarded, togglePlay, seek, fitTimeline, newProject, toggleLoop, addMarker, openExport, openTools, reviewSelection, reviewAround, returnToPlayback, fitSelection,clipAction,showHistory,openSettings };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.altKey && e.code !== 'Space' || !latest.current.ready || latest.current.busy || latest.current.modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key===',') {e.preventDefault();actions.current.openSettings();return;}
      if (e.key==='F1') {e.preventDefault();setModal('help');return;}
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='q') {e.preventDefault();if(desktop)void getCurrentWindow().close().catch(error=>notify(String(error),true));return;}
      if (document.querySelector('.audio-clip.dragging,[data-timeline-gesture]')) { if (e.key !== 'Escape') e.preventDefault(); return; }
      if (e.key === 'Escape' && latest.current.panel) {
        e.preventDefault(); const panel = latest.current.panel; setMobilePanel(null);
        focusPanelTrigger(panel);
        return;
      }
      const context = shortcutContext(e.target as HTMLElement);
      if (context === 'menu' || context === 'dialog') return;
      const command = resolveShortcut(e, context);
      if (command === 'save' || command === 'saveAs') { e.preventDefault(); if (latest.current.screen === 'editor') void actions.current.saveCurrent(command === 'saveAs'); return; }
      if (context === 'switch' && e.code === 'Space') return;
      const tag = (e.target as HTMLElement).tagName;
      const transportFromSlider = e.code === 'Space' && (e.target as HTMLInputElement).type === 'range';
      if ((['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !transportFromSlider) || (e.target as HTMLElement).isContentEditable) return;
      if (e.code === 'Space' && (e.target as HTMLElement).closest('.asset-item,.media-preview')) return;
      const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), a = actions.current;
      if (ctrl && !e.altKey && k === 'n') { e.preventDefault(); if (!e.repeat) a.newProject(); return; }
      if (latest.current.screen === 'home') { if (ctrl && k === 'o') { e.preventDefault(); if (!e.repeat) void a.openProject(); } return; }
      if (e.code === 'Space' && !ctrl) { e.preventDefault(); if (!e.repeat) { if (e.shiftKey) a.reviewSelection(); else if (e.altKey) a.reviewAround(); else void a.togglePlay(); } }
      else if (e.key === 'Enter' && e.shiftKey && !ctrl) { e.preventDefault(); a.returnToPlayback(); }
      else if (ctrl && k === 's') { e.preventDefault(); void a.saveCurrent(e.shiftKey); }
      else if (ctrl && k === 'o') { e.preventDefault(); a.guarded(a.openProject); }
      else if (ctrl && k === 'i') { e.preventDefault(); void a.importAudio(); }
      else if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); }
      else if (ctrl && k === 'y') { e.preventDefault(); editor.redo(); }
      else if (ctrl && k === 'a') { e.preventDefault(); editor.select(editor.get().project.clips.map(c => c.id)); }
      else if (ctrl && (k === 'c' || k === 'x')) { e.preventDefault(); a.copyClips(k === 'x'); }
      else if (ctrl && k === 'v') { e.preventDefault(); a.pasteClips(); }
      else if (ctrl && k === 'e') { e.preventDefault(); if (editor.get().project.clips.length) a.openExport(editor.get().range ? 'range' : 'project'); }
      else if (ctrl && k === 'd') { e.preventDefault(); a.duplicate(); }
      else if (ctrl && k === 'j') { e.preventDefault(); void a.join(); }
      else if(ctrl&&k==='g'){e.preventDefault();const id=editor.get().selected[0];if(id)a.clipAction(e.shiftKey?'ungroup':'group',id);}
      else if(ctrl&&k==='l'){e.preventDefault();const s=editor.get(),id=s.selected[0];if(id)a.clipAction(s.project.clips.filter(c=>s.selected.includes(c.id)).every(c=>c.locked)?'unlock':'lock',id);}
      else if(ctrl&&e.shiftKey&&k==='h'){e.preventDefault();a.showHistory();}
      else if (ctrl && k === 'b' && !e.altKey) { e.preventDefault(); if (!e.repeat) a.split(); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); a.remove(e.shiftKey || undefined); }
      else if (!ctrl && k === 's') { e.preventDefault(); if (!e.repeat) a.split(); }
      else if (!ctrl && k === 'e') {const id=editor.get().selected[0];if(id)a.clipAction('effects',id);}
      else if (!ctrl && k === 'v') setTool('move');
      else if (!ctrl && k === 'c') setTool('cut');
      else if (!ctrl && k === 'r') setTool('range');
      else if(!ctrl&&k==='g')setTool('gain');
      else if(!ctrl&&k==='p'){const id=editor.get().selected[0];if(id)a.clipAction('precision',id);}
      else if (!ctrl && k === 'm' && !e.repeat) a.addMarker();
      else if (!ctrl && k === 'l' && !e.repeat) a.toggleLoop();
      else if (!ctrl && (k === '[' || k === ']')) { const markers = [...(editor.get().project.markers ?? [])].sort((a, b) => a.time - b.time); const marker = k === '[' ? markers.filter(m => m.time < playhead.current - 0.001).at(-1) : markers.find(m => m.time > playhead.current + 0.001); if (marker) a.seek(marker.time); }
      else if (k === 'n' && !ctrl) setSnap(s => !s);
      else if (k === 'home') { e.preventDefault(); a.seek(0); }
      else if (k === 'end') { e.preventDefault(); a.seek(endTime(editor.get().project)); }
      else if (k === '=' || k === '+') { e.preventDefault(); setScale(s => Math.min(960, s * 1.25)); }
      else if (k === '-') { e.preventDefault(); setScale(s => Math.max(4, s / 1.25)); }
      else if (k === 'f' && !ctrl) { e.preventDefault(); e.shiftKey ? a.fitSelection() : a.fitTimeline(); }
      else if (k === 'escape') editor.select([]);
      else if (k === '?') setModal('help');
    };
    const transportKey = (event: KeyboardEvent) => {
      if ((event.code !== 'Space' && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) || (event.target as HTMLElement).closest('[role="menu"],[role="menubar"],[role="dialog"],.asset-item,.media-preview')) return;
      key(event);
      if (event.defaultPrevented) event.stopPropagation();
    };
    window.addEventListener('keydown', transportKey, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', transportKey, true); window.removeEventListener('keydown', key); };
  }, []);
  return <>
    {screen === 'home' ? <HomeScreen menu={menuBar} recentProjects={recentProjects} onOpenRecent={openRecent} onRemoveRecent={entry => { void forgetRecentProject(entry.id).then(refreshRecents); }} disabled={!ready || !!modal || !!busy} onNew={newProject} onOpen={() => void openProject()} onDropFiles={files => { void importFiles(files); }}/> : <div className={`workspace ${mobilePanel ? 'show-' + mobilePanel : ''} ${mediaOpen ? '' : 'hide-media'} ${inspectorOpen ? '' : 'hide-inspector'}`} style={{ '--layout-media': `${sizes.mediaWidth / 16}rem`, '--layout-inspector': `${sizes.inspectorWidth / 16}rem`, '--layout-track': `${sizes.trackHeight / 16}rem` } as CSSProperties} data-resizing={resizing} data-restoring={restoring} onClick={restoreEditorAfterClick} inert={!!modal || !!busy} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files)); }}>
      <header className="app-header">
        <button className="brand brand-home" aria-label="Beranda KurAudio" data-tooltip="Kembali ke beranda" onClick={goHome}><BrandMark size={27}/><span>KurAudio</span></button>
        {menuBar}<div className="header-divider"/>
        <div className="project-name"><CommitTextField aria-label="Nama proyek" value={project.name} maxLength={160} fallback="Proyek tanpa judul" onCommit={value => editor.edit('Nama proyek', p => { p.name = value; })}/><span className={dirty || !hasSavedFile ? 'unsaved-indicator' : 'saved-indicator'} data-tooltip={!hasSavedFile ? 'Proyek belum disimpan ke berkas' : dirty ? 'Perubahan belum disimpan' : fileOrigin === 'downloaded' ? 'Berkas proyek diunduh' : fileOrigin === 'opened' ? 'Berkas proyek dibuka' : 'Berkas proyek tersimpan'}/></div>
        <div className="header-actions">
          <button className="button subtle" data-tooltip="Simpan proyek (Ctrl+S)" onClick={() => void saveCurrent()}><FloppyDisk size={16}/><span>Simpan</span></button>
          <div className="separator"/>
          <button className="button primary" aria-label="Ekspor audio" disabled={!project.clips.length} onClick={() => openExport()}><ArrowUpRight size={16}/><span>Ekspor audio</span></button>
        </div>
      </header>
      <div className="transport" aria-label="Transport audio">
        <div className="transport-buttons"><IconButton label="Ke awal (Home)" onClick={() => seek(0)}><SkipBack size={17} weight="fill"/></IconButton><button className={`play-button ${playing ? 'playing' : ''}`} aria-label={playing ? 'Jeda (Space)' : 'Putar (Space)'} data-tooltip="Putar / jeda (Space)" disabled={!project.clips.length} aria-busy={preparing} onClick={() => void togglePlay()}><span className="transport-glyph" key={playing ? 'pause' : 'play'}>{playing ? <Pause size={19} weight="fill"/> : <Play size={19} weight="fill"/>}</span></button><IconButton label="Stop" onClick={() => { stop(); seek(0); }}><Stop size={15} weight="fill"/></IconButton><IconButton label="Ke akhir (End)" onClick={() => seek(endTime(project))}><SkipForward size={17} weight="fill"/></IconButton></div>
        <PlaybackReview canReview={!!range || !!selected.length} disabled={!project.clips.length} onSelection={reviewSelection} onAround={reviewAround} onReturn={returnToPlayback}/>
        <div className="transport-left"><output ref={timeElement} aria-label="Waktu playhead" className="timecode">{formatTime(position, true)}</output><span className="transport-duration">/ {formatTime(renderEndTime(project), true)}</span></div>
        <div className="transport-spacer"/>
        <div className="output-meter"><div className="meter-heading"><span>Output</span><span ref={peakLabel}>−∞ dB</span></div><div className="meter-track"><div ref={meter}/></div></div>
        <button className="button record-shortcut" aria-label="Rekam mikrofon" data-tooltip="Rekam ke track aktif" onClick={() => openTools('record')}><Microphone size={17}/><span>Rekam</span></button>
        <button className="button import-main" data-tooltip="Impor audio (Ctrl+I)" onClick={() => void importAudio()}><Plus size={16}/><span>Impor audio</span></button>
      </div>
      <nav className="mobile-tabs" aria-label="Panel editor"><button onClick={() => setMobilePanel(mobilePanel === 'media' ? null : 'media')} aria-pressed={mobilePanel === 'media'}>Media</button><button onClick={() => setMobilePanel(null)} aria-pressed={!mobilePanel}>Timeline</button><button onClick={() => setMobilePanel(mobilePanel === 'properties' ? null : 'properties')} aria-pressed={mobilePanel === 'properties'}>Properti</button></nav>
      <div className="editor-body">
        <aside className="media-panel" aria-label="Pustaka media" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files)); }} inert={!mediaVisible} aria-hidden={!mediaVisible || undefined}>
          <PanelResizer side="media" value={sizes.mediaWidth} min={180} max={360} defaultValue={224} onChange={value => setSizes(s => ({ ...s, mediaWidth: value }))} onResizing={setResizing}/><div className="panel-heading library-heading"><div className="library-tabs" role="tablist" aria-label="Pustaka proyek" onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const tab=libraryTab==='media'?'history':'media';stop();setLibraryTab(tab);document.getElementById('library-tab-'+tab)?.focus();}}}><button id="library-tab-media" role="tab" aria-selected={libraryTab==='media'} tabIndex={libraryTab==='media'?0:-1} aria-controls="library-content" onClick={()=>setLibraryTab('media')}>Media <small>{project.assets.length}</small></button><button id="library-tab-history" role="tab" aria-label="Riwayat proyek" aria-selected={libraryTab==='history'} tabIndex={libraryTab==='history'?0:-1} aria-controls="library-content" onClick={()=>{stop();setLibraryTab('history');}}><ClockCounterClockwise size={15}/>Riwayat</button></div>{libraryTab==='media'&&<button className="icon-button import-button" data-tooltip="Impor audio" aria-label="Impor audio ke pustaka" onClick={() => void importAudio()}><Plus size={16}/></button>}</div>
          <div id="library-content" className="library-content" role="tabpanel" aria-labelledby={'library-tab-'+libraryTab}>{libraryTab==='media'?<>
          <label className="media-search"><MagnifyingGlass size={15}/><input aria-label="Cari audio" placeholder="Cari media" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="Hapus pencarian" onClick={() => setSearch('')}><X size={14}/></button>}</label>
          <div className="asset-list">{project.assets.filter(a => a.name.toLowerCase().includes(search.toLowerCase())).map(a => <MediaItem key={a.id} asset={a} index={project.assets.indexOf(a)} onInsert={() => insertAsset(a)} onPreview={() => previewAsset(a.id)}/>)}
            {!project.assets.length && <p className="library-empty">Tarik audio ke sini</p>}
            {!!project.assets.length && !project.assets.some(a => a.name.toLowerCase().includes(search.toLowerCase())) && <p className="no-results">Media tidak ditemukan</p>}
          </div>
          <MediaPreview assets={project.assets} onBeforePlay={stop} onError={message => notify(message, true)}/>
          <div className="library-footer"><button className="text-button" onClick={loadDemo}>Buka sesi demo</button></div></>:<HistoryPanel history={state.history} checkpoints={checkpoints} loading={checkpointBusy} status={checkpointStatus} onJump={id=>{if(operation.current||busy)return;stop();editor.jumpToHistory(id);}} onCreate={()=>void checkpoint(editor.get().project,'Manual',true)} onRestore={restoreCheckpoint} onDelete={id=>{setCheckpointBusy(true);void deleteCheckpoint(id).then(refreshCheckpoints).catch(error=>notify(String(error),true)).finally(()=>setCheckpointBusy(false));}} onRefresh={refreshCheckpoints}/>}</div>
        </aside>
        <main className="main-editor"><h1 className="sr-only" tabIndex={-1}>Editor audio</h1>
          <div className="editing-toolbar" aria-label="Alat editing">
            <div className="tool-group tool-modes"><IconButton label="Pilih & geser (V)" active={tool === 'move'} onClick={() => setTool('move')}><Cursor size={17}/><span>Geser</span></IconButton><IconButton label="Alat potong (C)" active={tool === 'cut'} onClick={() => setTool('cut')}><Scissors size={17}/><span>Potong</span></IconButton><IconButton label="Seleksi rentang (R)" active={tool === 'range'} onClick={() => setTool('range')}><Selection size={17}/><span>Rentang</span></IconButton><IconButton label="Volume automation (G)" active={tool==='gain'} onClick={()=>setTool('gain')}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 18 6-9 6 4 6-10"/><circle cx="9" cy="9" r="2" fill="var(--surface-input)"/><circle cx="15" cy="13" r="2" fill="var(--surface-input)"/></svg><span>Volume</span></IconButton></div><div className="separator"/>
            <div className="tool-group"><IconButton label="Undo (Ctrl+Z)" disabled={!state.undoCount} onClick={() => editor.undo()}><ArrowCounterClockwise size={18}/></IconButton><IconButton label="Redo (Ctrl+Shift+Z)" disabled={!state.redoCount} onClick={() => editor.redo()}><ArrowClockwise size={18}/></IconButton></div><div className="separator"/>
            <button className="tool-label" data-tooltip="Potong pada playhead (Ctrl+B / S)" aria-label="Potong" aria-keyshortcuts="Control+B S" disabled={!project.clips.length} onClick={() => split()}><SplitHorizontal size={17}/></button><IconButton label="Duplikat (Ctrl+D)" disabled={!canModifySelection} onClick={duplicate}><Copy size={17}/></IconButton><IconButton label="Sambungkan (Ctrl+J)" disabled={!canModifySelection || selected.length < 2 || new Set(chosenClips.map(c=>c.trackId)).size>1} onClick={() => void join()}><LinkSimple size={18}/></IconButton><IconButton label="Hapus (Delete)" disabled={!canModifySelection} danger onClick={() => remove()}><Trash size={17}/></IconButton>
            <IconButton label="Buat crossfade" disabled={!canModifySelection || selected.length !== 2} onClick={() => { stop(); const before = project.crossfades?.length ?? 0; editor.edit('Buat crossfade', p => addCrossfades(p, selected)); if ((editor.get().project.crossfades?.length ?? 0) === before) notify('Pilih dua klip yang bertumpuk pada track yang sama.'); }}><Intersect size={18}/></IconButton>
            <div className="toolbar-spacer"/><button className="button audio-tools-trigger" aria-label="Alat audio" data-tooltip="Marker, hening, loudness, dan rekam" onClick={() => openTools()}><SlidersHorizontal size={17}/><span>Alat audio</span></button>
          </div>
          {range && <div className="range-toolbar" aria-label="Rentang terpilih"><NumberField label="Awal rentang" value={range.start} max={range.end - MIN_CLIP} onCommit={start => editor.setRange({ ...range, start })}/><NumberField label="Akhir rentang" value={range.end} min={range.start + MIN_CLIP} onCommit={end => editor.setRange({ ...range, end })}/><button className="button" onClick={isolate}>Pisahkan rentang</button><button className="button destructive" onClick={() => remove()}>Hapus rentang</button><button className="button" onClick={() => openExport('range')}>Ekspor rentang</button><button className="icon-button" aria-label="Batal seleksi rentang" onClick={() => editor.setRange(null)}><X size={15}/></button></div>}
          <div className="timeline-meta"><div className="timeline-heading"><span className="timeline-title">Timeline</span><span className="timeline-count">{project.tracks.length} track · {project.clips.length} klip</span></div><div className="timeline-view-actions"><IconButton label="Marker (M)" onClick={addMarker}><Flag size={15}/></IconButton><IconButton label="Loop (L)" active={project.loop?.enabled ?? false} onClick={toggleLoop}><Repeat size={17}/></IconButton><div className="separator"/><IconButton label="Snapping (N)" active={snap} onClick={() => setSnap(!snap)}><Magnet size={17}/></IconButton><RippleControls value={rippleScope} onChange={setRippleScope}/><div className="zoom-controls"><IconButton label="Perkecil timeline (-)" disabled={scale <= 4} onClick={() => setScale(Math.max(4, scale / 1.25))}><Minus size={14}/></IconButton><span>{Math.round(scale / 48 * 100)}%</span><IconButton label="Perbesar timeline (+)" disabled={scale >= 960} onClick={() => setScale(Math.min(960, scale * 1.25))}><Plus size={14}/></IconButton><IconButton label="Sesuaikan timeline (F)" onClick={fitTimeline}><CornersOut size={15}/></IconButton><IconButton label="Zoom ke seleksi (Shift+F)" disabled={!range && !selected.length} onClick={fitSelection}><Selection size={15}/></IconButton></div><WorkspaceControls sizes={sizes} onChange={(key, value) => setSizes(s => ({ ...s, [key]: value }))} follow={followPlayhead} onFollow={setFollowPlayhead}/><div className="panel-toggles"><button className="icon-button media-toggle" aria-label="Tampilkan media" data-tooltip="Tampilkan/sembunyikan media" aria-pressed={mediaVisible} onClick={()=>setPanel('media',!mediaVisible)}><SidebarSimple size={17}/></button><button className="icon-button properties-toggle" aria-label="Properti" data-tooltip="Tampilkan/sembunyikan properti" aria-expanded={wideWindow ? inspectorOpen : mobilePanel === 'properties'} onClick={()=>setPanel('properties',!inspectorVisible)}><SlidersHorizontal size={17}/></button><button className="icon-button help-button" aria-label="Shortcut" data-tooltip="Pintasan keyboard (?)" onClick={() => setModal('help')}><Keyboard size={17}/></button></div></div></div>
          <div className="timeline-stage">
            <Timeline rippleScope={rippleScope} onError={message=>notify(message,true)} trackHeight={sizes.trackHeight} onClipAction={clipAction} canPaste={!!clipboard.length} project={project} selected={selected} range={range} activeTrack={targetTrack} scale={scale} onScale={setScale} playhead={playing ? playhead.current : position} snap={snap} tool={tool} onSeek={seek} onSplit={split} onImport={(files, track, at) => void importFiles(files, track, at)} onTrack={setActiveTrack} onGesture={stop}/>
            {!project.clips.length && <div className="timeline-empty"><FileAudio size={25} weight="light"/><h2>Timeline kosong</h2><p>Tarik audio dari Media</p><button className="button" onClick={() => void importAudio()}><Plus size={15}/> Impor ke Media</button></div>}
          </div>
        </main>
        <Inspector playhead={playing?playhead.current:position} onSplit={split} zeroCross={zeroCross} onZeroCross={setZeroCross} safeCuts={safeCuts} onSafeCuts={setSafeCuts} rippleScope={rippleScope} onAction={action=>{if(selected[0])clipAction(action,selected[0]);}} resizer={<PanelResizer side="inspector" value={sizes.inspectorWidth} min={240} max={420} defaultValue={280} onChange={value => setSizes(s => ({ ...s, inspectorWidth: value }))} onResizing={setResizing}/>} project={project} selected={selected} onSeek={seek} inactive={wideWindow ? !inspectorOpen : mobilePanel !== 'properties'} onClose={() => { setPanel('properties',false); focusPanelTrigger('properties'); }}/>
      </div>
      <footer className="status-bar"><span className="file-state" aria-label="Status berkas proyek" data-tooltip={projectPath ?? `${project.name}.kura`}>{!hasSavedFile ? 'Berkas: belum disimpan' : dirty ? 'Berkas: ada perubahan' : fileOrigin === 'downloaded' ? 'Berkas: unduhan dibuat' : fileOrigin === 'opened' ? 'Berkas: dibuka' : 'Berkas: tersimpan'}</span><span aria-label="Status pemulihan">{preparing ? 'Menyiapkan denoise…' : autosaveState}</span><span>{selected.length ? `${selected.length} klip dipilih` : `${project.clips.length} klip`}<i/>{(project.sampleRate / 1000).toFixed(0)} kHz · Stereo</span><span>{appVersion}</span></footer>
    </div>}
      <input ref={audioInput} type="file" multiple accept="audio/*,.m4a,.flac,.aiff,.ogg" hidden data-testid="audio-input" onChange={e => { void importFiles(Array.from(e.target.files || [])); e.currentTarget.value = ''; }}/>
      <input ref={projectInput} type="file" accept=".kura" hidden data-testid="project-input" onChange={e => { const file = e.target.files?.[0]; if (file) void readAndOpenProject(file); e.currentTarget.value = ''; }}/>
    <Tooltip/>
    <Presence visible={!!toast}>{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Warning size={20}/> : <Check size={20}/>}<span>{toast.text}</span><button aria-label="Tutup notifikasi" onClick={() => setToast(null)}><X size={16}/></button></div>}</Presence>
    <Presence visible={!!busy}>{busy && <div className="busy-overlay" role="status" aria-live="polite"><div className="busy-card"><span className="spinner"/><p>{busy}</p></div></div>}</Presence>
    <Presence visible={modal==='settings'}><Modal kind="settings" title="Pengaturan aplikasi" onClose={()=>setModal(null)}><ApplicationSettings value={preferences} onChange={changePreferences} status={preferencesStatus}/></Modal></Presence>
    <Presence visible={modal==='about'}><Modal title="Tentang KurAudio" onClose={()=>setModal(null)}><div className="about-app"><BrandMark size={52}/><strong>KurAudio</strong><p>Versi {appVersion}</p><small>Editor audio lokal dengan timeline multi-track.</small></div></Modal></Presence>
    <Presence visible={modal === 'help'}><Modal kind="help" title="Pintasan keyboard" onClose={() => setModal(null)}><p className="modal-intro">Impor audio, geser ke posisi yang pas, lalu ekspor. Tarik ujung kiri atau kanan klip untuk trim. Tahan Shift saat memilih beberapa klip.</p><div className="shortcuts">{[['Menu aplikasi', 'F10 / Alt+F / Alt+E / Alt+W'], ['Pengaturan aplikasi', 'Ctrl+,'], ['Keluar aplikasi', 'Ctrl+Q'], ['Putar / jeda', 'Space'], ['Putar seleksi', 'Shift+Space'], ['Dengar sekitar playhead', 'Alt+Space'], ['Kembali ke awal playback', 'Shift+Enter'], ['Potong pada playhead', 'Ctrl+B / S'], ['Alat geser / potong / rentang', 'V / C / R'], ['Volume automation / detail presisi','G / P'], ['Grup / pisahkan grup','Ctrl+G / Ctrl+Shift+G'], ['Kunci / buka kunci klip','Ctrl+L'], ['Riwayat proyek','Ctrl+Shift+H'], ['Rentang semua track', 'Shift + tarik (R)'], ['Tambah marker / loop', 'M / L'], ['Marker sebelumnya / berikutnya', '[ / ]'], ['Simpan / simpan sebagai', 'Ctrl+S / Ctrl+Shift+S'], ['Proyek baru', 'Ctrl+N'], ['Buka proyek / impor audio', 'Ctrl+O / Ctrl+I'], ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Duplikat / sambung', 'Ctrl+D / Ctrl+J'], ['Copy / cut / paste', 'Ctrl+C / X / V'], ['Ekspor audio', 'Ctrl+E'], ['Hapus / ripple delete', 'Delete / Shift+Delete'], ['Pilih semua', 'Ctrl+A'], ['Zoom / sesuaikan', '+ − / F'], ['Zoom ke seleksi', 'Shift+F'], ['Zoom pada kursor', 'Ctrl + scroll'], ['Tambahkan media terfokus', 'Enter'], ['Preview media terfokus', 'Space'], ['Buka efek klip', 'E'], ['Snapping / abaikan saat drag', 'N / Alt'], ['Ke awal / akhir', 'Home / End']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="modal-note">Sambung menggabungkan klip pada track yang sama.</p></Modal></Presence>
    <Presence visible={modal === 'export'}><Modal kind="export" title="Ekspor audio" onClose={() => setModal(null)} busy={!!busy}>
      <ExportSettings project={project} range={range} selected={selected} scope={exportScope} setScope={value => { setExportScope(value); setPeakWarning(false); }} format={exportFormat} setFormat={value => { setExportFormat(value); setPeakWarning(false); }} name={exportName} setName={setExportName} sampleRate={sampleRate} setSampleRate={setSampleRate} bits={bits} setBits={setBits} bitrate={bitrate} setBitrate={setBitrate} normalize={normalize} setNormalize={value => { setNormalize(value); setPeakWarning(false); }}/>
      {peakWarning && <p className="export-warning"><Warning size={18}/> Peak melewati 0 dBFS. Aktifkan normalisasi untuk mencegah clipping.</p>}
      <div className="modal-actions"><button className="button subtle" onClick={() => setModal(null)}>Batal</button><button className="button primary" disabled={!!busy || !project.clips.length || !exportName.trim()} onClick={() => void doExport()}><ArrowDown size={18}/> Ekspor {exportFormat.toUpperCase()}</button></div>
    </Modal></Presence>
    <Presence visible={modal === 'tools'}><Modal kind="tools" title="Alat audio" onClose={() => { recorder.cancel(); setRecording(false); setModal(null); }} busy={recording}>
      <div className="session-tabs" role="tablist" aria-label="Alat audio" onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const values = ['markers','silence','loudness','record'] as const, index = values.indexOf(toolsTab), next = values[(index + (e.key === 'ArrowRight' ? 1 : 3)) % 4]; if (!recording) { setToolsTab(next); document.getElementById('session-tab-' + next)?.focus(); } } }}>
        {([['markers', 'Marker & loop'], ['silence', 'Pangkas hening'], ['loudness','Loudness'], ['record', 'Rekam']] as const).map(([value, label]) => <button key={value} id={'session-tab-' + value} role="tab" aria-selected={toolsTab === value} aria-controls="session-settings" tabIndex={toolsTab === value ? 0 : -1} disabled={recording && toolsTab !== value} onClick={() => setToolsTab(value)}>{label}</button>)}
      </div>
      <div id="session-settings" role="tabpanel" aria-labelledby={'session-tab-' + toolsTab}>
        {toolsTab === 'markers' && <MarkersPanel project={project} range={range} playhead={playhead.current} seek={seek}/>}
        {toolsTab === 'silence' && <SilencePanel project={project} clips={analysisClips} onDone={() => setModal(null)}/>}
        {toolsTab === 'loudness' && <LoudnessPanel project={project} selected={selected} onBeforeWork={stop} onApplied={()=>setNormalize(false)}/>}
        {toolsTab === 'record' && <RecordPanel trackName={project.tracks.find(t => t.id === targetTrack)?.locked?(project.tracks.length<MAX_TRACKS?'Track rekaman baru':'Media — batas track tercapai'):project.tracks.find(t => t.id === targetTrack)!.name} at={playhead.current} onCommit={commitRecording} onRecording={setRecording}/>}
      </div>
      {recording && <div className="modal-actions"><button className="button destructive" onClick={() => { recorder.cancel(); setRecording(false); setModal(null); }}>Batalkan rekaman</button></div>}
    </Modal></Presence>
    <Presence visible={modal === 'unsaved'}><Modal title="Simpan perubahan?" onClose={() => { pending.current = null; setModal(null); }} busy={!!busy}><p className="modal-intro">Perubahan pada <strong>{project.name}</strong> belum disimpan ke berkas proyek.</p><div className="modal-actions"><button className="button subtle" disabled={!!busy} onClick={() => { pending.current = null; setModal(null); }}>Batal</button><button className="button destructive" disabled={!!busy} onClick={async () => { const action = pending.current; pending.current = null; setModal(null); await action?.(); }}>Lanjut tanpa simpan</button><button className="button primary" disabled={!!busy} onClick={async () => { if (await saveCurrent()) { const action = pending.current; pending.current = null; setModal(null); await action?.(); } }}><FloppyDisk size={17}/> Simpan & lanjut</button></div></Modal></Presence>
    <Presence visible={modal === 'recovery'}><Modal title="Pulihkan sesi?" busy={!!busy} dismissible={false} onClose={() => {}}><p className="modal-intro">Sesi terakhir: <strong>{recovery.current?.project.name}</strong>.</p><div className="recovery-info"><Check size={20}/><span>{recovery.current?.project.clips.length} klip · {recovery.current ? new Date(recovery.current.time).toLocaleString('id-ID') : ''}</span></div><div className="modal-actions"><button className="button destructive" disabled={!!busy} onClick={async () => { if (operation.current) return; operation.current = true; setBusy('Menghapus pemulihan…'); try { await clearRecovery(recovery.current?.project.id); } catch (e) { notify(`Pemulihan tidak dapat dihapus: ${e}`, true); } finally { operation.current = false; setBusy(''); setModal(null); setReady(true); } }}>Mulai baru</button><button className="button primary" disabled={!!busy} onClick={async () => { if (operation.current) return; operation.current = true; setBusy('Memulihkan audio…'); try { const result = await decodeRecovery(recovery.current!); applyProject(result.project, result.decoded); setSavedStamp(''); setModal(null); setReady(true); notify('Sesi dipulihkan. Simpan sebagai .kura untuk menyimpan berkas proyek.'); } catch (e) { notify(`Pemulihan gagal: ${e}`, true); } finally { operation.current = false; setBusy(''); } }}>Pulihkan sesi <ArrowUpRight size={17}/></button></div></Modal></Presence>
  </>;
}
