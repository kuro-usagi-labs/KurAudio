import { useSyncExternalStore, type CSSProperties } from 'react';
import { Play, Pause } from '@phosphor-icons/react';
import { type Asset, formatTime } from './model';
import { mediaPreview } from './mediaPreview';
import { Waveform } from './Waveform';
export function MediaItem({ asset, index, onInsert, onPreview }: { asset: Asset; index: number; onInsert: () => void; onPreview: () => void }) {
  const active = useSyncExternalStore(mediaPreview.subscribe, () => mediaPreview.get().assetId === asset.id && mediaPreview.get().playing);
  return <div data-asset-id={asset.id} className="asset-item" draggable tabIndex={0} role="group" aria-label={`Media ${asset.name}`} aria-keyshortcuts="Enter Space" data-tooltip="Enter untuk tambahkan · Space untuk preview · tarik ke timeline" onKeyDown={e => { if (e.target !== e.currentTarget || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onInsert(); } if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) onPreview(); } }} onDragStart={e => { e.dataTransfer.setData('application/kuraudio-asset', asset.id); e.dataTransfer.effectAllowed = 'copy'; }}>
    <span className="asset-thumbnail" style={{ '--asset-color': `var(--track-${index % 3})` } as CSSProperties}><Waveform assetId={asset.id} duration={asset.duration} scale={48 / asset.duration} mini/></span><div className="asset-text"><span data-tooltip={asset.name}>{asset.name}</span><small>{formatTime(asset.duration, true)} · {asset.channels === 1 ? 'Mono' : 'Stereo'}</small></div><button className="asset-preview-button" aria-label={`${active ? 'Jeda' : 'Preview'} ${asset.name}`} aria-pressed={active} data-tooltip={active ? 'Jeda preview' : 'Dengarkan sebelum menempatkan'} draggable={false} onClick={onPreview}>{active ? <Pause size={14} weight="fill"/> : <Play size={14} weight="fill"/>}</button>
  </div>;
}
