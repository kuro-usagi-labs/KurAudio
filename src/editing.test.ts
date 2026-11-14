import { describe, it, expect } from 'vitest';
import { emptyProject, makeClip, addCrossfades, crossfadeBounds, reconcileCrossfades, validateProject, editor } from './model';
import { copyRange, isolateRange, deleteRange, moveRange, mergeIntervals, removeSilences } from './editing';
import { detectSilence } from './silenceDetection';
import { projectEnvelope, envelope } from './audio';
import { encodeRecordedWav } from './recording';
function fixture() { const p = emptyProject(), asset = { id: 'source', name: 'voice.wav', duration: 10, sampleRate: 16000, channels: 1 }; p.assets = [asset]; p.clips = [makeClip(asset, p.tracks[0].id, 1)]; return p; }
describe('range editing', () => {
  it('isolates a middle segment with exact source continuity', () => { const p = fixture(), ids = isolateRange(p, { start: 3, end: 6, trackIds: [p.tracks[0].id] }); expect(p.clips.map(c => [c.start,c.offset,c.duration])).toEqual([[1,0,2],[3,2,3],[6,5,5]]); expect(ids).toEqual([p.clips[1].id]); });
  it('preserves original fade values across a range split', () => { const p = fixture(), original = { ...p.clips[0], fadeIn: 4, fadeOut: 4 }; p.clips = [original]; isolateRange(p, { start: 3, end: 9, trackIds: [p.tracks[0].id] }); for (const c of p.clips) for (let t=0.001;t<c.duration;t+=0.07) expect(envelope(c,t)).toBeCloseTo(envelope(original,c.start-original.start+t),5); });
  it('deletes only the selected time and track', () => { const p = fixture(); p.clips.push({ ...p.clips[0], id:'music', trackId:p.tracks[1].id }); deleteRange(p,{start:3,end:6,trackIds:[p.tracks[0].id]}); expect(p.clips.filter(c=>c.trackId===p.tracks[0].id).map(c=>[c.start,c.duration])).toEqual([[1,2],[6,5]]); expect(p.clips.find(c=>c.id==='music')!.duration).toBe(10); });
  it('ripple deletion collapses the range and later clips in that track', () => { const p = fixture(); p.clips.push({...p.clips[0], id:'later',start:15}); deleteRange(p,{start:3,end:6,trackIds:[p.tracks[0].id]},true); expect(p.clips.map(c=>c.start)).toEqual([1,3,12]); });
  it('moves the interior independently while retaining both neighbours', () => { const p=fixture(),ids=moveRange(p,{start:3,end:6,trackIds:[p.tracks[0].id]},4);expect(p.clips.find(c=>ids.includes(c.id))).toMatchObject({start:7,offset:2,duration:3});expect(p.clips.filter(c=>!ids.includes(c.id)).map(c=>c.start)).toEqual([1,6]); });
  it('copies a range without mutating the source project', () => { const p=fixture(),before=JSON.stringify(p),clips=copyRange(p,{start:3,end:6,trackIds:[p.tracks[0].id]});expect(clips[0]).toMatchObject({start:3,offset:2,duration:3});expect(JSON.stringify(p)).toBe(before); });
  it('unions overlapping silence candidates before ripple removal', () => { const p=fixture();removeSilences(p,[{start:3,end:5,trackId:p.tracks[0].id},{start:4,end:6,trackId:p.tracks[0].id}],true);expect(p.clips.map(c=>[c.start,c.duration])).toEqual([[1,2],[3,5]]);expect(mergeIntervals([{start:1,end:2},{start:2,end:3}])).toEqual([{start:1,end:3}]); });
  it('clears a range when undoing so a stale range cannot delete later audio', () => { const p=fixture();editor.load(p);editor.setRange({start:3,end:6,trackIds:[p.tracks[0].id]});editor.edit('range',draft=>deleteRange(draft,editor.get().range!));editor.undo();expect(editor.get().range).toBeNull();expect(editor.get().project.clips).toHaveLength(1); });
});
describe('crossfade and project metadata', () => {
  it('uses equal-power envelopes with no power dip between unrelated signals', () => { const p=fixture();p.clips[0].duration=5;p.clips.push({...makeClip(p.assets[0],p.tracks[0].id,4),duration:5});addCrossfades(p,p.clips.map(c=>c.id));expect(p.crossfades).toHaveLength(1);const f=p.crossfades![0],b=crossfadeBounds(p,f)!;expect(b).toMatchObject({start:4,end:6,duration:2});for(let t=4;t<=6;t+=0.1){const left=projectEnvelope(p,p.clips[0],t-1),right=projectEnvelope(p,p.clips[1],t-4);expect(left*left+right*right).toBeCloseTo(1,8);} });
  it('does not create fades for unrelated tracks or nested clips', () => { const p=fixture();p.clips.push({...p.clips[0],id:'nested',start:3,duration:2});addCrossfades(p,['nested']);expect(p.crossfades??[]).toHaveLength(0);p.clips[1].trackId=p.tracks[1].id;addCrossfades(p,['nested']);expect(p.crossfades??[]).toHaveLength(0); });
  it('removes stale crossfade links after a clip leaves the overlap', () => { const p=fixture();p.clips[0].duration=5;p.clips.push({...makeClip(p.assets[0],p.tracks[0].id,4),duration:5});addCrossfades(p,[p.clips[1].id]);p.clips[1].start=20;reconcileCrossfades(p);expect(p.crossfades).toEqual([]); });
  it('reads old projects and roundtrips marker/loop metadata', () => {const p=fixture();expect(validateProject(p)).toEqual(p);p.markers=[{id:'m',name:'Take 1',time:2.4}];p.loop={start:1,end:3,enabled:true};expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);p.markers[0].time=NaN;expect(()=>validateProject(p)).toThrow();});
  it('retains the audible transition when splitting across a crossfade', () => {
    const p=fixture();p.clips[0].duration=5;p.clips.push({...makeClip(p.assets[0],p.tracks[0].id,4),duration:5});addCrossfades(p,p.clips.map(c=>c.id));const original=structuredClone(p);
    isolateRange(p,{start:3.8,end:4.8,trackIds:[p.tracks[0].id]});validateProject(p);
    const sum=(project:typeof p,time:number)=>project.clips.filter(c=>time>=c.start&&time<c.start+c.duration).reduce((gain,c)=>gain+projectEnvelope(project,c,time-c.start),0);
    for(let time=1.01;time<8.99;time+=0.013)expect(sum(p,time)).toBeCloseTo(sum(original,time),3);
  });
});
describe('silence detection and recording PCM',()=>{
  const rate=16000, options={threshold:-40,minimum:0.35,keep:0.12};
  it('retains the requested pause while removing long silence',()=>{const samples=new Float32Array(rate*3);for(let i=0;i<rate;i++)samples[i]=0.2;for(let i=rate*2;i<samples.length;i++)samples[i]=0.2;expect(detectSilence([samples],rate,options)).toEqual([{start:1.06,end:1.94}]);});
  it('does not misclassify opposite stereo phases as silence',()=>{const left=new Float32Array(rate).fill(0.2),right=new Float32Array(rate).fill(-0.2);expect(detectSilence([left,right],rate,options)).toEqual([]);});
  it('does not remove pauses shorter than the minimum or below the kept length',()=>{const data=new Float32Array(rate).fill(0.2);data.fill(0,rate*0.3,rate*0.5);expect(detectSilence([data],rate,options)).toEqual([]);expect(detectSilence([new Float32Array(rate/2)],rate,{...options,keep:0.6})).toEqual([]);});
  it('writes real mono PCM16 recording headers and clamps samples',()=>{const bytes=encodeRecordedWav(new Float32Array([-2,-0.25,0.25,2]),rate),view=new DataView(bytes.buffer);expect(view.getUint16(22,true)).toBe(1);expect(view.getUint32(24,true)).toBe(rate);expect(view.getUint16(34,true)).toBe(16);expect(view.getInt16(44,true)).toBe(-32768);expect(view.getInt16(50,true)).toBe(32767);});
});
