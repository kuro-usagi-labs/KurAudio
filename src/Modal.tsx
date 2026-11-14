import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { usePresenceFocus, usePresencePhase } from './Presence';
export function Modal({ title, children, onClose, busy = false, dismissible = true, kind = 'standard' }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; dismissible?: boolean; kind?: 'standard' | 'export' | 'tools' | 'help' | 'settings' }) {
  const ref = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  const options = useRef({ busy, dismissible }); options.current = { busy, dismissible };
  const titleId = useId();
  const exiting = usePresencePhase() === 'exiting';
  const focusOrigin = usePresenceFocus();
  useEffect(() => {
    if (exiting) return;
    const previous = focusOrigin ?? document.activeElement as HTMLElement | null;
    const root = ref.current!;
    ((!options.current.dismissible ? root.querySelector('.button.primary') : null) as HTMLElement | null ?? root.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!options.current.busy && options.current.dismissible) close.current(); }
      if (e.key === 'Tab') {
        const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(el => el.tabIndex >= 0 && el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (!root.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    // Disabling the focused action (for example during analysis) can move focus to body.
    // Keep Escape and the focus trap available for the whole active dialog.
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [exiting, focusOrigin]);
  return <div className="modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget && !busy && dismissible) onClose(); }}><div className={`modal modal-${kind}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><h2 id={titleId}>{title}</h2>{dismissible && <button className="icon-button" aria-label="Tutup dialog" data-tooltip="Tutup" disabled={busy} onClick={onClose}><X size={18}/></button>}</div><div className="modal-body">{children}</div></div></div>;
}
