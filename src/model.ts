export type Asset = { id: string; name: string; duration: number; sampleRate: number; channels: number };
export type Track = { id: string; name: string; gain: number; muted: boolean; solo: boolean; color: number; locked?: boolean };
export const effectKinds = ['denoise', 'reverb', 'room', 'echo', 'equalizer', 'compression'] as const;
export type EffectKind = typeof effectKinds[number];
export type Effects = { bypassed: boolean; denoise: number; reverb: number; decay: number; room: number; roomSize: 'small' | 'studio' | 'hall'; echo: number; echoTime: number; bass: number; treble: number; compression: number; enabled?: Partial<Record<EffectKind, boolean>> };
export const defaultEffects = (): Effects => ({ bypassed: false, denoise: 0, reverb: 0, decay: 1.8, room: 0, roomSize: 'studio', echo: 0, echoTime: 0.28, bass: 0, treble: 0, compression: 0 });
/** Missing flags preserve the sound of projects and presets written before 0.9. */
export function effectEnabled(f: Effects, kind: EffectKind): boolean {
  return f.enabled?.[kind] ?? (kind === 'equalizer' ? f.bass !== 0 || f.treble !== 0 : f[kind] > 0);
}
export function toggleEffect(f: Effects, kind: EffectKind, enabled: boolean): Effects {
  const next = { ...f, enabled: { ...f.enabled, [kind]: enabled } };
  // Only the first activation supplies a default. Later toggles restore even an intentional zero.
  if (enabled && f.enabled?.[kind] === undefined && kind !== 'equalizer' && f[kind] === 0)
    next[kind] = { denoise: 30, reverb: 20, room: 20, echo: 15, compression: 30 }[kind];
  return next;
}
export function resolveEffects(f: Effects = defaultEffects()): Effects {
  const next = { ...f };
  for (const kind of effectKinds) if (!effectEnabled(f, kind)) {
    if (kind === 'equalizer') { next.bass = 0; next.treble = 0; } else next[kind] = 0;
  }
  return next;
}
export function validEffectFlags(value: unknown): boolean {
  return value === undefined || !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, flag]) => effectKinds.includes(key as EffectKind) && typeof flag === 'boolean');
}
export type GainPoint = { time: number; gain: number };
export type Clip = { id: string; assetId: string; trackId: string; name: string; start: number; offset: number; duration: number; gain: number; fadeIn: number; fadeOut: number; fadeInStart?: number; fadeOutEnd?: number; effects?: Effects; curve?: GainPoint[]; locked?: boolean; groupId?: string; automation?: GainPoint[]; loudnessGain?: number };
export function curveGain(curve: GainPoint[] | undefined, time: number): number {
  if (!curve?.length) return 1;
  if (time <= curve[0].time) return curve[0].gain;
  const index = curve.findIndex(point => point.time >= time); if (index < 0) return curve.at(-1)!.gain;
  const a = curve[index - 1], b = curve[index]; return a.gain + (b.gain - a.gain) * (time - a.time) / (b.time - a.time);
}
function sliceCurve(curve: GainPoint[] | undefined, start: number, end: number): GainPoint[] | undefined {
  if (!curve?.length) return undefined;
  const points = curve.filter(point => point.time >= start && point.time <= end).map(point => ({ ...point, time: point.time - start }));
  const first = curveGain(curve, start), last = curveGain(curve, end);
  if (!points.length) return first === last ? [{ time: 0, gain: first }] : [{ time: 0, gain: first }, { time: end - start, gain: last }];
  // Implicit constant tails need no extra nodes. A new boundary replaces at least one omitted node.
  if (points[0].time > 0 && start > curve[0].time) points.unshift({ time: 0, gain: first });
  if (points.at(-1)!.time < end - start && end < curve.at(-1)!.time) points.push({ time: end - start, gain: last });
  return points;
}
export function effectTail(c: Clip): number { const f = resolveEffects(c.effects); return f.bypassed ? 0 : (f.compression > 0 ? 0.006 : 0) + (f.room > 0 ? 0.25 : 0) + (f.reverb > 0 ? f.decay : 0) + (f.echo > 0 ? f.echoTime * 5 : 0); }
export const renderEndTime = (p: Project) => p.clips.reduce((end, c) => Math.max(end, c.start + c.duration + effectTail(c)), 0);
export type AudioRange = { start: number; end: number; trackIds: string[] };
export type Marker = { id: string; name: string; time: number };
export type Crossfade = { id: string; leftId: string; rightId: string; duration: number };
export type Project = { id: string; name: string; sampleRate: number; tracks: Track[]; clips: Clip[]; assets: Asset[]; markers?: Marker[]; loop?: { start: number; end: number; enabled: boolean }; crossfades?: Crossfade[] };
export function crossfadeBounds(p: Project, fade: Crossfade) {
  const left = p.clips.find(c => c.id === fade.leftId), right = p.clips.find(c => c.id === fade.rightId);
  if (!left || !right || left.trackId !== right.trackId || left.start >= right.start || left.start + left.duration >= right.start + right.duration) return null;
  const overlap = left.start + left.duration - right.start;
  if (overlap < MIN_CLIP) return null;
  const duration = Math.min(fade.duration, overlap), end = left.start + left.duration;
  return { start: end - duration, end, duration, overlap, trackId: left.trackId };
}
export function reconcileCrossfades(p: Project) {
  if (p.crossfades) p.crossfades = p.crossfades.flatMap(fade => { const bounds = crossfadeBounds(p, fade); return bounds ? [{ ...fade, duration: bounds.duration }] : []; });
}
export function addCrossfades(p: Project, ids: string[]) {
  for (const left of p.clips) for (const right of p.clips) {
    if (!ids.includes(left.id) && !ids.includes(right.id)) continue;
    const fade = { id: uid(), leftId: left.id, rightId: right.id, duration: Math.min(left.duration, right.duration) };
    const bounds = crossfadeBounds(p, fade);
    if (bounds && !(p.crossfades ?? []).some(f => f.leftId === left.id || f.rightId === right.id)) (p.crossfades ??= []).push({ ...fade, duration: bounds.duration });
  }
}
/** Splitting a transition freezes its current envelope, so unrelated audio never changes. */
export function bakeCrossfades(p: Project, ids: string[]) {
  const fades = (p.crossfades ?? []).filter(f => ids.includes(f.leftId) || ids.includes(f.rightId));
  for (const fade of fades) {
    const bounds = crossfadeBounds(p, fade); if (!bounds) continue;
    for (const c of p.clips.filter(c => c.id === fade.leftId || c.id === fade.rightId)) {
      const previous = c.curve, marks = [0, c.duration, ...(previous ?? []).map(point => point.time)];
      for (let i = 0; i <= 64; i++) marks.push(bounds.start + bounds.duration * i / 64 - c.start);
      c.curve = [...new Set(marks)].filter(t => t >= 0 && t <= c.duration).sort((a,b) => a-b).map(time => {
        const phase = clamp((c.start + time - bounds.start) / bounds.duration, 0, 1);
        return { time, gain: curveGain(previous, time) * (c.id === fade.leftId ? Math.cos(phase * Math.PI / 2) : Math.sin(phase * Math.PI / 2)) };
      });
    }
  }
  if (fades.length) p.crossfades = p.crossfades!.filter(f => !fades.some(baked => baked.id === f.id));
}
export const uid = () => crypto.randomUUID();
export const MIN_CLIP = 0.02;
export const MAX_TRACKS = 128;
export const MAX_RENDER_SECONDS = 900;
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (gain: number) => gain <= 0 ? -60 : 20 * Math.log10(gain);
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const endTime = (p: Project) => p.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
export function makeTrack(index: number): Track {
  return { id: uid(), name: `Track ${index + 1}`, color: index, gain: 1, muted: false, solo: false };
}
export function emptyProject(): Project {
  return { id: uid(), name: 'Proyek tanpa judul', sampleRate: 48000, assets: [], clips: [], tracks: ['Voice over', 'Musik', 'Efek suara'].map((name, color) => ({ id: uid(), name, color, gain: 1, muted: false, solo: false })) };
}
export function makeClip(asset: Asset, trackId: string, start: number): Clip {
  return { id: uid(), assetId: asset.id, trackId, name: asset.name.replace(/\.[^.]+$/, ''), start: Math.max(0, start), offset: 0, duration: asset.duration, gain: 1, fadeIn: 0, fadeOut: 0 };
}
export function fitFades(c: Clip): Clip {
  if (c.curve) c = { ...c, curve: sliceCurve(c.curve, 0, c.duration) };
  if (c.automation) c = { ...c, automation: sliceCurve(c.automation, 0, c.duration) };
  const total = c.fadeIn + c.fadeOut;
  return total > c.duration ? { ...c, fadeIn: c.fadeIn / total * c.duration, fadeOut: c.fadeOut / total * c.duration } : c;
}
export function trimClip(c: Clip, side: 'left' | 'right', delta: number, sourceDuration: number): Clip {
  if (side === 'left') {
    const d = clamp(delta, Math.max(-c.offset, -c.start), c.duration - MIN_CLIP);
    return fitFades({ ...c, start: c.start + d, offset: c.offset + d, duration: c.duration - d, ...(c.curve ? { curve: sliceCurve(c.curve, d, c.duration) } : {}), ...(c.automation ? { automation: sliceCurve(c.automation, d, c.duration) } : {}) });
  }
  return fitFades({ ...c, duration: clamp(c.duration + delta, MIN_CLIP, sourceDuration - c.offset) });
}
export function splitClip(c: Clip, time: number): Clip[] {
  const d = time - c.start;
  if (d < MIN_CLIP || c.duration - d < MIN_CLIP) return [c];
  const left: Clip = { ...c, duration: d, fadeOut: 0, fadeOutEnd: undefined };
  const right: Clip = { ...c, id: uid(), start: time, offset: c.offset + d, duration: c.duration - d, fadeIn: 0, fadeInStart: undefined };
  if (c.curve) { left.curve = sliceCurve(c.curve, 0, d); right.curve = sliceCurve(c.curve, d, c.duration); }
  if (c.automation) { left.automation = sliceCurve(c.automation, 0, d); right.automation = sliceCurve(c.automation, d, c.duration); }
  if (d < c.fadeIn) {
    const start = c.fadeInStart ?? 0, boundary = start + (1 - start) * d / c.fadeIn;
    left.gain = c.gain * boundary; left.fadeIn = d; left.fadeInStart = boundary ? start / boundary : 0;
    right.fadeIn = c.fadeIn - d; right.fadeInStart = boundary;
  }
  if (d > c.duration - c.fadeOut) {
    const end = c.fadeOutEnd ?? 0, boundary = end + (1 - end) * right.duration / c.fadeOut;
    left.fadeOut = d - (c.duration - c.fadeOut); left.fadeOutEnd = boundary;
    right.gain = c.gain * boundary; right.fadeOut = right.duration; right.fadeOutEnd = boundary ? end / boundary : 0;
  }
  return [left, right];
}
export function deleteClips(p: Project, selected: string[], ripple: boolean | 'off' | 'track' | 'all'): Project {
  const selectedIds = new Set(selected), selectedGroups = new Set(p.clips.filter(c => selectedIds.has(c.id) && c.groupId).map(c => c.groupId));
  const locked = (c: Clip) => !!c.locked || !!p.tracks.find(t => t.id === c.trackId)?.locked;
  const lockedGroups = new Set(p.clips.filter(locked).flatMap(c => c.groupId ? [c.groupId] : []));
  const lockedMember = (c: Clip) => locked(c) || !!c.groupId && lockedGroups.has(c.groupId);
  const linkedIds = new Set((p.crossfades ?? []).filter(f => p.clips.some(c => (c.id === f.leftId || c.id === f.rightId) && lockedMember(c))).flatMap(f => [f.leftId, f.rightId]));
  const protectedClip = (c: Clip) => lockedMember(c) || linkedIds.has(c.id);
  const removed = p.clips.filter(c => (selectedIds.has(c.id) || c.groupId && selectedGroups.has(c.groupId)) && !protectedClip(c));
  const removedIds = new Set(removed.map(c => c.id)), clips = p.clips.filter(c => !removedIds.has(c.id)).map(c => ({ ...c }));
  const shifts = new Map<string, number>();
  if (ripple && ripple !== 'off') {
    for (const track of p.tracks.filter(t => !t.locked)) {
      const intervals = removed.filter(c => ripple === 'all' || c.trackId === track.id).sort((a, b) => a.start - b.start);
      const merged: [number, number][] = [];
      for (const c of intervals) {
        const last = merged.at(-1);
        if (last && c.start <= last[1]) last[1] = Math.max(last[1], c.start + c.duration);
        else merged.push([c.start, c.start + c.duration]);
      }
      for (const c of clips.filter(c => c.trackId === track.id && !protectedClip(c))) shifts.set(c.id, merged.reduce((n, [a, b]) => n + (b <= c.start + 1e-7 ? b - a : 0), 0));
    }
    for (const c of clips) {
      const amount = shifts.get(c.id) ?? 0;
      if (!c.groupId || clips.filter(member => member.groupId === c.groupId).every(member => (shifts.get(member.id) ?? 0) === amount)) c.start = Math.max(0, c.start - amount);
    }
  }
  const result = { ...p, clips }; reconcileCrossfades(result); return result;
}
export function snapTime(time: number, p: Project, moving: string[], playhead: number, pixelsPerSecond: number, length = 0, options: { grid?: boolean; threshold?: number } = {}): number {
  const targets = [0, playhead, ...p.clips.filter(c => !moving.includes(c.id)).flatMap(c => [c.start, c.start + c.duration])];
  const grid = pixelsPerSecond >= 150 ? 0.1 : pixelsPerSecond >= 35 ? 0.5 : 1;
  if (options.grid !== false) targets.push(Math.round(time / grid) * grid, Math.round((time + length) / grid) * grid);
  let best = time, distance = (options.threshold ?? 8) / pixelsPerSecond;
  for (const t of targets) for (const candidate of length ? [t, t - length] : [t]) {
    if (candidate >= 0 && Math.abs(candidate - time) < distance) { best = candidate; distance = Math.abs(candidate - time); }
  }
  return Math.max(0, best);
}
export function formatTime(time: number, precise = false): string {
  const n = Math.max(0, time || 0);
  const m = Math.floor(n / 60).toString().padStart(2, '0');
  const s = Math.floor(n % 60).toString().padStart(2, '0');
  return `${m}:${s}${precise ? '.' + Math.floor((n % 1) * 1000).toString().padStart(3, '0') : ''}`;
}

