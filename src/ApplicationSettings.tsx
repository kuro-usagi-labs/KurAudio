import {useState} from 'react';
import {ArrowCounterClockwise} from '@phosphor-icons/react';
import {ToggleSwitch} from './ToggleSwitch';
import {Fader} from './Fader';
import {defaultAppPreferences,type AppPreferences} from './appPreferences';

function Options<T extends string|number>({label,value,options,onChange,disabled=false}:{label:string;value:T;options:readonly (readonly [T,string])[];onChange:(value:T)=>void;disabled?:boolean}) {
  return <div className="settings-options" role="radiogroup" aria-label={label}>{options.map(([option,text],index)=><button key={option} role="radio" aria-checked={value===option} tabIndex={value===option?0:-1} disabled={disabled} onClick={()=>onChange(option)} onKeyDown={event=>{
    const delta=event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:event.key==='ArrowRight'||event.key==='ArrowDown'?1:0;
    if(!delta&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+delta+options.length)%options.length;
    onChange(options[next][0]);(event.currentTarget.parentElement!.children[next] as HTMLButtonElement).focus();
  }}>{text}</button>)}</div>;
}
function AppearanceOptions({value,onChange}:{value:AppPreferences['appearance'];onChange:(value:AppPreferences['appearance'])=>void}) {
  const options=[['light','Terang'],['dark','Gelap'],['system','Sistem']] as const;
  const preview=(palette:'light'|'dark')=><span className="appearance-preview-window" data-palette={palette}><span className="appearance-preview-chrome"><i/><i/><i/></span><span className="appearance-preview-content"><span/><span><i/><i/><i/></span></span></span>;
  return <div className="appearance-options" role="radiogroup" aria-label="Tampilan aplikasi">{options.map(([choice,label],index)=><button className="appearance-choice" key={choice} role="radio" aria-checked={value===choice} tabIndex={value===choice?0:-1} onClick={()=>onChange(choice)} onKeyDown={event=>{
    const direction=event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:event.key==='ArrowRight'||event.key==='ArrowDown'?1:0;if(!direction&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+direction+options.length)%options.length;onChange(options[next][0]);(event.currentTarget.parentElement!.children[next] as HTMLButtonElement).focus();
  }}><span className="appearance-preview" data-preview={choice} aria-hidden="true">{preview(choice==='dark'?'dark':'light')}{choice==='system'&&preview('dark')}</span><span>{label}</span></button>)}</div>;
}
function SettingsSwitch({label,checked,onChange}:{label:string;checked:boolean;onChange:(checked:boolean)=>void}) {
  return <label className="settings-switch-row"><span>{label}</span><ToggleSwitch label={label} checked={checked} onChange={onChange}/></label>;
}
export function ApplicationSettings({value,onChange,status}:{value:AppPreferences;onChange:(value:AppPreferences)=>void;status:string}) {
  const [tab,setTab]=useState<'general'|'editing'|'backups'>('general');
  const tabs=[['general','Umum'],['editing','Editing'],['backups','Cadangan']] as const;
  const update=<K extends keyof AppPreferences>(key:K,next:AppPreferences[K])=>onChange({...value,[key]:next});
  return <div className="application-settings">
    <div className="settings-tabs" role="tablist" aria-label="Bagian pengaturan" onKeyDown={event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();
      const index=tabs.findIndex(([key])=>key===tab),next=tabs[(index+(event.key==='ArrowRight'?1:2))%tabs.length][0];setTab(next);document.getElementById('settings-'+next)?.focus();
    }}>{tabs.map(([key,label])=><button key={key} id={'settings-'+key} role="tab" aria-selected={tab===key} aria-controls="application-settings-content" tabIndex={tab===key?0:-1} onClick={()=>setTab(key)}>{label}</button>)}</div>
    <div id="application-settings-content" role="tabpanel" aria-labelledby={'settings-'+tab}>
      {tab==='general'&&<>
        <section className="settings-section"><h3>Tampilan</h3><AppearanceOptions value={value.appearance} onChange={next=>update('appearance',next)}/></section>
        <section className="settings-section"><h3>Animasi antarmuka</h3><Options label="Animasi antarmuka" value={value.motion} options={[["system","Ikuti sistem"],["reduced","Minimal"]]} onChange={next=>update('motion',next)}/></section>
        <section className="settings-section"><div className="settings-heading"><h3>Volume pratinjau default</h3><output>{Math.round(value.previewVolume*100)}%</output></div><Fader label="Volume pratinjau default" value={value.previewVolume} min={0} max={1} step={.01} unit="" muteAtMin={false} onChange={next=>update('previewVolume',next)}/><p>Untuk audisi Media, terpisah dari volume proyek.</p></section>
      </>}
      {tab==='editing'&&<section className="settings-section"><h3>Default proyek baru</h3><p>Tampilan proyek yang sudah ada tetap dipulihkan.</p><div className="settings-checks"><SettingsSwitch label="Snapping timeline" checked={value.snap} onChange={next=>update('snap',next)}/><SettingsSwitch label="Snap zero crossing" checked={value.zeroCross} onChange={next=>update('zeroCross',next)}/><SettingsSwitch label="Fade aman 3 ms saat cut" checked={value.safeCuts} onChange={next=>update('safeCuts',next)}/><SettingsSwitch label="Ikuti playhead saat playback" checked={value.followPlayhead} onChange={next=>update('followPlayhead',next)}/></div></section>}
      {tab==='backups'&&<section className="settings-section"><SettingsSwitch label="Cadangan versi otomatis" checked={value.automaticCheckpoints} onChange={next=>update('automaticCheckpoints',next)}/><h3 className="settings-interval-heading">Setelah berhenti mengedit</h3><Options label="Interval cadangan" value={value.checkpointSeconds} options={[[30,'30 detik'],[60,'60 detik'],[120,'120 detik']]} disabled={!value.automaticCheckpoints} onChange={next=>update('checkpointSeconds',next)}/><p>Cadangan manual dan pemulihan crash tetap tersedia.</p></section>}
    </div>
    <div className="settings-footer"><span role="status">{status||'Disimpan otomatis'}</span><button className="text-button" onClick={()=>onChange({...defaultAppPreferences})}><ArrowCounterClockwise size={14}/>Reset pengaturan</button></div>
  </div>;
}
