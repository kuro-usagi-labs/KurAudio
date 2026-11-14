import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, Info, Power, Waveform, WaveSine, Cube, Repeat, SlidersHorizontal, Gauge } from '@phosphor-icons/react';
import { type Clip, type Effects, type EffectKind, defaultEffects, effectEnabled, toggleEffect } from './model';
import { playback } from './audio';
import { Fader } from './Fader';
import { EffectPresets } from './EffectPresets';
import { ToggleSwitch } from './ToggleSwitch';
import { Presence } from './Presence';

function EffectSlider({ label, displayLabel, value, onCommit, onPreview, min = 0, max = 100, step = 1, unit = '%', disabled = false, help }: { label: string; displayLabel?: string; value: number; onCommit: (value: number) => void; onPreview: (value: number) => void; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean; help?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <div className="effect-control" onPointerCancel={() => { setDraft(value); onPreview(value); }}><div className="effect-control-heading"><span>{displayLabel ?? label}{help && <span className="effect-help" role="img" tabIndex={0} data-tooltip={help} aria-label={help}><Info size={13}/></span>}</span><output>{Number(draft.toFixed(2))}{unit === '%' ? '%' : ` ${unit}`}</output></div><Fader label={label} value={draft} min={min} max={max} step={step} unit={unit} muteAtMin={false} disabled={disabled} onChange={value => { setDraft(value); onPreview(value); }} onCommit={onCommit}/></div>;
}

function EffectSection({ title, icon, tone, children, active, onToggle }: { title: string; icon: ReactNode; tone: 'blue' | 'violet' | 'amber' | 'coral'; children: ReactNode; active: boolean; onToggle: (active: boolean) => void }) {
  const id = useId();
  return <section className="effect-block" data-tone={tone} data-active={active}>
    <label className="effect-section-heading">
      <span><span className="effect-section-icon" aria-hidden="true">{icon}</span><span>{title}</span></span>
      <ToggleSwitch label={title} checked={active} controls={id} onChange={onToggle}/>
    </label>
    <div id={id} aria-hidden={!active || undefined} inert={!active}><Presence visible={active}><div className="effect-section-reveal"><div className="effect-section-clip"><div className="effect-section-body">{children}</div></div></div></Presence></div>
  </section>;
}

export function EffectsPanel({ clip, onUpdate }: { clip: Clip; onUpdate: (effects: Effects) => void }) {
  const effects = clip.effects ?? defaultEffects();
  const activation = (kind: EffectKind) => ({ active: effectEnabled(effects, kind), onToggle: (enabled: boolean) => onUpdate(toggleEffect(effects, kind, enabled)) });
  const slider = (key: keyof Effects, label: string, options: { min?: number; max?: number; step?: number; unit?: string; help?: string; displayLabel?: string } = {}) => <EffectSlider label={label} value={effects[key] as number} disabled={effects.bypassed} {...options} onCommit={value => onUpdate({ ...effects, [key]: value })} onPreview={value => playback.previewEffects(clip.id, { ...effects, [key]: value })}/>;
  return <div className={`effects-panel ${effects.bypassed ? 'is-bypassed' : ''}`}>
    <EffectPresets effects={effects} apply={onUpdate}/>
    <div className="effects-actions"><button className={effects.bypassed ? 'selected' : ''} aria-label="Bypass efek" aria-pressed={effects.bypassed} data-tooltip="Dengarkan tanpa efek" onClick={() => onUpdate({ ...effects, bypassed: !effects.bypassed })}><Power size={14}/>Bypass</button><button className="icon-button" aria-label="Reset efek" data-tooltip="Reset semua efek klip" onClick={() => onUpdate(defaultEffects())}><ArrowCounterClockwise size={16}/></button></div>
    <div className="effect-list">
    <EffectSection title="Denoise" tone="blue" icon={<Waveform size={16}/>} {...activation('denoise')}>{slider('denoise', 'Denoise', { displayLabel: 'Intensitas', help: 'Mengurangi hiss dan noise konstan. Intensitas tinggi dapat menipiskan suara; diproses setelah slider dilepas.' })}</EffectSection>
    <EffectSection title="Reverb" tone="violet" icon={<WaveSine size={16}/>} {...activation('reverb')}>{slider('reverb', 'Reverb', { displayLabel: 'Campuran' })}{slider('decay', 'Decay', { min: 0.2, max: 6, step: 0.1, unit: 's' })}</EffectSection>
    <EffectSection title="Room" tone="amber" icon={<Cube size={16}/>} {...activation('room')}>{slider('room', 'Room', { displayLabel: 'Campuran' })}<div className="room-presets" role="group" aria-label="Ukuran room">{([['small', 'Kecil'], ['studio', 'Studio'], ['hall', 'Hall']] as const).map(([value, label]) => <button key={value} disabled={effects.bypassed} aria-pressed={effects.roomSize === value} onClick={() => onUpdate({ ...effects, roomSize: value })}>{label}</button>)}</div></EffectSection>
    <EffectSection title="Echo" tone="coral" icon={<Repeat size={16}/>} {...activation('echo')}>{slider('echo', 'Echo', { displayLabel: 'Campuran' })}{slider('echoTime', 'Jeda echo', { min: 0.05, max: 1, step: 0.01, unit: 's' })}</EffectSection>
    <EffectSection title="Equalizer" tone="amber" icon={<SlidersHorizontal size={16}/>} {...activation('equalizer')}>{slider('bass', 'Bass', { min: -12, max: 12, step: 0.5, unit: 'dB' })}{slider('treble', 'Treble', { min: -12, max: 12, step: 0.5, unit: 'dB' })}</EffectSection>
    <EffectSection title="Dinamika" tone="blue" icon={<Gauge size={16}/>} {...activation('compression')}>{slider('compression', 'Compressor')}</EffectSection>
    </div>
  </div>;
}
