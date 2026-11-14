import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Tip = { target: HTMLElement; text: string };
export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null), element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer = 0, target: HTMLElement | null = null;
    const hide = () => { window.clearTimeout(timer); target = null; setTip(null); };
    const show = (event: Event) => {
      const el = (event.target as HTMLElement)?.closest<HTMLElement>('[data-tooltip]');
      if (!el || el.closest('[inert]') || el.matches(':disabled')) { hide(); return; }
      if (target === el) return;
      hide(); target = el;
      const delay = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-tooltip'));
      timer = window.setTimeout(() => { if (target === el && el.isConnected) setTip({ target: el, text: el.dataset.tooltip! }); }, Number.isFinite(delay) ? delay : 0);
    };
    const leave = (event: Event) => {
      if (target && (event as MouseEvent).relatedTarget instanceof Node && target.contains((event as MouseEvent).relatedTarget as Node)) return;
      hide();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('pointerover', show); document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', show); document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true); document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide); window.addEventListener('blur', hide);
    return () => { hide(); document.removeEventListener('pointerover', show); document.removeEventListener('pointerout', leave); document.removeEventListener('focusin', show); document.removeEventListener('focusout', hide); document.removeEventListener('pointerdown', hide, true); document.removeEventListener('keydown', key); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); window.removeEventListener('blur', hide); };
  }, []);
  useLayoutEffect(() => {
    if (!tip || !element.current) return;
    const el = element.current, rect = tip.target.getBoundingClientRect(), bounds = el.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tooltip-gap')) || 8;
    el.style.left = `${Math.max(gap, Math.min(innerWidth - bounds.width - gap, rect.left + (rect.width - bounds.width) / 2))}px`;
    el.style.top = `${rect.bottom + gap + bounds.height <= innerHeight - gap ? rect.bottom + gap : Math.max(gap, rect.top - bounds.height - gap)}px`;
    const previous = tip.target.getAttribute('aria-describedby');
    tip.target.setAttribute('aria-describedby', [previous, 'kur-tooltip'].filter(Boolean).join(' '));
    return () => { if (previous) tip.target.setAttribute('aria-describedby', previous); else tip.target.removeAttribute('aria-describedby'); };
  }, [tip]);
  return tip ? createPortal(<div className="custom-tooltip" ref={element} id="kur-tooltip" role="tooltip">{tip.text}</div>, document.body) : null;
}