export function validateProject(value: unknown): Project {
  const p = value as Project;
  const fail = () => { throw new Error('Proyek rusak atau memiliki nilai yang tidak didukung.'); };
  const finite = (n: unknown, low = 0, high = 1e7): n is number => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
  const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 512;
  if (!p || !text(p.id) || !text(p.name) || ![44100, 48000].includes(p.sampleRate) || !Array.isArray(p.assets) || !Array.isArray(p.clips) || !Array.isArray(p.tracks) || p.tracks.length < 1 || p.tracks.length > MAX_TRACKS || p.clips.length > 10000 || p.assets.length > 1000) fail();
  const tracks = new Set<string>(), assets = new Map<string, Asset>(), clips = new Set<string>();
  for (const t of p.tracks) {
    if (!t || typeof t !== 'object') fail();
    if (!text(t.id) || tracks.has(t.id) || !text(t.name) || !finite(t.gain, 0, 4) || typeof t.muted !== 'boolean' || typeof t.solo !== 'boolean' || !Number.isInteger(t.color) || !finite(t.color, 0, 127) || (t.locked !== undefined && typeof t.locked !== 'boolean')) fail();
    tracks.add(t.id);
  }
  for (const a of p.assets) {
    if (!a || typeof a !== 'object') fail();
    if (!text(a.id) || assets.has(a.id) || !text(a.name) || !finite(a.duration, MIN_CLIP, 7200) || !finite(a.sampleRate, 8000, 192000) || !Number.isInteger(a.channels) || !finite(a.channels, 1, 8)) fail();
    assets.set(a.id, a);
  }
  for (const c of p.clips) {
    if (!c || typeof c !== 'object') fail();
    const a = assets.get(c.assetId);
    if (!a || !tracks.has(c.trackId) || !text(c.id) || clips.has(c.id) || !text(c.name) || !finite(c.start) || !finite(c.offset) || !finite(c.duration, MIN_CLIP) || c.offset + c.duration > a.duration + 0.01 || !finite(c.gain, 0, 4) || !finite(c.fadeIn) || !finite(c.fadeOut) || c.fadeIn + c.fadeOut > c.duration + 1e-6 || (c.fadeInStart !== undefined && !finite(c.fadeInStart, 0, 1)) || (c.fadeOutEnd !== undefined && !finite(c.fadeOutEnd, 0, 1))) fail();
    clips.add(c.id);
    // Baked transitions and safe-cut tapers add samples beyond the editable automation budget.
    if (c.curve !== undefined && (!Array.isArray(c.curve) || c.curve.length > 8192 || c.curve.some((point, index) => !point || !finite(point.time, 0, c.duration) || !finite(point.gain, 0, 1) || index > 0 && point.time <= c.curve![index-1].time))) fail();
    if ((c.locked !== undefined && typeof c.locked !== 'boolean') || (c.groupId !== undefined && !text(c.groupId)) || (c.loudnessGain !== undefined && !finite(c.loudnessGain, 0, 16))) fail();
    if (c.automation !== undefined && (!Array.isArray(c.automation) || c.automation.length > 4096 || c.automation.some((point, index) => !point || !finite(point.time, 0, c.duration) || !finite(point.gain, 0, 2) || index > 0 && point.time <= c.automation![index-1].time))) fail();
    if (c.effects !== undefined) {
      const f = c.effects;
      if (!f || typeof f.bypassed !== 'boolean' || !validEffectFlags(f.enabled) || !['small', 'studio', 'hall'].includes(f.roomSize) || !finite(f.decay, 0.2, 6) || !finite(f.echoTime, 0.05, 1) || !finite(f.bass, -12, 12) || !finite(f.treble, -12, 12) || !['denoise','reverb','room','echo','compression'].every(key => finite(f[key as keyof Effects], 0, 100))) fail();
    }
  }
  if (p.markers !== undefined) {
    if (!Array.isArray(p.markers) || p.markers.length > 1024) fail();
    const ids = new Set<string>();
    for (const marker of p.markers) { if (!marker || !text(marker.id) || ids.has(marker.id) || !text(marker.name) || !finite(marker.time)) fail(); ids.add(marker.id); }
  }
  if (p.loop !== undefined && (!p.loop || !finite(p.loop.start) || !finite(p.loop.end) || p.loop.end - p.loop.start < MIN_CLIP - 1e-8 || p.loop.end - p.loop.start > MAX_RENDER_SECONDS + 1e-8 || typeof p.loop.enabled !== 'boolean')) fail();
  if (p.crossfades !== undefined) {
    if (!Array.isArray(p.crossfades) || p.crossfades.length > 10000) fail();
    const ids = new Set<string>(), lefts = new Set<string>(), rights = new Set<string>();
    for (const fade of p.crossfades) {
      if (!fade || !text(fade.id) || ids.has(fade.id) || lefts.has(fade.leftId) || rights.has(fade.rightId) || !finite(fade.duration, MIN_CLIP) || !crossfadeBounds(p, fade)) fail();
      ids.add(fade.id); lefts.add(fade.leftId); rights.add(fade.rightId);
    }
  }
  return structuredClone(p);
}

