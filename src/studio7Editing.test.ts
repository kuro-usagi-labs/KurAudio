import { describe, expect, it } from 'vitest';
import { editor, emptyProject, makeClip, trimClip, splitClip, validateProject, deleteClips, addCrossfades, type Project } from './model';
import * as editing from './editing';

function fixture(): Project {
  const p = emptyProject(), asset = { id: 'source', name: 'voice.wav', duration: 20, sampleRate: 48000, channels: 2 };
  p.assets = [asset];
  p.clips = [['a', 1, 0], ['b', 5, 0], ['c', 9, 0], ['music', 9, 1]].map(([id, start, track]) => ({ ...makeClip(asset, p.tracks[Number(track)].id, Number(start)), id: String(id), duration: 2 }));
  return p;
}

describe('Studio 7 metadata and editable envelopes', () => {
  it('rejects corrupt lock, group, automation and loudness metadata', () => {
    for (const value of [{ locked: 'yes' }, { groupId: '' }, { loudnessGain: 17 }, { automation: [{ time: 0, gain: 3 }] }, { automation: [{ time: 1, gain: 1 }, { time: 1, gain: 0 }] }, { automation: [{ time: 3, gain: 1 }] }]) {
      const p = fixture(); Object.assign(p.clips[0], value); expect(() => validateProject(p)).toThrow();
    }
    const p = fixture(); Object.assign(p.tracks[0], { locked: 'yes' }); expect(() => validateProject(p)).toThrow();
  });
  it('slices independent automation and baked gain on trims and repeated splits', () => {
    const p = fixture(), c = { ...p.clips[0], duration: 8, curve: [{ time: 0, gain: 0 }, { time: 8, gain: 1 }], automation: [{ time: 0, gain: 2 }, { time: 8, gain: 0 }] };
    const trimmed = trimClip(c, 'left', 2, 20);
    expect(trimmed.curve).toEqual([{ time: 0, gain: 0.25 }, { time: 6, gain: 1 }]);
    expect(trimmed.automation).toEqual([{ time: 0, gain: 1.5 }, { time: 6, gain: 0 }]);
    const [left, right] = splitClip(c, 5);
    expect(left.automation).toEqual([{ time: 0, gain: 2 }, { time: 4, gain: 1 }]);
    expect(right.automation).toEqual([{ time: 0, gain: 1 }, { time: 4, gain: 0 }]);
    expect(trimClip(right, 'right', -2, 20).automation).toEqual([{ time: 0, gain: 1 }, { time: 2, gain: 0.5 }]);
    expect(validateProject({ ...p, clips: [c] }).clips[0].automation).toEqual(c.automation);
  });
  it('keeps a full valid automation envelope editable without overflowing its point budget', () => {
    const p = fixture(); p.clips = [{ ...p.clips[0], duration: 8, automation: Array.from({ length: 4096 }, (_, i) => ({ time: 0.1 + i * 7 / 4095, gain: i % 2 })) }];
    validateProject(p); p.clips[0] = trimClip(p.clips[0], 'right', -0.1, 20); expect(() => validateProject(p)).not.toThrow();
    expect(p.clips[0].automation?.length).toBeLessThanOrEqual(4096);
  });
});

