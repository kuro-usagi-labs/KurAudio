import { useEffect, useRef, useState } from 'react';
import { Microphone, Stop, Record } from '@phosphor-icons/react';
import { recorder, type RecordedAudio } from './recording';
import { formatTime } from './model';
function recordingError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Izin mikrofon ditolak. Izinkan akses mikrofon di pengaturan privasi perangkat atau browser, lalu coba lagi.';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'Mikrofon tidak ditemukan. Hubungkan perangkat atau pilih input lain.';
    if (error.name === 'NotReadableError') return 'Mikrofon tidak dapat diakses. Tutup aplikasi lain yang memakai mikrofon, lalu coba lagi.';
  }
  return error instanceof Error ? error.message : String(error);
}
export function RecordPanel({ trackName, at, onCommit, onRecording }: { trackName: string; at: number; onCommit: (data: RecordedAudio) => void; onRecording: (active: boolean) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [device, setDevice] = useState(''), [ready, setReady] = useState(false), [active, setActive] = useState(false), [busy, setBusy] = useState(false), [peak, setPeak] = useState(0), [elapsed, setElapsed] = useState(0), [error, setError] = useState('');
  const action = useRef<HTMLButtonElement>(null);
  const choices = [{ deviceId: '', label: 'Mikrofon default' }, ...devices.filter(d => d.deviceId && d.deviceId !== 'default')];
  useEffect(() => { if (ready && !busy) action.current?.focus(); }, [ready, active, busy]);
  useEffect(() => { let alive = true; navigator.mediaDevices?.enumerateDevices().then(list => { if (alive) setDevices(list.filter(d => d.kind === 'audioinput')); }).catch(() => {}); return () => { alive = false; recorder.cancel(); onRecording(false); }; }, []);
  const prepare = async () => { setBusy(true); setError(''); try { if (await recorder.prepare(device, (peak, elapsed) => { setPeak(peak); setElapsed(elapsed); })) { setReady(true); const inputs = await navigator.mediaDevices.enumerateDevices().catch(() => []); setDevices(inputs.filter(d => d.kind === 'audioinput')); } } catch (e) { setError(recordingError(e)); } finally { setBusy(false); } };
  const changeInput = () => { recorder.cancel(); setReady(false); setPeak(0); setElapsed(0); setError(''); requestAnimationFrame(() => document.querySelector<HTMLElement>('.device-list [aria-checked=true]')?.focus()); };
  return <div className="session-section record-panel" aria-busy={busy}>
    <div className="record-destination" role="group" aria-label="Tujuan rekaman"><span>Track</span><strong data-tooltip={trackName}>{trackName}</strong><output>{formatTime(at, true)}</output></div>
    <div className="record-status" role="status" data-recording={active}>{active && <Record size={11} weight="fill"/>}<span>{busy ? active ? 'Menyelesaikan rekaman…' : 'Menyiapkan mikrofon…' : active ? 'Merekam' : ready ? 'Input siap' : 'Input belum disiapkan'}</span></div>
    <div className="device-list" role="radiogroup" aria-label="Mikrofon input">{choices.map((d, i) => <button key={d.deviceId} role="radio" tabIndex={device === d.deviceId ? 0 : -1} aria-checked={device === d.deviceId} disabled={ready || busy || active} onClick={() => setDevice(d.deviceId)} onKeyDown={e => { const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0; if (!delta && e.key !== 'Home' && e.key !== 'End') return; e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : (i + delta + choices.length) % choices.length; setDevice(choices[next].deviceId); (e.currentTarget.parentElement!.children[next] as HTMLButtonElement).focus(); }}><Microphone size={16}/>{d.label || `Mikrofon ${i}`}</button>)}</div>
    <div className="record-monitor"><output aria-label="Durasi rekaman" aria-live="off">{formatTime(elapsed, true)}</output><div className="record-meter" role="meter" aria-label="Level mikrofon" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={peak ? Math.max(-60, Math.min(0, 20 * Math.log10(peak))) : -60}><i style={{ width: `${Math.min(100, peak * 100)}%` }}/></div><span>{peak > 0.0001 ? `${(20 * Math.log10(peak)).toFixed(1)} dB` : '−∞ dB'}</span></div>
    <div className="record-actions">
      {!ready && <button className="button primary" disabled={busy} onClick={() => void prepare()}>{busy ? 'Menyiapkan mikrofon…' : 'Siapkan mikrofon'}</button>}
      {ready && !active && <><button ref={action} className="button record-start" disabled={busy} onClick={() => { try { recorder.start(); setActive(true); onRecording(true); } catch (e) { setError(recordingError(e)); } }}><Microphone size={16}/> Mulai rekam</button><button className="button subtle" disabled={busy} onClick={changeInput}>Ganti mikrofon</button></>}
      {active && <button ref={action} className="button primary" disabled={busy} onClick={async () => { setBusy(true); try { const data = await recorder.finish(); if (data) onCommit(data); } catch (e) { setError(recordingError(e)); setReady(false); } finally { setActive(false); onRecording(false); setBusy(false); } }}><Stop size={15}/> Stop & tambahkan</button>}
    </div>
    <p className="modal-note">Suara mikrofon tidak diputar ke speaker.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