export type HistoryEntry = { id: string; label: string; time: number; current: boolean };
type Snapshot = { project: Project; selected: string[]; range: AudioRange | null; revision: number; undoCount: number; redoCount: number; label: string; history: HistoryEntry[] };
type HistoryState = { id: string; label: string; time: number; project: Project };

/** Recipes cannot bypass a lock by deleting, splitting, unlocking-and-editing, or editing the source. */
function respectsLocks(before: Project, after: Project): boolean {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const withoutLock = <T extends { locked?: boolean }>(value: T) => { const { locked: _locked, ...rest } = value; return rest; };
  const trackIds = new Set(before.tracks.filter(t => t.locked).map(t => t.id));
  const protectedClips = before.clips.filter(c => c.locked || trackIds.has(c.trackId));
  if (protectedClips.length && before.sampleRate !== after.sampleRate) return false;
  for (const track of before.tracks.filter(t => trackIds.has(t.id))) {
    const next = after.tracks.find(t => t.id === track.id);
    // A track lock protects its arrangement; mixing and audition controls stay usable.
    if (!next) return false;
    if (after.clips.some(c => c.trackId === track.id && !before.clips.some(old => old.id === c.id && old.trackId === track.id))) return false;
  }
  for (const clip of protectedClips) {
    const next = after.clips.find(c => c.id === clip.id);
    if (!next || !same(withoutLock(clip), withoutLock(next))) return false;
    if (!same(before.assets.find(a => a.id === clip.assetId), after.assets.find(a => a.id === clip.assetId))) return false;
  }
  const protectedIds = new Set(protectedClips.map(c => c.id));
  const linked = (p: Project) => (p.crossfades ?? []).filter(f => protectedIds.has(f.leftId) || protectedIds.has(f.rightId));
  if (!same(linked(before), linked(after))) return false;
  const lockedGroups = new Set(protectedClips.flatMap(c => c.groupId ? [c.groupId] : []));
  for (const clip of before.clips.filter(c => c.groupId && lockedGroups.has(c.groupId))) {
    const next = after.clips.find(c => c.id === clip.id);
    if (!next || next.start !== clip.start || next.trackId !== clip.trackId || next.offset !== clip.offset || next.duration !== clip.duration || next.groupId !== clip.groupId) return false;
  }
  return true;
}

