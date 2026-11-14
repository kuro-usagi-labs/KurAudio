import {it,expect} from 'vitest';
import {editor,emptyProject,makeClip} from './model';
it('undo and redo retain surviving selected clip IDs; history jump clears context',()=>{
 const p=emptyProject(),a={id:'asset',name:'tone',duration:4,sampleRate:16000,channels:1};p.assets=[a];p.clips=[makeClip(a,p.tracks[0].id,0),makeClip(a,p.tracks[1].id,0)];editor.load(p);const ids=p.clips.map(c=>c.id);editor.select(ids);editor.edit('Gain',d=>{d.tracks[0].gain=.5;});editor.undo();expect(editor.get().selected).toEqual(ids);editor.redo();expect(editor.get().selected).toEqual(ids);editor.edit('Remove',d=>{d.clips.pop();});editor.undo();expect(editor.get().selected).toEqual([ids[0]]);editor.jumpToHistory(editor.get().history[0].id);expect(editor.get().selected).toEqual([]);
});
it('undo clamps a retained range to surviving track IDs and project extent',()=>{
 const p=emptyProject(),a={id:'asset',name:'tone',duration:4,sampleRate:16000,channels:1};p.assets=[a];p.clips=[makeClip(a,p.tracks[0].id,0)];editor.load(p);editor.edit('Name',d=>{d.name='Renamed';});editor.setRange({start:1,end:8,trackIds:[p.tracks[0].id,'gone']});editor.undo();expect(editor.get().range).toEqual({start:1,end:4,trackIds:[p.tracks[0].id]});
});
