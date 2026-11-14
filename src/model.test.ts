import { describe, it, expect, beforeEach } from 'vitest';
import { emptyProject, makeClip, splitClip, trimClip, fitFades, deleteClips, snapTime, validateProject, editor, endTime, type Asset, type Project } from './model';
import { envelope, encodeWav, encodeFloatWav } from './audio';
const asset: Asset = { id: 'asset', name: 'Voice.wav', duration: 10, sampleRate: 48000, channels: 2 };
function fixture() { const p = emptyProject(); p.assets.push(asset); p.clips.push(makeClip(asset, p.tracks[0].id, 2)); return p; }
describe('nondestructive timeline', () => {
  it('splits with exact source continuity', () => { const c = fixture().clips[0], [a,b] = splitClip(c, 5); expect(a.duration).toBe(3); expect(b.start).toBe(5); expect(b.offset).toBe(3); expect(b.duration).toBe(7); expect(c.duration).toBe(10); });
  it('does not create empty slivers at clip boundaries', () => { const c = fixture().clips[0]; expect(splitClip(c, 2.001)).toEqual([c]); expect(splitClip(c, 12)).toEqual([c]); });
  it('clamps left trim to source and timeline zero', () => { const c = { ...fixture().clips[0], offset: 1, duration: 9 }; expect(trimClip(c, 'left', -100, 10)).toMatchObject({ start: 1, offset: 0, duration: 10 }); });
  it('clamps right trim to source duration and minimum length', () => { const c = fixture().clips[0]; expect(trimClip(c, 'right', 100, 10).duration).toBe(10); expect(trimClip(c, 'right', -100, 10).duration).toBe(0.02); });
  it('keeps fade lengths inside trimmed audio', () => { const c = { ...fixture().clips[0], fadeIn: 3, fadeOut: 3 }; const t = trimClip(c, 'right', -9, 10); expect(t.fadeIn + t.fadeOut).toBeCloseTo(1); });
  it('retains exact fades when splitting inside a fade or splitting twice', () => {
    for (const split of [2.4, 7, 11.6]) {
      const c = { ...fixture().clips[0], fadeIn: 2, fadeOut: 2, gain: 0.8 };
      const pieces = splitClip(c, split);
      expect(pieces).toHaveLength(2);
      for (const part of pieces) for (let t = 0.001; t < part.duration; t += 0.04) expect(envelope(part,t)).toBeCloseTo(envelope(c,part.start - c.start+t), 6);
      const more = pieces.flatMap(p => splitClip(p, p.start + p.duration / 2));
      for (const part of more) for (let t = 0.001; t < part.duration; t += 0.05) expect(envelope(part,t)).toBeCloseTo(envelope(c,part.start - c.start+t), 6);
    }
  });
  it('ripple delete uses the union of overlapping selections on each track', () => {
    const p = fixture(), t = p.tracks[0].id; p.clips = [{ ...makeClip(asset,t,0), id:'a', duration:3 }, { ...makeClip(asset,t,2), id:'b', duration:3 }, { ...makeClip(asset,t,7), id:'c', duration:2 }, makeClip(asset,p.tracks[1].id,7)];
    const next = deleteClips(p,['a','b'],true); expect(next.clips.find(c=>c.id==='c')!.start).toBe(2); expect(next.clips[1].start).toBe(7);
  });
  it('normal delete leaves later clips in place', () => { const p = fixture(); p.clips.push(makeClip(asset,p.tracks[0].id,20)); expect(deleteClips(p,[p.clips[0].id],false).clips[0].start).toBe(20); });
  it('snaps to other clip edges and excludes dragged clips', () => { const p = fixture(); expect(snapTime(11.96,p,[],0,50)).toBe(12); expect(snapTime(2.04,p,[p.clips[0].id],0,200)).toBe(2.04); });
  it('snaps the end of a moving clip', () => { const p = fixture(); expect(snapTime(8.97,p,[],0,50,3)).toBe(9); });
  it('lets trim retain precise positions while snapping to actual edit boundaries', () => {
    const p = fixture(), options = { grid: false, threshold: 4 };
    expect(snapTime(3.44,p,[p.clips[0].id],0,48,0,options)).toBe(3.44);
    expect(snapTime(3.44,p,[p.clips[0].id],3.48,48,0,options)).toBe(3.48);
    expect(snapTime(11.96,p,[],0,48,0,options)).toBe(12);
  });
  it('roundtrips project validation without sharing mutable state', () => { const p = fixture(), validated = validateProject(JSON.parse(JSON.stringify(p))); validated.name = 'Changed'; expect(p.name).not.toBe('Changed'); });
  it.each(['start','offset','duration','gain','fadeIn','fadeOut'])('rejects non-finite %s', field => { const p = fixture(); (p.clips[0] as unknown as Record<string,unknown>)[field] = NaN; expect(()=>validateProject(p)).toThrow(); });
  it('rejects missing media and duplicate IDs', () => { const p = fixture(); p.clips[0].assetId='missing'; expect(()=>validateProject(p)).toThrow(); const q=fixture(); q.clips.push({...q.clips[0]}); expect(()=>validateProject(q)).toThrow(); });
  it('rejects trims past source and overlapping fades', () => { const p=fixture(); p.clips[0].offset=2; expect(()=>validateProject(p)).toThrow(); const q=fixture(); q.clips[0].fadeIn=8; q.clips[0].fadeOut=8; expect(()=>validateProject(q)).toThrow(); });
});
describe('transaction history', () => {
  beforeEach(()=>editor.load(fixture()));
  it('undo and redo restore an entire editing transaction', ()=> { const before=editor.get().project; editor.edit('Move',p=>{p.clips[0].start=7;p.clips[0].trackId=p.tracks[1].id;}); editor.undo(); expect(editor.get().project).toEqual(before); editor.redo(); expect(editor.get().project.clips[0].start).toBe(7); });
  it('ignores no-ops and clears redo after a new branch', ()=> { editor.edit('No-op',()=>{}); expect(editor.get().undoCount).toBe(0); editor.edit('Move',p=>{p.clips[0].start=3;});editor.undo();editor.edit('Rename',p=>{p.name='Other';});expect(editor.get().redoCount).toBe(0); });
});
describe('PCM WAV encoder', () => {
  const buffer = { length: 4, numberOfChannels: 2, sampleRate: 48000, getChannelData: (ch:number) => new Float32Array(ch ? [1,0.5,-0.5,-1] : [-1,-0.5,0.5,1]) } as AudioBuffer;
  it.each([16,24])('writes stereo %s-bit little endian headers and full-scale sample extrema', bits => {
    const {bytes,peak}=encodeWav(buffer,bits), view=new DataView(bytes.buffer); expect(peak).toBe(1); expect(new TextDecoder().decode(bytes.subarray(0,4))).toBe('RIFF'); expect(view.getUint32(24,true)).toBe(48000);expect(view.getUint16(22,true)).toBe(2); expect(view.getUint16(34,true)).toBe(bits);expect(bytes.length).toBe(44+4*2*bits/8);
    if(bits===16) {expect(view.getInt16(44,true)).toBe(-32768);expect(view.getInt16(46,true)).toBe(32767);} else {expect([...bytes.subarray(44,50)]).toEqual([0,0,128,255,255,127]);}
  });
  it('normalizes the final peak to -1 dBFS',()=>{const {bytes}=encodeWav(buffer,16,true); expect(new DataView(bytes.buffer).getInt16(46,true)/32767).toBeCloseTo(Math.pow(10,-1/20),4);});
  it('preserves unclipped headroom in internal joined assets',()=>{const b={...buffer,getChannelData:()=>new Float32Array([1.8,-1.6,0,0.5])} as AudioBuffer;const bytes=encodeFloatWav(b),v=new DataView(bytes.buffer);expect(v.getUint16(20,true)).toBe(3);expect(v.getUint16(34,true)).toBe(32);expect(v.getFloat32(44,true)).toBeCloseTo(1.8);expect(v.getFloat32(52,true)).toBeCloseTo(-1.6);});
});