class EditorStore {
  private listeners = new Set<() => void>();
  private state: Snapshot = { project: emptyProject(), selected: [], range: null, revision: 0, undoCount: 0, redoCount: 0, label: '', history: [] };
  private timeline: HistoryState[] = [this.entry(this.state.project, 'Proyek baru')];
  private cursor = 0;
  constructor() { this.state.history = this.history(); }
  private entry(project: Project, label: string): HistoryState { return { id: uid(), label, time: Date.now(), project }; }
  private history(): HistoryEntry[] { return this.timeline.map(({ id, label, time }, index) => ({ id, label, time, current: index === this.cursor })); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  get = () => this.state;
  private emit(part: Partial<Snapshot>) { this.state = { ...this.state, ...part, undoCount: this.cursor, redoCount: this.timeline.length - this.cursor - 1, history: this.history() }; this.listeners.forEach(fn => fn()); }
  select(ids: string[]) {
    const selected = new Set(ids), groups = new Set(this.state.project.clips.filter(c => selected.has(c.id) && c.groupId).map(c => c.groupId));
    this.emit({ selected: this.state.project.clips.filter(c => selected.has(c.id) || c.groupId && groups.has(c.groupId)).map(c => c.id), range: null });
  }
  setRange(range: AudioRange | null) { this.emit({ range, selected: [] }); }
  edit(label: string, recipe: (draft: Project) => void) {
    const project = structuredClone(this.state.project);
    recipe(project);
    if (!respectsLocks(this.state.project, project)) return;
    reconcileCrossfades(project);
    if (!respectsLocks(this.state.project, project)) return;
    if (JSON.stringify(project) === JSON.stringify(this.state.project)) return;
    validateProject(project);
    this.timeline = this.timeline.slice(0, this.cursor + 1);
    this.timeline.push(this.entry(project, label));
    if (this.timeline.length > 100) this.timeline.shift();
    this.cursor = this.timeline.length - 1;
    this.emit({ project, revision: this.state.revision + 1, label, selected: this.state.selected.filter(id => project.clips.some(c => c.id === id)) });
  }
  private visit(index: number, label: string, preserveContext = false) {
    this.cursor = index;const project=this.timeline[index].project;
    const selected=preserveContext?this.state.selected.filter(id=>project.clips.some(c=>c.id===id)):[];
    const arrangement=(p:Project)=>p.clips.map(c=>[c.id,c.assetId,c.trackId,c.start,c.offset,c.duration]);
    const sameArrangement=JSON.stringify(arrangement(project))===JSON.stringify(arrangement(this.state.project));
    let range=preserveContext&&sameArrangement&&this.state.range?{...this.state.range,trackIds:this.state.range.trackIds.filter(id=>project.tracks.some(t=>t.id===id)),end:Math.min(this.state.range.end,endTime(project))}:null;
    if(range&&(!range.trackIds.length||range.end-range.start<MIN_CLIP))range=null;
    this.emit({ project, selected, range, revision: this.state.revision + 1, label });
  }
  undo() { if (this.cursor > 0) this.visit(this.cursor - 1, 'Undo', true); }
  redo() { if (this.cursor < this.timeline.length - 1) this.visit(this.cursor + 1, 'Redo', true); }
  jumpToHistory(id: string): boolean { const index = this.timeline.findIndex(entry => entry.id === id); if (index < 0) return false; if (index !== this.cursor) this.visit(index, this.timeline[index].label); return true; }
  load(project: Project) { const validated = validateProject(project); this.timeline = [this.entry(validated, 'Buka proyek')]; this.cursor = 0; this.emit({ project: validated, selected: [], range: null, revision: this.state.revision + 1, label: 'Buka proyek' }); }
}
export const editor = new EditorStore();
