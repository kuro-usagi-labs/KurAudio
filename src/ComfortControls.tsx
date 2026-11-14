import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, ArrowsClockwise, Play, ArrowUUpLeft, Selection, SlidersHorizontal,ArrowsHorizontal } from '@phosphor-icons/react';
import type {RippleScope} from './editing';
import { Fader } from './Fader';
import { CheckField } from './CheckField';
import { clamp } from './model';
import { pointerGesture } from './TimelineOverlays';

function FloatingControl({ label, icon, children, active }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode; active?:boolean }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [position,setPosition] = useState({left:8,top:8});
  useLayoutEffect(() => {
    if(!open)return;
    const place=()=>{const anchor=trigger.current?.getBoundingClientRect(),box=popup.current?.getBoundingClientRect();if(!anchor||!box)return;setPosition({left:clamp(anchor.right-box.width,8,Math.max(8,window.innerWidth-box.width-8)),top:anchor.bottom+8+box.height<=window.innerHeight-8?anchor.bottom+8:Math.max(8,anchor.top-box.height-8)});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    popup.current?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')?.focus({preventScroll:true});
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  return <div ref={root} className="comfort-control"><button ref={trigger} className={`icon-button ${active?'selected':''}`} aria-label={label} aria-pressed={active} aria-expanded={open} aria-haspopup="dialog" data-tooltip={label} onClick={() => setOpen(!open)}>{icon}<CaretDown size={10}/></button>{open && createPortal(<div ref={popup} className="comfort-popover" style={{left:position.left,top:position.top,right:'auto',width:'min(20rem, calc(100vw - 1rem))'}} role="dialog" aria-label={label} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); } if(e.key==='Tab'){const items=Array.from(popup.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();setOpen(false);trigger.current?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();const all=Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')).filter(el=>!popup.current?.contains(el)&&el.getClientRects().length>0);setOpen(false);(all[all.indexOf(trigger.current!)+1]??trigger.current)?.focus();}} }}><h3>{label}</h3>{children(() => { setOpen(false); trigger.current?.focus(); })}</div>,document.body)}</div>;
}
export function RippleControls({value,onChange}:{value:RippleScope;onChange:(value:RippleScope)=>void}){
 return <FloatingControl label="Ripple editing" active={value!=='off'} icon={<ArrowsHorizontal size={17}/>}>
  {()=> <div className="ripple-options"><div className="segmented" aria-label="Cakupan ripple">{([['off','Mati'],['track','Track edit'],['all','Semua track']] as const).map(([mode,label])=><button key={mode} aria-pressed={value===mode} onClick={()=>onChange(mode)}>{label}</button>)}</div><p>Klip terkunci tetap di tempat.</p></div>}
 </FloatingControl>;
}
export function PlaybackReview({ canReview, onSelection, onAround, onReturn, disabled }: { canReview: boolean; onSelection: () => void; onAround: () => void; onReturn: () => void; disabled: boolean }) {
  return <FloatingControl label="Dengar ulang" icon={<ArrowsClockwise size={17}/>}>
    {close => <div className="review-actions"><button disabled={!canReview} onClick={() => { close(); onSelection(); }}><Selection size={16}/><span>Putar seleksi</span><kbd>Shift+Space</kbd></button><button disabled={disabled} onClick={() => { close(); onAround(); }}><Play size={16}/><span>Dengar sekitar playhead</span><kbd>Alt+Space</kbd></button><button onClick={() => { close(); onReturn(); }}><ArrowUUpLeft size={16}/><span>Kembali ke awal playback</span><kbd>Shift+Enter</kbd></button></div>}
  </FloatingControl>;
}
type Sizes = { mediaWidth: number; inspectorWidth: number; trackHeight: number };
export function WorkspaceControls({ sizes, onChange, follow, onFollow }: { sizes: Sizes; onChange: (key: keyof Sizes, value: number) => void; follow: boolean; onFollow: (value: boolean) => void }) {
  return <FloatingControl label="Tampilan workspace" icon={<SlidersHorizontal size={16}/>}>
    {() => <div className="workspace-options">{([['trackHeight', 'Tinggi track', 104, 240], ['mediaWidth', 'Lebar Media', 180, 360], ['inspectorWidth', 'Lebar Properti', 240, 420]] as const).map(([key, label, min, max]) => <div key={key}><div className="workspace-option-label">{label}<output>{sizes[key]}</output></div><Fader label={label} value={sizes[key]} min={min} max={max} step={4} unit="px" muteAtMin={false} onChange={value => onChange(key, value)}/></div>)}<CheckField checked={follow} onChange={onFollow}>Ikuti playhead saat playback</CheckField></div>}
  </FloatingControl>;
}
export function PanelResizer({ side, value, min, max, defaultValue, onChange, onResizing }: { side: 'media' | 'inspector'; value: number; min: number; max: number; defaultValue: number; onChange: (value: number) => void; onResizing: (value: boolean) => void }) {
  const cleanup = useRef<(() => void) | undefined>(undefined), frame = useRef(0), sign = side === 'media' ? 1 : -1;
  useEffect(() => () => { cleanup.current?.(); cancelAnimationFrame(frame.current); }, []);
  const finish = () => { frame.current = requestAnimationFrame(() => { frame.current = requestAnimationFrame(() => onResizing(false)); }); };
  return <div className={`panel-resizer panel-resizer-${side}`} role="separator" aria-label={side === 'media' ? 'Ubah lebar Media' : 'Ubah lebar Properti'} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} data-tooltip="Tarik untuk mengatur lebar · klik ganda untuk reset" onDoubleClick={() => onChange(defaultValue)} onKeyDown={e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); onChange(e.key === 'Home' ? min : e.key === 'End' ? max : clamp(value + (e.key === 'ArrowRight' ? 1 : -1) * sign * (e.shiftKey ? 24 : 8), min, max)); }} onPointerDown={e => {
    if (e.button !== 0) return;
    const x = e.clientX, initial = value; cancelAnimationFrame(frame.current); onResizing(true);
    cleanup.current = pointerGesture(e, event => onChange(clamp(Math.round(initial + (event.clientX - x) * sign), min, max)), finish, () => { onChange(initial); finish(); });
  }}/>;
}
