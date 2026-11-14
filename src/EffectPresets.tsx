import { useState } from 'react';
import { FloppyDisk, Trash, CaretDown } from '@phosphor-icons/react';
import { type Effects, defaultEffects, validEffectFlags, uid } from './model';
type Preset = { id: string; name: string; effects: Effects };
const key = 'kuraudio.effect-presets.v2';
function read(): Preset[] {
  const value = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem('kuraudio.effect-presets.v1') ?? '[]');
  if (!Array.isArray(value) || value.length > 32) throw new Error('Daftar preset tidak valid.');
  return value.filter(p => {
    const f = p?.effects;
    return p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 80 && f && validEffectFlags(f.enabled) && typeof f.bypassed === 'boolean' && ['small', 'studio', 'hall'].includes(f.roomSize) && Object.entries(defaultEffects()).every(([k, v]) => typeof f[k] === typeof v && (typeof v !== 'number' || Number.isFinite(f[k]))) && ['denoise','reverb','room','echo','compression'].every(k => f[k] >= 0 && f[k] <= 100) && f.decay >= 0.2 && f.decay <= 6 && f.echoTime >= 0.05 && f.echoTime <= 1 && Math.abs(f.bass) <= 12 && Math.abs(f.treble) <= 12;
  });
}
export function EffectPresets({ effects, apply }: { effects: Effects; apply: (effects: Effects) => void }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [error, setError] = useState('');
  const [presets, setPresets] = useState<Preset[]>(() => { try { return read(); } catch { return []; } });
  const persist = (next: Preset[]) => { try { localStorage.setItem(key, JSON.stringify(next)); setPresets(next); setError(''); return true; } catch { setError('Preset gagal disimpan. Penyimpanan lokal tidak tersedia atau penuh.'); return false; } };
  return <section className="effect-presets"><button className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>Preset pribadi <span>{presets.length}<CaretDown size={13}/></span></button>{open && <div className="preset-content">
    <label className="field-label">Nama preset<input aria-label="Nama preset" value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label>
    <button className="button" disabled={!name.trim() || presets.length >= 32} onClick={() => { if (persist([...presets, { id: uid(), name: name.trim(), effects: structuredClone(effects) }])) setName(''); }}><FloppyDisk size={14}/> Simpan preset</button>
    <div className="preset-list">{presets.map(preset => <div key={preset.id}><button className="preset-apply" onClick={() => apply(structuredClone(preset.effects))}>{preset.name}</button><button className="icon-button danger" aria-label={`Hapus preset ${preset.name}`} onClick={() => persist(presets.filter(p => p.id !== preset.id))}><Trash size={14}/></button></div>)}</div>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>}</section>;
}
