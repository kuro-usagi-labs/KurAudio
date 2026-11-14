import { type AudioRange, type Clip, type Project, MIN_CLIP, MAX_TRACKS, splitClip, trimClip, makeTrack, uid, reconcileCrossfades, bakeCrossfades } from './model';

export type RippleScope = 'off' | 'track' | 'all';
type Ripple = RippleScope | boolean;
const scopeOf = (scope: Ripple | undefined): RippleScope => scope === true ? 'track' : !scope || scope === 'off' ? 'off' : scope;

export function isClipLocked(p: Project, clip: Clip): boolean { return !!clip.locked || !!p.tracks.find(t => t.id === clip.trackId)?.locked; }

export function expandedSelection(p: Project, ids: string[]): string[] {
  const selected = new Set(ids), groups = new Set(p.clips.filter(c => selected.has(c.id) && c.groupId).map(c => c.groupId));
  return p.clips.filter(c => selected.has(c.id) || c.groupId && groups.has(c.groupId)).map(c => c.id);
}

function hasLockedGroupMember(p: Project, clip: Clip): boolean {
  return isClipLocked(p, clip) || !!clip.groupId && p.clips.some(c => c.groupId === clip.groupId && isClipLocked(p, c));
}

export function isArrangementLocked(p: Project, clip: Clip): boolean {
  if (hasLockedGroupMember(p, clip)) return true;
  return (p.crossfades ?? []).some(f => (f.leftId === clip.id || f.rightId === clip.id) && p.clips.some(c => (c.id === f.leftId || c.id === f.rightId) && hasLockedGroupMember(p, c)));
}
const arrangementLocked = isArrangementLocked;

export function groupClips(p: Project, ids: string[]): void {
  const selection = new Set(expandedSelection(p, ids)), clips = p.clips.filter(c => selection.has(c.id));
  if (clips.length < 2 || clips.some(c => hasLockedGroupMember(p, c))) return;
  const groupId = uid(); for (const clip of clips) clip.groupId = groupId;
}

export function ungroupClips(p: Project, ids: string[]): void {
  const selection = new Set(expandedSelection(p, ids));
  for (const clip of p.clips) if (selection.has(clip.id) && !hasLockedGroupMember(p, clip)) delete clip.groupId;
}

export function setClipsLocked(p: Project, ids: string[], locked: boolean): void {
  const selection = new Set(expandedSelection(p, ids)); for (const clip of p.clips) if (selection.has(clip.id)) clip.locked = locked;
}

export function freshClipCopies(clips: Clip[]): Clip[] {
  const groups = new Map<string, string>();
  return structuredClone(clips).map(clip => {
    if (clip.groupId) { if (!groups.has(clip.groupId)) groups.set(clip.groupId, uid()); clip.groupId = groups.get(clip.groupId)!; }
    return { ...clip, id: uid() };
  });
}

function rippleCandidates(p: Project, editedTracks: Set<string>, threshold: number, scope: Ripple, excluded = new Set<string>(), preserveGroupBoundary = true): Clip[] {
  const mode = scopeOf(scope); if (mode === 'off') return [];
  const eligible = (c: Clip) => !excluded.has(c.id) && !arrangementLocked(p, c) && c.start >= threshold - 1e-7 && (mode === 'all' || editedTracks.has(c.trackId));
  // A group crossing the ripple boundary stays intact rather than shifting only some members.
  return p.clips.filter(c => eligible(c) && (!preserveGroupBoundary || !c.groupId || p.clips.filter(member => member.groupId === c.groupId).every(eligible)));
}

export function moveClips(p: Project, ids: string[], delta: number, options: { ripple?: Ripple; destinationTrackId?: string } = {}): void {
  if (!Number.isFinite(delta)) return;
  const selection = new Set(expandedSelection(p, ids)), moving = p.clips.filter(c => selection.has(c.id));
  if (!moving.length || moving.some(c => arrangementLocked(p, c))) return;
  const amount = Math.max(-Math.min(...moving.map(c => c.start)), delta);
  const tracks = new Set(moving.map(c => c.trackId));
  const end = Math.max(...moving.map(c => c.start + c.duration));
  const targets = new Map<string, number>();
  if (options.destinationTrackId !== undefined) {
    const anchor = p.clips.find(c => c.id === ids[0]) ?? moving[0];
    const destination = p.tracks.findIndex(t => t.id === options.destinationTrackId), origin = p.tracks.findIndex(t => t.id === anchor.trackId);
    if (destination < 0 || origin < 0) return;
    for (const c of moving) {
      const index = p.tracks.findIndex(t => t.id === c.trackId) + destination - origin;
      if (index < 0 || index >= MAX_TRACKS || p.tracks[index]?.locked) return;
      targets.set(c.id, index);
    }
    const last = Math.max(...targets.values()); while (p.tracks.length <= last) p.tracks.push(makeTrack(p.tracks.length));
    for (const index of targets.values()) tracks.add(p.tracks[index].id);
  }
  const followers = rippleCandidates(p, tracks, end, options.ripple ?? 'off', selection);
  for (const c of moving) { c.start += amount; const index = targets.get(c.id); if (index !== undefined) c.trackId = p.tracks[index].id; }
  for (const c of followers) c.start = Math.max(0, c.start + amount);
  reconcileCrossfades(p);
}

