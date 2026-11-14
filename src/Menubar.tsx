import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {Check} from '@phosphor-icons/react';
export type MenuEntry = {id:string;label:string;shortcut?:string;disabled?:boolean;checked?:boolean;radio?:boolean;danger?:boolean;action:()=>void}|{id:string;separator:true;label?:string};
export type AppMenu = {id:string;label:string;accessKey:string;entries?:MenuEntry[];action?:()=>void};
const focusable='button:not(:disabled)';
export function Menubar({menus,disabled=false}:{menus:AppMenu[];disabled?:boolean}) {
  const [open,setOpen]=useState<string|null>(null),[active,setActive]=useState(0),[position,setPosition]=useState({left:8,top:8});
  const bar=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),focusEdge=useRef<'first'|'last'>('first'),typeahead=useRef({value:'',time:0}),origin=useRef<HTMLElement|null>(null);
  const current=menus.find(menu=>menu.id===open);
  const trigger=(index=active)=>bar.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index];
  const close=(restore=false)=>{setOpen(null);if(restore)trigger()?.focus({preventScroll:true});};
  const exit=()=>{setOpen(null);origin.current?.focus({preventScroll:true});};
  const remember=(element:EventTarget|null)=>{if(element instanceof HTMLElement&&!bar.current?.contains(element)&&!popup.current?.contains(element))origin.current=element;};
  const show=(index:number,edge:'first'|'last'='first')=>{if(disabled)return;setActive(index);focusEdge.current=edge;const menu=menus[index];if(menu.entries)setOpen(menu.id);else{setOpen(null);trigger(index)?.focus();}};
  useEffect(()=>{if(disabled)setOpen(null);},[disabled]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const anchor=trigger()?.getBoundingClientRect(),box=popup.current?.getBoundingClientRect();if(!anchor||!box)return;setPosition({left:Math.max(8,Math.min(anchor.left,innerWidth-box.width-8)),top:anchor.bottom+4+box.height<=innerHeight-8?anchor.bottom+4:Math.max(8,anchor.top-box.height-4)});};
    place();const buttons=popup.current?.querySelectorAll<HTMLButtonElement>(focusable);((focusEdge.current==='last'?buttons?.[buttons.length-1]:buttons?.[0])??trigger())?.focus({preventScroll:true});
    const observer=new ResizeObserver(place);if(popup.current)observer.observe(popup.current);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:Event)=>{if(!bar.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))close();};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside);};
  },[open]);
  useEffect(()=>{
    const key=(event:globalThis.KeyboardEvent)=>{
      if(disabled||event.defaultPrevented||document.querySelector('.audio-clip.dragging,[data-timeline-gesture]'))return;
      const index=event.altKey&&!event.ctrlKey&&!event.metaKey?menus.findIndex(menu=>menu.accessKey===event.key.toLowerCase()):-1;
      if(event.key==='F10'&&!event.shiftKey||index>=0){event.preventDefault();remember(document.activeElement);if(index>=0){if(menus[index].action){close();menus[index].action?.();}else show(index);}else{close();setActive(0);trigger(0)?.focus();}}
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[menus,disabled]);
  const menuKey=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(event.ctrlKey||event.metaKey){close();return;}if(event.altKey)return;
    event.stopPropagation();const buttons=Array.from(popup.current!.querySelectorAll<HTMLButtonElement>(focusable)),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='F10'){event.preventDefault();exit();}
    else if(event.key==='Escape'){event.preventDefault();close(true);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show((active+(event.key==='ArrowRight'?1:menus.length-1))%menus.length);}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next]?.focus();}
    else if(event.key==='Tab'){event.preventDefault();close();const all=Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')).filter(el=>el.tabIndex>=0&&el.getClientRects().length&&!popup.current?.contains(el)),at=all.indexOf(trigger()!);(event.shiftKey?all[at-1]??all.at(-1):all[at+1]??all[0])?.focus();}
    else if(event.key.length===1&&!event.altKey&&event.key!==' '){const now=Date.now(),prefix=now-typeahead.current.time>700?'':typeahead.current.value;typeahead.current={value:prefix+event.key.toLocaleLowerCase(),time:now};const ordered=[...buttons.slice(index+1),...buttons.slice(0,index+1)],found=ordered.find(button=>(button.getAttribute('aria-label')??'').toLocaleLowerCase().startsWith(typeahead.current.value));found?.focus();}
  };
  return <div className="app-menubar" ref={bar} role="menubar" aria-label="Menu aplikasi" onKeyDown={event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    event.stopPropagation();
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();const next=(active+(event.key==='ArrowRight'?1:menus.length-1))%menus.length;setActive(next);trigger(next)?.focus();if(open)show(next);}
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();show(active,event.key==='ArrowUp'?'last':'first');}
    else if(event.key==='Escape'){event.preventDefault();if(open)close(true);else exit();}
    else if(event.key==='F10'){event.preventDefault();exit();}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();const index=event.key==='Home'?0:menus.length-1;setActive(index);trigger(index)?.focus();}
    else if(event.key.length===1&&event.key!==' '){event.preventDefault();const key=event.key.toLocaleLowerCase(),next=menus.findIndex((menu,index)=>index>active&&menu.label.toLocaleLowerCase().startsWith(key)),index=next>=0?next:menus.findIndex(menu=>menu.label.toLocaleLowerCase().startsWith(key));if(index>=0){setActive(index);trigger(index)?.focus();if(open)show(index);}}
    else if(event.key==='Delete'||event.key==='Backspace')event.preventDefault();
  }}>{menus.map((menu,index)=><button key={menu.id} id={'app-menu-'+menu.id} role="menuitem" aria-haspopup={menu.entries?'menu':'dialog'} aria-expanded={menu.entries?open===menu.id:undefined} aria-controls={open===menu.id?'app-menu-popup':undefined} tabIndex={active===index?0:-1} disabled={disabled} onPointerDown={()=>remember(document.activeElement)} onFocus={event=>{remember(event.relatedTarget);setActive(index);}} onPointerEnter={()=>{if(open&&menu.entries)show(index);}} onClick={()=>{if(menu.action){close();menu.action();}else if(open===menu.id)close(true);else show(index);}}>{menu.label}</button>)}{current?.entries&&createPortal(<div ref={popup} id="app-menu-popup" className="app-menu-popup" role="menu" aria-label={'Menu '+current.label} style={{left:position.left,top:position.top}} onKeyDown={menuKey}>{current.entries.map(entry=>'separator' in entry?<div key={entry.id} role="separator" className={entry.label?'app-menu-section':'app-menu-separator'}>{entry.label}</div>:<button key={entry.id} role={entry.checked===undefined?'menuitem':entry.radio?'menuitemradio':'menuitemcheckbox'} aria-label={entry.label} aria-checked={entry.checked} disabled={entry.disabled} tabIndex={-1} className={entry.danger?'danger':undefined} onClick={()=>{close(true);entry.action();}}><span className="app-menu-check">{entry.checked&&<Check size={14} weight="bold"/>}</span><span className="app-menu-label">{entry.label}</span>{entry.shortcut&&<span className="app-menu-shortcut" aria-hidden="true">{entry.shortcut}</span>}</button>)}</div>,document.body)}</div>;
}
