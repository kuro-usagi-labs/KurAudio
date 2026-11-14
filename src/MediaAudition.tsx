import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Headphones, Pause, Play, SpeakerHigh, X } from '@phosphor-icons/react';
import { Fader } from './Fader';
import { formatTime, type Asset } from './model';
import { mediaPreview } from './mediaPreview';
import './media-preview.css';

type Props = { assets: Asset[]; onBeforePlay: () => void; onError?: (message: string) => void };

export function MediaPreview({ assets, onBeforePlay, onError }: Props) {
  const state = useSyncExternalStore(mediaPreview.subscribe, mediaPreview.get);
  const asset = assets.find(item => item.id === state.assetId);
  const lastError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.assetId && !asset) mediaPreview.clear();
  }, [state.assetId, asset]);
  useEffect(() => {
    if (state.error && state.error !== lastError.current) onError?.(state.error);
    lastError.current = state.error;
  }, [state.error, onError]);
  if (!asset) return null;

  const toggle = () => {
    if (state.playing) { mediaPreview.pause(); return; }
    onBeforePlay();
    void mediaPreview.play(asset.id).catch(() => { /* The snapshot delivers the error to onError. */ });
  };

  return <section className="media-preview" aria-label="Pratinjau media">
    <div className="media-preview-heading">
      <Headphones size={15} aria-hidden="true"/>
      <span className="media-preview-name" data-tooltip={asset.name}>{asset.name}</span>
      <button type="button" className="media-preview-button" aria-label="Tutup pratinjau" data-tooltip="Tutup pratinjau" onClick={mediaPreview.clear}><X size={14} aria-hidden="true"/></button>
    </div>
    <div className="media-preview-transport">
      <button type="button" className={`media-preview-button media-preview-play${state.playing ? ' is-playing' : ''}`} aria-label={state.playing ? 'Jeda pratinjau' : 'Putar pratinjau'} data-tooltip={state.playing ? 'Jeda pratinjau' : 'Putar pratinjau'} onClick={toggle}>{state.playing ? <Pause size={15} weight="fill" aria-hidden="true"/> : <Play size={15} weight="fill" aria-hidden="true"/>}</button>
      <span className="media-preview-time" aria-label={`${formatTime(state.position)} dari ${formatTime(state.duration)}`}>{formatTime(state.position)} <span>/ {formatTime(state.duration)}</span></span>
    </div>
    <Fader label="Posisi pratinjau" value={Math.round(state.position * 100) / 100} onChange={mediaPreview.seek} min={0} max={state.duration} step={0.01} unit="detik" muteAtMin={false}/>
    <div className="media-preview-volume">
      <SpeakerHigh size={14} aria-hidden="true"/>
      <Fader label="Volume pratinjau" value={Math.round(state.volume * 100)} onChange={value => mediaPreview.setVolume(value / 100)} min={0} max={100} step={1} unit="%" muteAtMin={false}/>
      <span>{Math.round(state.volume * 100)}%</span>
    </div>
  </section>;
}
