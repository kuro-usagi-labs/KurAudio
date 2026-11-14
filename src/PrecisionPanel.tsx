import {useLayoutEffect,useRef,useState,useId} from 'react';
import {MagnifyingGlassMinus,MagnifyingGlassPlus,Scissors} from '@phosphor-icons/react';
import {type Project,type Clip,clamp,MIN_CLIP} from './model';
import {editor} from './model';
import {media} from './audio';
import {isArrangementLocked,trimClipInProject,type RippleScope} from './editing';
import {nearestZeroCrossing} from './precision';
import {CheckField} from './CheckField';
import {pointerGesture} from './TimelineOverlays';
import {onAppearanceChange} from './appearance';

type Props={project:Project;clip:Clip;playhead:number;onSeek:(time:number)=>void;onSplit:(time:number,id:string)=>void;zeroCross:boolean;onZeroCross:(v:boolean)=>void;safeCuts:boolean;onSafeCuts:(v:boolean)=>void;rippleScope:RippleScope};
export function PrecisionPanel({project,clip,playhead,onSeek,onSplit,zeroCross,onZeroCross,safeCuts,onSafeCuts,rippleScope}:Props){
 const canvas=useRef<HTMLCanvasElement>(null),cleanup=useRef<(()=>void)|undefined>(undefined),cancelBlur=useRef(false),id=useId();
 const buffer=media.get(clip.assetId)?.buffer,rate=buffer?.sampleRate??project.sampleRate;
 const [span,setSpan]=useState(.2),[draft,setDraft]=useState<string|null>(null),[gestureLeft,setGestureLeft]=useState<number|null>(null);
 const cursor=clamp(playhead,clip.start,clip.start+clip.duration),local=cursor-clip.start,windowSpan=Math.min(span,clip.duration),left=gestureLeft??clamp(local-windowSpan/2,0,Math.max(0,clip.duration-windowSpan));
 const locked=isArrangementLocked(project,clip),inside=cursor>clip.start+MIN_CLIP&&cursor<clip.start+clip.duration-MIN_CLIP;
 const point=(time:number)=>{let next=clamp(clip.start+Math.round((clip.offset+time-clip.start)*rate)/rate-clip.offset,clip.start,clip.start+clip.duration);if(zeroCross&&buffer){const source=clip.offset+next-clip.start;next=clip.start+nearestZeroCrossing(Array.from({length:buffer.numberOfChannels},(_,ch)=>buffer.getChannelData(ch)),rate,source)-clip.offset;}return clamp(next,clip.start,clip.start+clip.duration);};
 useLayoutEffect(()=>{
  const el=canvas.current;if(!el||!buffer)return;const draw=()=>{const r=el.getBoundingClientRect(),width=Math.max(1,r.width),height=Math.max(1,r.height),dpr=Math.min(2,devicePixelRatio||1);el.width=width*dpr;el.height=height*dpr;const ctx=el.getContext('2d')!;ctx.scale(dpr,dpr);const style=getComputedStyle(el),color=style.getPropertyValue('--action-primary').trim(),grid=style.getPropertyValue('--border-default').trim();ctx.clearRect(0,0,width,height);ctx.strokeStyle=grid;ctx.lineWidth=1;
   const channels=Math.min(2,buffer.numberOfChannels);for(let ch=0;ch<channels;ch++){const data=buffer.getChannelData(ch),baseline=height/channels*(ch+.5),amplitude=height/channels*.38;ctx.beginPath();ctx.moveTo(0,baseline);ctx.lineTo(width,baseline);ctx.stroke();ctx.strokeStyle=color;ctx.beginPath();const first=(clip.offset+left)*rate,samples=windowSpan*rate;for(let x=0;x<width;x++){const a=Math.max(0,Math.floor(first+x/width*samples)),b=Math.min(data.length,Math.max(a+1,Math.ceil(first+(x+1)/width*samples)));let lo=1,hi=-1;for(let i=a;i<b;i++){lo=Math.min(lo,data[i]);hi=Math.max(hi,data[i]);}if(hi<lo)lo=hi=0;ctx.moveTo(x,baseline-hi*amplitude);ctx.lineTo(x,baseline-lo*amplitude);}ctx.stroke();ctx.strokeStyle=grid;}
   const x=(local-left)/windowSpan*width;ctx.strokeStyle=style.getPropertyValue('--track-1').trim();ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(x-4,0);ctx.lineTo(x+4,0);ctx.lineTo(x,6);ctx.fill();
  };const observer=new ResizeObserver(draw);observer.observe(el);const stopAppearance=onAppearanceChange(draw);draw();return()=>{stopAppearance();observer.disconnect();};
 },[buffer,clip.offset,left,windowSpan,local]);
 useLayoutEffect(()=>()=>cleanup.current?.(),[]);
 const trim=(side:'left'|'right')=>{if(locked||!buffer)return;const delta=side==='left'?cursor-clip.start:cursor-clip.start-clip.duration;editor.edit(side==='left'?'Trim awal presisi':'Trim akhir presisi',p=>trimClipInProject(p,clip.id,side,delta,buffer.duration,rippleScope));onSeek(cursor);};
 const commit=()=>{if(cancelBlur.current){cancelBlur.current=false;return;}if(draft!==null&&draft.trim()!==''&&Number.isFinite(Number(draft)))onSeek(point(Number(draft)));setDraft(null);};
 return <section className="precision-panel" aria-label="Edit presisi">
  <div className="precision-heading"><span>Detail waveform</span><div><button className="icon-button" aria-label="Perkecil detail waveform" disabled={span>=2} onClick={()=>setSpan(v=>Math.min(2,v*2))}><MagnifyingGlassMinus size={16}/></button><output>{windowSpan<.1?`${(windowSpan*1000).toFixed(1)} ms`:`${windowSpan.toFixed(2)} s`}</output><button className="icon-button" aria-label="Perbesar detail waveform" disabled={span<=8/rate} onClick={()=>setSpan(v=>Math.max(8/rate,v/2))}><MagnifyingGlassPlus size={16}/></button></div></div>
  <canvas ref={canvas} data-testid="precision-waveform" className="precision-waveform" role="slider" tabIndex={0} aria-label="Titik edit presisi" aria-describedby={id} aria-valuemin={clip.start} aria-valuemax={clip.start+clip.duration} aria-valuenow={Number(cursor.toFixed(6))} aria-valuetext={`${cursor.toFixed(6)} detik`} onPointerDown={e=>{if(e.button!==0)return;const rect=e.currentTarget.getBoundingClientRect(),original=cursor;setGestureLeft(left);const seek=(x:number)=>onSeek(point(clip.start+left+clamp((x-rect.left)/rect.width,0,1)*windowSpan));seek(e.clientX);cleanup.current=pointerGesture(e,event=>seek(event.clientX),()=>setGestureLeft(null),()=>{onSeek(original);setGestureLeft(null);});}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();onSeek(e.key==='Home'?clip.start:e.key==='End'?clip.start+clip.duration:point(cursor+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1)/rate));}}}/>
  <div className="precision-ruler"><span>{(clip.start+left).toFixed(4)}</span><span>{(clip.start+left+windowSpan).toFixed(4)} s</span></div>
  <label className="precision-cursor">Titik edit<input aria-label="Posisi edit presisi" type="number" step={1/rate} min={clip.start} max={clip.start+clip.duration} value={draft??Number(cursor.toFixed(6))} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){commit();e.currentTarget.blur();}if(e.key==='Escape'){e.stopPropagation();cancelBlur.current=true;setDraft(null);e.currentTarget.blur();}}}/><span>s</span></label>
  <p id={id} className="precision-sample">Sampel {Math.round((clip.offset+local)*rate).toLocaleString('id-ID')} · {rate.toLocaleString('id-ID')} Hz</p>
  <div className="precision-options"><CheckField checked={zeroCross} onChange={onZeroCross}>Snap zero crossing</CheckField><CheckField checked={safeCuts} onChange={onSafeCuts}>Fade aman 3 ms saat cut</CheckField></div>
  <div className="precision-actions"><button className="button primary" disabled={!inside||locked} onClick={()=>onSplit(cursor,clip.id)}><Scissors size={16}/>Potong di sini</button><div><button className="button subtle" disabled={locked||cursor<=clip.start+1e-9||cursor>=clip.start+clip.duration-MIN_CLIP} onClick={()=>trim('left')}>Jadikan awal</button><button className="button subtle" disabled={locked||cursor>=clip.start+clip.duration-1e-9||cursor<=clip.start+MIN_CLIP} onClick={()=>trim('right')}>Jadikan akhir</button></div></div>
 </section>;
}
