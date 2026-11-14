const drafts = new WeakMap<HTMLElement, () => boolean>();
export function registerDraft(element: HTMLElement, commit: () => boolean) {
  drafts.set(element, commit);
  return () => { drafts.delete(element); };
}
/** Flush the focused field before taking a project snapshot. Never blur invalid input. */
export function commitActiveDraft(): boolean {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return true;
  const commit = drafts.get(element);
  if (commit) return commit();
  if (element instanceof HTMLInputElement && !element.checkValidity()) { element.reportValidity(); return false; }
  return true;
}