describe('central locked-audio protection', () => {
  it('blocks arbitrary recipes that mutate, delete, split or change the source of locked audio', () => {
    const p = fixture(); Object.assign(p.clips[0], { locked: true });
    for (const recipe of [(d: Project) => { d.clips[0].gain = 2; }, (d: Project) => { d.clips.shift(); }, (d: Project) => { d.clips = d.clips.flatMap(c => c.id === 'a' ? splitClip(c, 2) : [c]); }, (d: Project) => { d.assets[0].duration = 21; }]) {
      editor.load(p); editor.edit('Forbidden', recipe); expect(editor.get().project).toEqual(p); expect(editor.get().undoCount).toBe(0);
    }
    editor.edit('Unlock', d => { Object.assign(d.clips[0], { locked: false }); });
    editor.edit('Gain', d => { d.clips[0].gain = 2; }); expect(editor.get().project.clips[0].gain).toBe(2);
  });
  it('protects a locked track from inserted clips and removal', () => {
    const p = fixture(); Object.assign(p.tracks[0], { locked: true });
    for (const recipe of [(d: Project) => { d.clips.push({ ...d.clips[0], id: 'new' }); }, (d: Project) => { d.tracks.shift(); d.clips = d.clips.filter(c => c.trackId !== p.tracks[0].id); }]) {
      editor.load(p); editor.edit('Forbidden', recipe); expect(editor.get().project).toEqual(p);
    }
    editor.edit('Unlock track', d => { Object.assign(d.tracks[0], { locked: false }); }); expect(editor.get().undoCount).toBe(1);
  });
  it('keeps locked-track mixing and audition controls available', () => {
    const p = fixture(); p.tracks[0].locked = true; editor.load(p);
    editor.edit('Audition', d => { Object.assign(d.tracks[0], { gain: 0.5, muted: true, solo: true, name: 'Voice', color: 3 }); });
    expect(editor.get().project.tracks[0]).toMatchObject({ locked: true, gain: 0.5, muted: true, solo: true, name: 'Voice', color: 3 });
    editor.edit('Protected clip gain', d => { d.clips[0].gain = 0.5; }); expect(editor.get().project.clips[0].gain).toBe(1);
  });
  it('keeps a group with a locked member together even through arbitrary movement recipes', () => {
    const p = fixture(); Object.assign(p.clips[0], { groupId: 'g', locked: true }); Object.assign(p.clips[1], { groupId: 'g' });
    editor.load(p); editor.edit('Partial move', d => { d.clips[1].start = 6; }); expect(editor.get().project.clips[1].start).toBe(5);
    editor.edit('Break locked group', d => { delete d.clips[1].groupId; }); expect(editor.get().project.clips[1].groupId).toBe('g');
    editor.edit('Partial trim', d => { d.clips[1].duration = 1; }); expect(editor.get().project.clips[1].duration).toBe(2);
  });
  it('prevents changing the project clock or transitions that change locked audio', () => {
    const p = fixture(); p.clips[0].duration = 5; p.clips[1].start = 4; p.clips[1].duration = 5; addCrossfades(p, ['a', 'b']); p.clips[0].locked = true;
    editor.load(p); editor.edit('Clock', d => { d.sampleRate = 44100; }); expect(editor.get().project.sampleRate).toBe(48000);
    editor.edit('Remove transition', d => { d.crossfades = []; }); expect(editor.get().project.crossfades).toHaveLength(1);
  });
});

describe('named bounded history', () => {
  it('jumps across edits with coherent undo, redo and a new branch', () => {
    editor.load(fixture()); const initial = editor.get().history[0].id;
    editor.edit('Move', d => { d.clips[0].start = 2; }); const moved = editor.get().history.find(h => h.current)!;
    editor.edit('Rename', d => { d.name = 'Renamed'; }); const renamed = editor.get().history.find(h => h.current)!;
    expect(moved.label).toBe('Move'); expect(Number.isFinite(moved.time)).toBe(true);
    expect(editor.jumpToHistory(initial)).toBe(true); expect(editor.get().undoCount).toBe(0); expect(editor.get().redoCount).toBe(2);
    editor.redo(); expect(editor.get().project.clips[0].start).toBe(2); expect(editor.get().project.name).not.toBe('Renamed');
    expect(editor.jumpToHistory(renamed.id)).toBe(true); expect(editor.get().project.name).toBe('Renamed');
    editor.undo(); expect(editor.get().history.find(h => h.current)?.id).toBe(moved.id);
    editor.edit('Branch', d => { d.clips[1].gain = 0.5; }); expect(editor.jumpToHistory(renamed.id)).toBe(false); expect(editor.get().redoCount).toBe(0);
  });
  it('bounds retained snapshots and never creates entries for no-ops', () => {
    editor.load(fixture()); const first = editor.get().history[0].id;
    for (let i = 0; i < 110; i++) editor.edit('Gain', d => { d.clips[0].gain = i % 2 ? 0.5 : 1; });
    expect(editor.get().history).toHaveLength(100); expect(editor.jumpToHistory(first)).toBe(false);
    const ids = editor.get().history.map(h => h.id); editor.edit('No-op', () => {}); expect(editor.get().history.map(h => h.id)).toEqual(ids);
    expect(editor.get().history.filter(h => h.current)).toHaveLength(1);
  });
});

