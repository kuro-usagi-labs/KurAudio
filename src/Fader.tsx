import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { clamp } from './model';
import { registerDraft } from './draftInput';

type Props = { label: string; value: number; onChange: (value: number) => void; onCommit?: (value: number) => void; onCancel?: () => void; min?: number; max?: number; step?: number; disabled?: boolean; unit?: string; muteAtMin?: boolean };
export function Fader({ label, value, onChange, onCommit, onCancel, min = -60, max = 12, step = 1, disabled = false, unit = 'dB', muteAtMin = true }: Props) {
  const transaction = useRef<{initial:number;latest:number;pointer:boolean}|null>(null);
  const input=useRef<HTMLInputElement>(null), callbacks=useRef({onChange,onCommit,onCancel});callbacks.current={onChange,onCommit,onCancel};
  const pointerId=useRef<number|null>(null),blocked=useRef(false);
  const begin=(pointer=false)=>{transaction.current??={initial:value,latest:value,pointer};};
  const finish=(cancel=false)=>{const t=transaction.current;transaction.current=null;if(!t)return;if(cancel||t.latest===t.initial){if(callbacks.current.onCancel)callbacks.current.onCancel();else callbacks.current.onChange(t.initial);}else callbacks.current.onCommit?.(t.latest);};
  const cancel=()=>{blocked.current=true;finish(true);};
  useLayoutEffect(()=>registerDraft(input.current!,()=>{finish();return true;}));
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&transaction.current){e.preventDefault();e.stopPropagation();cancel();}};window.addEventListener('blur',cancel);document.addEventListener('keydown',escape,true);return()=>{window.removeEventListener('blur',cancel);document.removeEventListener('keydown',escape,true);cancel();};},[]);
  const position = (clamp(value, min, max) - min) / (max - min) * 100;
  const zero = (0 - min) / (max - min) * 100;
  const style = { '--fader-position': `${position}%`, '--fader-zero': `${zero}%` } as CSSProperties;
  return <div className={`track-fader ${disabled ? 'is-disabled' : ''}`} style={style}>
    <div className="fader-art" aria-hidden="true"><span className="fader-rail"/><span className="fader-fill"/>{min < 0 && max > 0 && <span className="fader-zero"/>}<span className="fader-thumb"><i/></span></div>
    <input ref={input} className="fader-input" type="range" aria-label={label} aria-valuetext={muteAtMin && value <= min ? 'Mute' : `${value} ${unit}`} min={min} max={max} step={step} value={value} disabled={disabled} onPointerDown={e=>{if(e.button===0){blocked.current=false;pointerId.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);begin(true);}}} onChange={e => {if(blocked.current){e.currentTarget.value=String(value);return;}begin();transaction.current!.latest=Number(e.currentTarget.value);onChange(transaction.current!.latest);}} onPointerUp={e => {finish(blocked.current);pointerId.current=null;blocked.current=false;e.currentTarget.blur();}} onPointerCancel={()=>{cancel();pointerId.current=null;}} onLostPointerCapture={()=>{if(pointerId.current!==null){cancel();pointerId.current=null;}}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)){if(!e.repeat)blocked.current=false;if(!blocked.current)begin();}}} onKeyUp={e => {if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)){finish(blocked.current);blocked.current=false;}}} onBlur={()=>{if(transaction.current?.pointer)cancel();else finish();}}/>
  </div>;
}
