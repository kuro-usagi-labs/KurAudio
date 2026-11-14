import { useEffect, useRef, useState, type DragEvent,type ReactNode } from 'react';
import { Plus, FolderOpen, ArrowUpRight, Waveform, X } from '@phosphor-icons/react';
import {BrandMark} from './BrandMark';
import {version as appVersion} from '../package.json';
import type { RecentProject } from './recentProjects';
import './recent-projects.css';

type Props = {
  disabled: boolean; onNew: () => void; onOpen: () => void; onDropFiles: (files: File[]) => void;
  recentProjects?: RecentProject[];
  onOpenRecent?: (entry: RecentProject) => void;
  onRemoveRecent?: (entry: RecentProject) => void;
  menu?:ReactNode;
};

export function HomeScreen({ disabled, onNew, onOpen, onDropFiles, recentProjects = [], onOpenRecent, onRemoveRecent,menu }: Props) {
  const [dragging, setDragging] = useState(false);
  const create = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  useEffect(() => { if (!disabled && !focused.current) { create.current?.focus(); focused.current = true; } }, [disabled]);
  const leave = (event: DragEvent) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); };
  return <div className="home-screen" data-testid="home-screen" inert={disabled} onDragOver={event => {
    if (disabled || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true);
  }} onDragLeave={leave} onDrop={event => {
    event.preventDefault(); setDragging(false); if (!disabled) onDropFiles(Array.from(event.dataTransfer.files));
  }}>
    <header className="home-topbar"><BrandMark size={29}/><span>KurAudio</span>{menu}</header>
    <main className={`home-main ${dragging ? 'is-drag-over' : ''}`} aria-labelledby="home-title">
      <div className="welcome-projects">
      <div className="home-project-heading"><h1 id="home-title">Proyek</h1>
      <div className="home-actions">
        <button ref={create} className="home-action home-action-new" aria-label="Proyek baru" aria-keyshortcuts="Control+N" disabled={disabled} onClick={onNew}>
          <Plus size={17}/><span>Proyek baru</span><kbd>Ctrl+N</kbd>
        </button>
        <button className="home-action home-action-open" aria-label="Buka dari berkas" aria-keyshortcuts="Control+O" disabled={disabled} onClick={onOpen}>
          <FolderOpen size={17}/><span>Buka dari berkas</span><ArrowUpRight size={14}/>
        </button>
      </div>
      </div>
      <div className="home-dropzone" aria-live="polite"><span className="home-drop-icon" aria-hidden="true"><Waveform size={30}/></span><div><h2>{dragging ? 'Lepas untuk membuka' : 'Tarik audio ke sini'}</h2><p className="home-drop-hint">Audio langsung menjadi proyek baru. Berkas .kura juga bisa dibuka.</p></div></div>
      <section className="home-recents" aria-labelledby="home-recents-title">
        <h2 id="home-recents-title">Terakhir dibuka</h2>
        {!recentProjects.length&&<div className="home-empty"><FolderOpen size={20} aria-hidden="true"/><p>Belum ada proyek terakhir</p></div>}
        <ul className="recent-project-list">{recentProjects.map(entry => {
          const date = new Date(entry.time), validDate = Number.isFinite(date.getTime());
          return <li key={entry.id} className="recent-project-row">
            <button className="recent-project-open" aria-label={`Buka ${entry.name}`} disabled={disabled || !onOpenRecent} onClick={() => onOpenRecent?.(entry)}>
              <FolderOpen size={19} aria-hidden="true"/>
              <span className="recent-project-text"><strong data-tooltip={entry.name}>{entry.name}</strong><small className={entry.path === null ? 'recent-project-browser' : undefined} data-tooltip={entry.path ?? undefined}>{entry.path ?? 'Lokal di browser'}</small></span>
              {validDate && <time className="recent-project-date" dateTime={date.toISOString()} data-tooltip={date.toLocaleString('id-ID')}>{date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}</time>}
            </button>
            {onRemoveRecent && <button className="recent-project-remove" aria-label={`Hapus ${entry.name} dari daftar terbaru`} data-tooltip="Hapus dari daftar terbaru" disabled={disabled} onClick={() => onRemoveRecent(entry)}><X size={15} aria-hidden="true"/></button>}
          </li>;
        })}</ul>
      </section>
      </div>
    </main>
    <footer className="home-footer"><span>{appVersion}</span></footer>
  </div>;
}