describe('group-aware ripple operations', () => {
  it('expands groups, remaps copies consistently and ungroups the whole selection', () => {
    const p = fixture(); editing.groupClips(p, ['a', 'b']); const group = p.clips[0].groupId;
    expect(group).toBeTruthy(); expect(editing.expandedSelection(p, ['a'])).toEqual(['a', 'b']);
    const copies = editing.freshClipCopies(p.clips.slice(0, 2)); expect(copies[0].groupId).toBe(copies[1].groupId); expect(copies[0].groupId).not.toBe(group); expect(copies.map(c => c.id)).not.toContain('a');
    editing.ungroupClips(p, ['b']); expect(p.clips[0].groupId).toBeUndefined(); expect(p.clips[1].groupId).toBeUndefined();
    editing.setClipsLocked(p, ['a'], true); expect(editing.isClipLocked(p, p.clips[0])).toBe(true);
  });
  it('moves a group with one shared clamp and ripples only followers in the selected scope', () => {
    const p = fixture(); editing.groupClips(p, ['a', 'b']); editing.moveClips(p, ['b'], -2, { ripple: 'all' });
    expect(p.clips.map(c => c.start)).toEqual([0, 4, 8, 8]);
    editing.setClipsLocked(p, ['a'], true); const before = structuredClone(p); editing.moveClips(p, ['b'], 3); expect(p).toEqual(before);
  });
  it('blocks locked destinations and leaves locked ripple followers stationary', () => {
    const p = fixture(); p.tracks[1].locked = true; editing.moveClips(p, ['a'], 2, { destinationTrackId: p.tracks[1].id }); expect(p.clips[0].start).toBe(1);
    p.clips[2].locked = true; editing.moveClips(p, ['a'], 2, { ripple: 'all' }); expect(p.clips.map(c => c.start)).toEqual([3, 7, 9, 9]);
  });
  it('retains relative tracks using the input anchor and appends tracks for a multitrack group', () => {
    const p = fixture(); p.clips[1].trackId = p.tracks[1].id; editing.groupClips(p, ['a', 'b']);
    editing.moveClips(p, ['b'], 1, { destinationTrackId: p.tracks[2].id });
    expect(p.clips[0].trackId).toBe(p.tracks[1].id); expect(p.clips[1].trackId).toBe(p.tracks[2].id);
    editing.moveClips(p, ['a'], 1, { destinationTrackId: p.tracks[2].id });
    expect(p.tracks).toHaveLength(4); expect(p.clips[1].trackId).toBe(p.tracks[3].id);
  });
  it('deletes expanded groups and ripples all tracks without deleting or moving locked clips', () => {
    const p = fixture(); editing.groupClips(p, ['a', 'b']); p.clips[2].locked = true;
    const next = deleteClips(p, ['a'], 'all'); expect(next.clips.map(c => [c.id, c.start])).toEqual([['c', 9], ['music', 5]]);
    p.clips[1].locked = true; expect(deleteClips(p, ['a'], true)).toEqual(p);
  });
  it('right trim ripples by the actual source-clamped delta and left trim retains its end', () => {
    const p = fixture(); editing.trimClipInProject(p, 'a', 'right', 100, 4, true);
    expect(p.clips.map(c => [c.start, c.duration])).toEqual([[1, 4], [7, 2], [11, 2], [9, 2]]);
    editing.trimClipInProject(p, 'a', 'left', 1, 4, 'all'); expect(p.clips[0]).toMatchObject({ start: 2, offset: 1, duration: 3 }); expect(p.clips[1].start).toBe(7);
  });
  it('inserts a block by opening a gap and slicing spanning envelopes', () => {
    const p = fixture(); p.clips = [{ ...p.clips[0], start: 0, duration: 10, automation: [{ time: 0, gain: 0 }, { time: 10, gain: 2 }] }, p.clips[3]];
    const incoming = { ...makeClip(p.assets[0], p.tracks[0].id, 12), id: 'insert', duration: 2 };
    editing.insertClips(p, [incoming], 4, 'track');
    expect(p.clips.filter(c => c.id !== 'music').map(c => [c.start, c.offset, c.duration]).sort((a,b) => a[0] - b[0])).toEqual([[0, 0, 4], [4, 0, 2], [6, 4, 6]]);
    expect(p.clips.find(c => c.start === 6)?.automation).toEqual([{ time: 0, gain: 0.8 }, { time: 6, gain: 2 }]); expect(p.clips.find(c => c.id === 'music')?.start).toBe(9);
    validateProject(p);
  });
  it('insertion shifts all fragments of a spanning grouped clip without stretching or losing the group', () => {
    const p = fixture(); p.clips = [{ ...p.clips[0], start: 0, duration: 10, groupId: 'g' }, { ...p.clips[1], start: 10, duration: 2, groupId: 'g' }];
    editing.insertClips(p, [{ ...makeClip(p.assets[0], p.tracks[0].id, 0), id: 'insert', duration: 2 }], 4, true);
    expect(p.clips.filter(c => c.id !== 'insert').map(c => [c.start, c.duration])).toEqual([[0, 4], [6, 6], [12, 2]]);
  });
  it('range mutation skips locked audio while copying can still audition or duplicate it', () => {
    const p = fixture(); p.clips[0].locked = true;
    const range = { start: 1.5, end: 2.5, trackIds: [p.tracks[0].id] };
    expect(editing.copyRange(p, range)).toHaveLength(1);
    editing.deleteRange(p, range, 'all'); expect(p.clips.find(c => c.id === 'a')).toMatchObject({ start: 1, duration: 2, locked: true }); expect(p.clips.find(c => c.id === 'music')?.start).toBe(8);
  });
  it('isolates a fresh range group so selection and movement exclude outside group fragments', () => {
    const p = fixture(); p.clips[0].duration = 8; p.clips[1].trackId = p.tracks[1].id; p.clips[1].start = 1; p.clips[1].duration = 8;
    editing.groupClips(p, ['a', 'b']); const originalGroup = p.clips[0].groupId;
    const ids = editing.isolateRange(p, { start: 3, end: 6, trackIds: p.tracks.slice(0, 2).map(t => t.id) });
    const inside = p.clips.filter(c => ids.includes(c.id)), outside = p.clips.filter(c => !ids.includes(c.id));
    expect(inside).toHaveLength(2); expect(inside[0].groupId).toBeTruthy(); expect(inside[0].groupId).toBe(inside[1].groupId); expect(inside[0].groupId).not.toBe(originalGroup);
    expect(outside.filter(c => ['a', 'b'].includes(c.id))).toHaveLength(2); expect(outside.filter(c => c.groupId === originalGroup)).toHaveLength(4);
    editor.load(p); editor.select(ids); expect(editor.get().selected).toEqual(ids);
    editing.moveClips(p, ids, 2); expect(inside.map(c => c.start)).toEqual([5, 5]); expect(outside.filter(c => c.groupId === originalGroup).map(c => c.start)).toEqual([1, 6, 1, 6]);
  });
  it('range helpers cannot bake or remove a transition attached to a locked partner', () => {
    const p = fixture(); p.clips[0].duration = 5; p.clips[1].start = 4; p.clips[1].duration = 5; addCrossfades(p, ['a', 'b']); p.clips[0].locked = true;
    const before = structuredClone(p); editing.isolateRange(p, { start: 4.2, end: 4.8, trackIds: [p.tracks[0].id] }); expect(p).toEqual(before);
    const moved = structuredClone(before); editing.moveClips(moved, ['b'], 2); expect(moved).toEqual(before);
  });
});
