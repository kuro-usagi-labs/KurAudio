import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import type {AppPreferences} from './appPreferences';

export type Appearance = AppPreferences['appearance'];
export type ResolvedAppearance = 'light' | 'dark';
export const APPEARANCE_CHANGED = 'kuraudio:appearance-changed';
let firstFrame = 0, lastFrame = 0;
export function resolveAppearance(choice: Appearance, systemDark: boolean): ResolvedAppearance {
  return choice === 'system' ? systemDark ? 'dark' : 'light' : choice;
}
export function applyDocumentAppearance(appearance: ResolvedAppearance) {
  const root = document.documentElement, changed = root.dataset.theme !== appearance;
  if (changed) {
    cancelAnimationFrame(firstFrame); cancelAnimationFrame(lastFrame); root.dataset.appearanceChanging = '';
    firstFrame = requestAnimationFrame(() => { lastFrame = requestAnimationFrame(() => { delete root.dataset.appearanceChanging; }); });
  }
  root.dataset.theme = appearance; root.style.colorScheme = appearance;
  const background = getComputedStyle(root).getPropertyValue('--surface-page').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  if (changed) window.dispatchEvent(new Event(APPEARANCE_CHANGED));
}

let nativeQueue = Promise.resolve(), ticket = 0;
/** Serialize native commands so a slow earlier choice cannot overwrite the newest one. */
export function watchAppearance(choice: Appearance, onNativeError?: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)'); let alive = true;
  const apply = () => {
    if (!alive) return;
    applyDocumentAppearance(resolveAppearance(choice, query.matches));
    if (!isTauri()) return;
    const current = ++ticket;
    nativeQueue = nativeQueue.then(async () => {
      if (!alive || current !== ticket) return;
      const win = getCurrentWindow();
      await win.setTheme(choice === 'system' ? null : choice);
      if (!alive || current !== ticket) return;
      const color = getComputedStyle(document.documentElement).getPropertyValue('--surface-page').trim();
      if (/^#[\da-f]{6}$/i.test(color)) await win.setBackgroundColor([1,3,5].map(index => parseInt(color.slice(index,index+2),16)) as [number,number,number]);
    }).catch(() => { if (alive && current === ticket) onNativeError?.(); });
  };
  const systemChanged = () => { if (choice === 'system') apply(); };
  query.addEventListener('change', systemChanged); apply();
  return () => { alive = false; query.removeEventListener('change', systemChanged); };
}
export function onAppearanceChange(redraw: () => void): () => void {
  window.addEventListener(APPEARANCE_CHANGED, redraw);
  return () => window.removeEventListener(APPEARANCE_CHANGED, redraw);
}
