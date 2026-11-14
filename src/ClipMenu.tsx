import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export type ClipAction = 'split' | 'cut' | 'copy' | 'paste' | 'duplicate' | 'delete' | 'join' | 'effects' | 'export' | 'group' | 'ungroup' | 'lock' | 'unlock' | 'precision' | 'loudness';

type Props = {
  x: number;
  y: number;
  canJoin: boolean;
  canPaste: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  locked?: boolean;
  hasClipLocks?: boolean;
  onAction: (action: ClipAction) => void;
  onDismiss: (restoreFocus: boolean) => void;
};

const actions: { action: ClipAction; label: string; shortcut?: string }[] = [
  { action: 'split', label: 'Pisahkan di playhead', shortcut: 'Ctrl+B' },
  { action: 'cut', label: 'Potong', shortcut: 'Ctrl+X' },
  { action: 'copy', label: 'Salin', shortcut: 'Ctrl+C' },
  { action: 'paste', label: 'Tempel', shortcut: 'Ctrl+V' },
  { action: 'duplicate', label: 'Duplikat', shortcut: 'Ctrl+D' },
  { action: 'delete', label: 'Hapus', shortcut: 'Del' },
  { action: 'join', label: 'Sambungkan', shortcut: 'Ctrl+J' },
  { action: 'effects', label: 'Efek klip', shortcut: 'E' },
  { action: 'precision', label: 'Edit presisi' },
  { action: 'loudness', label: 'Samakan loudness' },
  { action: 'group', label: 'Grupkan', shortcut: 'Ctrl+G' },
  { action: 'ungroup', label: 'Pisahkan grup', shortcut: 'Ctrl+Shift+G' },
  { action: 'lock', label: 'Kunci klip', shortcut: 'Ctrl+L' },
  { action: 'unlock', label: 'Buka kunci klip', shortcut: 'Ctrl+L' },
  { action: 'export', label: 'Ekspor pilihan' },
];

export function ClipMenu({ x, y, canJoin, canPaste, canGroup = false, canUngroup = false, locked = false, hasClipLocks = locked, onAction, onDismiss }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const disabled = (action: ClipAction) => (locked && ['split', 'cut', 'delete', 'join', 'effects', 'loudness', 'group', 'ungroup'].includes(action)) || (action === 'join' ? !canJoin : action === 'paste' ? !canPaste : action === 'group' ? !canGroup : action === 'ungroup' ? !canUngroup : false);
  useLayoutEffect(() => {
    const el = menu.current!;
    const place = () => {
      const rect = el.getBoundingClientRect();
      const margin = parseFloat(getComputedStyle(document.documentElement).fontSize) / 2;
      const left = Math.max(margin, Math.min(x, innerWidth - rect.width - margin));
      const top = Math.max(margin, Math.min(y, innerHeight - rect.height - margin));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place); observer.observe(el);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) onDismiss(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); };
  }, [onDismiss]);
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep application and browser editing shortcuts away from an open menu.
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); onDismiss(true); return; }
    if (event.key === 'Tab') { onDismiss(false); return; }
    const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (!event.repeat) buttons[index]?.click();
    }
  };
  return createPortal(<div ref={menu} className="clip-menu" role="menu" aria-label="Aksi klip" style={position} onKeyDown={key} onContextMenu={event => event.preventDefault()}>
    {actions.filter(({ action }) => action !== (hasClipLocks ? 'lock' : 'unlock')).map(({ action, label, shortcut }, index) => <button key={action} type="button" role="menuitem" tabIndex={index === 0 ? 0 : -1} disabled={disabled(action)} className={action === 'delete' ? 'clip-menu-destructive' : undefined} onClick={() => onAction(action)}>
      <span>{label}</span>{shortcut && <span className="clip-menu-shortcut" aria-hidden="true">{shortcut}</span>}
    </button>)}
  </div>, document.body);
}
