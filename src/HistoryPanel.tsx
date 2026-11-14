import {useEffect,useRef,useState} from 'react';
import {ArrowCounterClockwise,ClockCounterClockwise,FloppyDisk,Plus,Trash} from '@phosphor-icons/react';
import {type HistoryEntry} from './model';
import type {CheckpointSummary} from './checkpoints';

type Props={history:HistoryEntry[];checkpoints:CheckpointSummary[];loading:boolean;status:string;onJump:(id:string)=>void;onCreate:()=>void;onRestore:(id:string)=>void;onDelete:(id:string)=>void;onRefresh:()=>void};
export function HistoryPanel({history,checkpoints,loading,status,onJump,onCreate,onRestore,onDelete,onRefresh}:Props){
 const [tab,setTab]=useState<'steps'|'versions'>('steps');const current=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(tab==='steps')current.current?.scrollIntoView({block:'nearest'});else onRefresh();},[tab,onRefresh]);
 return <section className="history-panel" aria-label="Riwayat proyek">
  <div className="history-tabs" role="tablist" aria-label="Jenis riwayat" onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=tab==='steps'?'versions':'steps';setTab(next);document.getElementById('history-'+next)?.focus();}}}>
   <button id="history-steps" role="tab" aria-selected={tab==='steps'} tabIndex={tab==='steps'?0:-1} aria-controls="history-content" onClick={()=>setTab('steps')}>Langkah<span>{history.length}</span></button>
   <button id="history-versions" role="tab" aria-selected={tab==='versions'} tabIndex={tab==='versions'?0:-1} aria-controls="history-content" onClick={()=>setTab('versions')}>Cadangan<span>{checkpoints.length}</span></button>
  </div>
  <div id="history-content" className="history-content" role="tabpanel" aria-labelledby={'history-'+tab} aria-busy={loading}>
   {tab==='steps'?<ol className="history-steps">{history.map((entry,index)=><li key={entry.id} data-current={entry.current}><button ref={entry.current?current:undefined} aria-current={entry.current?'step':undefined} aria-label={`Pulihkan langkah ${entry.label}`} onClick={()=>onJump(entry.id)}><span className="history-step-index">{String(index+1).padStart(2,'0')}</span><span>{entry.label}</span>{entry.current&&<span className="history-current-dot" aria-label="Posisi saat ini"/>}</button></li>)}</ol>:<>
    <div className="version-heading"><span>{checkpoints.length?`${checkpoints.length} versi lokal`:'Belum ada cadangan'}</span>{checkpoints.length>0&&<button className="icon-button" aria-label="Buat cadangan" data-tooltip="Buat cadangan versi saat ini" disabled={loading} onClick={onCreate}><Plus size={16}/></button>}</div>
    <ul className="version-list">{checkpoints.map(entry=><li key={entry.id}><button className="version-open" aria-label={`Pulihkan cadangan ${entry.id}`} disabled={loading} onClick={()=>onRestore(entry.id)}><FloppyDisk size={15}/><span><strong>{entry.reason}</strong><small>{new Date(entry.time).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})} · {entry.clipCount} klip</small></span><ArrowCounterClockwise size={14}/></button><button className="version-delete" aria-label={`Hapus cadangan ${entry.id}`} data-tooltip="Hapus versi cadangan ini" disabled={loading} onClick={()=>onDelete(entry.id)}><Trash size={14}/></button></li>)}</ul>
    {!checkpoints.length&&<div className="version-empty"><ClockCounterClockwise size={26} weight="light"/><p>Versi dibuat saat menyimpan atau setelah mengedit.</p><button className="button subtle" disabled={loading} onClick={onCreate}><Plus size={15}/>Buat cadangan</button></div>}
   </>}
  </div>
  <div className="history-footnote" role="status">{status|| (tab==='steps'?'Riwayat sesi ini':'Cadangan lokal · terpisah dari berkas .kura')}</div>
 </section>;
}
