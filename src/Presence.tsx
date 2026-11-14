import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Phase = 'entering' | 'entered' | 'exiting';
const PresencePhase = createContext<Phase>('entered');
const PresenceFocus = createContext<HTMLElement | null>(null);
export const usePresencePhase = () => useContext(PresencePhase);
export const usePresenceFocus = () => useContext(PresenceFocus);

/** Keeps an overlay mounted through its exit; reversing a close cancels removal. */
export function Presence({ visible, children, className = '' }: { visible: boolean; children: ReactNode; className?: string }) {
  const [phase, setPhase] = useState<Phase | null>(visible ? 'entering' : null);
  const previous = useRef(children);
  const focus = useRef<HTMLElement | null>(null);
  // Remember the trigger before the workspace becomes inert and loses focus.
  useLayoutEffect(() => {
    if (visible) return;
    const remember = (event: FocusEvent) => { const target = event.target; if (target instanceof HTMLElement && !target.closest('.modal-backdrop,.busy-overlay')) focus.current = target; };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, [visible]);
  useLayoutEffect(() => { if (visible) previous.current = children; }, [visible, children]);
  useLayoutEffect(() => {
    let frame = 0, nextFrame = 0, timer = 0;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => setPhase(visible ? 'entered' : null);
    if (visible) {
      setPhase(current => current === 'entered' ? current : 'entering');
      if (query.matches) finish();
      else frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(finish); });
    } else {
      setPhase(current => current ? 'exiting' : null);
      const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-exit'));
      timer = window.setTimeout(finish, query.matches ? 0 : duration);
    }
    const changed = () => { if (query.matches) { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); clearTimeout(timer); finish(); } };
    query.addEventListener('change', changed);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); clearTimeout(timer); query.removeEventListener('change', changed); };
  }, [visible]);
  if (!phase) return null;
  return <PresenceFocus value={focus.current}><PresencePhase value={phase}><div className={`motion-presence ${className}`} data-state={phase} inert={!visible} aria-hidden={!visible || undefined}>{visible ? children : previous.current}</div></PresencePhase></PresenceFocus>;
}
