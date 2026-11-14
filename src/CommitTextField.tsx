import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { registerDraft } from './draftInput';
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onCommit'> & { value: string; onCommit: (value: string) => void; fallback?: string };
export function CommitTextField({value,onCommit,fallback='',onBlur,onKeyDown,...props}: Props) {
  const [draft,setDraft]=useState<string|null>(null), input=useRef<HTMLInputElement>(null), current=useRef<string|null>(null);
  const commit=()=>{const next=current.current;current.current=null;setDraft(null);if(next!==null&&next!==value)onCommit(next||fallback);return true;};
  useLayoutEffect(()=>registerDraft(input.current!,commit));
  useLayoutEffect(()=>{current.current=null;setDraft(null);},[value]);
  return <input {...props} ref={input} value={draft??value} onChange={e=>{current.current=e.target.value;setDraft(e.target.value);}} onBlur={e=>{commit();onBlur?.(e);}} onKeyDown={e=>{
    if(e.nativeEvent.isComposing)return;
    if(e.key==='Enter'){e.preventDefault();commit();e.currentTarget.blur();}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();current.current=null;setDraft(null);e.currentTarget.blur();}
    onKeyDown?.(e);
  }}/>;
}
