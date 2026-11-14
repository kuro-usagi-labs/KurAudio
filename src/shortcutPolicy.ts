export type ShortcutContext = 'workspace'|'text'|'range'|'media'|'menu'|'dialog'|'switch';
type Key = {key:string;code:string;ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean;isComposing:boolean;repeat:boolean};
/** Route reserved global commands; null leaves the key with its local control. */
export function resolveShortcut(e:Key, context:ShortcutContext): 'save'|'saveAs'|'transport'|null {
  if(e.isComposing||context==='dialog'||context==='menu')return null;
  const ctrl=e.ctrlKey||e.metaKey;
  if(ctrl&&!e.altKey&&e.key.toLowerCase()==='s')return e.repeat?null:e.shiftKey?'saveAs':'save';
  if(e.code==='Space'&&!ctrl&&!['text','media','switch'].includes(context))return e.repeat?null:'transport';
  return null;
}
export function shortcutContext(target:HTMLElement):ShortcutContext {
  if(target.closest('[role="dialog"]'))return 'dialog';
  if(target.closest('[role="menu"],[role="menubar"]'))return 'menu';
  if(target.closest('.asset-item,.media-preview'))return 'media';
  if(target.getAttribute('role')==='switch')return 'switch';
  if(target instanceof HTMLInputElement&&target.type==='range')return 'range';
  if(target.matches('input,textarea,select')||target.isContentEditable)return 'text';
  return 'workspace';
}