export function trimClipInProject(p: Project, id: string, side: 'left' | 'right', delta: number, sourceDuration: number, ripple: Ripple = 'off'): void {
  const clip = p.clips.find(c => c.id === id); if (!clip || arrangementLocked(p, clip) || !Number.isFinite(delta) || !Number.isFinite(sourceDuration)) return;
  const next = trimClip(clip, side, delta, sourceDuration);
  if (side === 'right') {
    const amount = next.duration - clip.duration;
    for (const c of rippleCandidates(p, new Set([clip.trackId]), clip.start + clip.duration, ripple, new Set([id]))) c.start = Math.max(0, c.start + amount);
  }
  p.clips = p.clips.map(c => c.id === id ? next : c); reconcileCrossfades(p);
}

export function insertClips(p: Project, clips: Clip[], at: number, ripple: Ripple = 'off'): string[] {
  if (!clips.length || !Number.isFinite(at)) return [];
  const atTime = Math.max(0, at), incoming = structuredClone(clips), tracks = new Set(incoming.map(c => c.trackId));
  if (incoming.some(c => !p.tracks.some(t => t.id === c.trackId && !t.locked)) || incoming.some(c => p.clips.some(existing => existing.id === c.id))) return [];
  const origin = Math.min(...incoming.map(c => c.start));
  const width = Math.max(...incoming.map(c => c.start + c.duration)) - origin;
  if (scopeOf(ripple) !== 'off') {
    const mode = scopeOf(ripple);
    const spanning = p.clips.filter(c => !arrangementLocked(p, c) && (mode === 'all' || tracks.has(c.trackId)) && c.start < atTime && c.start + c.duration > atTime);
    // An insertion cannot create an invalid sliver at either side of a cut.
    if (spanning.some(c => atTime - c.start < MIN_CLIP || c.start + c.duration - atTime < MIN_CLIP)) return [];
    bakeCrossfades(p, spanning.map(c => c.id));
    const spanningIds = new Set(spanning.map(c => c.id));
    p.clips = p.clips.flatMap(c => spanningIds.has(c.id) ? splitClip(c, atTime) : [c]);
    for (const c of rippleCandidates(p, tracks, atTime, ripple, new Set(), false)) c.start += width;
  }
  for (const c of incoming) c.start = atTime + c.start - origin;
  p.clips.push(...incoming); reconcileCrossfades(p); return incoming.map(c => c.id);
}

export function isolateRange(p: Project, range: AudioRange): string[] {
  return isolateRangeInternal(p, range, false);
}
function isolateRangeInternal(p: Project, range: AudioRange, allowLocked: boolean): string[] {
  const editable = (c: Clip) => allowLocked || !arrangementLocked(p, c);
  bakeCrossfades(p, p.clips.filter(c => editable(c) && range.trackIds.includes(c.trackId) && c.start < range.end && c.start + c.duration > range.start).map(c => c.id));
  const ids: string[] = [], isolatedGroups = new Map<string, string>();
  p.clips = p.clips.flatMap(clip => {
    if (!editable(clip) || !range.trackIds.includes(clip.trackId) || clip.start >= range.end || clip.start + clip.duration <= range.start) return [clip];
    const pieces = splitClip(clip, range.start).flatMap(piece => splitClip(piece, range.end));
    for (const piece of pieces) if (piece.start + piece.duration / 2 >= range.start && piece.start + piece.duration / 2 < range.end) {
      if (piece.groupId) { const original = piece.groupId; if (!isolatedGroups.has(original)) isolatedGroups.set(original, uid()); piece.groupId = isolatedGroups.get(original)!; }
      ids.push(piece.id);
    }
    return pieces;
  });
  reconcileCrossfades(p); return ids;
}
export function deleteRange(p: Project, range: AudioRange, ripple: Ripple = false) {
  const ids = isolateRange(p, range);
  p.clips = p.clips.filter(c => !ids.includes(c.id));
  for (const c of rippleCandidates(p, new Set(range.trackIds), range.end, ripple, new Set(), false)) c.start = Math.max(range.start, c.start - (range.end - range.start));
  reconcileCrossfades(p);
}
export function moveRange(p: Project, range: AudioRange, delta: number): string[] {
  const ids = isolateRange(p, range), amount = Math.max(-range.start, delta);
  for (const c of p.clips) if (ids.includes(c.id)) c.start += amount;
  reconcileCrossfades(p); return ids;
}
export function copyRange(p: Project, range: AudioRange): Clip[] {
  const draft = structuredClone(p), ids = isolateRangeInternal(draft, range, true);
  return freshClipCopies(draft.clips.filter(c => ids.includes(c.id)));
}
export function mergeIntervals(intervals: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const interval of [...intervals].filter(r => r.end - r.start >= MIN_CLIP).sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end); else merged.push({ ...interval });
  }
  return merged;
}
export function removeSilences(p: Project, intervals: { trackId: string; start: number; end: number }[], ripple: Ripple) {
  for (const track of p.tracks) for (const interval of mergeIntervals(intervals.filter(r => r.trackId === track.id)).reverse()) deleteRange(p, { ...interval, trackIds: [track.id] }, ripple);
}
