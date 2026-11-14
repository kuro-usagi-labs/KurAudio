export type WorkspaceView = {
  scale: number; scrollLeft: number; scrollTop: number;
  mediaWidth: number; inspectorWidth: number; trackHeight: number;
  mediaOpen: boolean; inspectorOpen: boolean;
  tool: 'move' | 'cut' | 'range' | 'gain'; followPlayhead: boolean;
  libraryTab?: 'media' | 'history'; rippleScope?: 'off'|'track'|'all'; zeroCross?:boolean; safeCuts?:boolean;
  snap?:boolean; autoInspector?:boolean;
};
export const defaultWorkspaceView: WorkspaceView = Object.freeze({ scale: 48, scrollLeft: 0, scrollTop: 0, mediaWidth: 224, inspectorWidth: 280, trackHeight: 116, mediaOpen: true, inspectorOpen: false, tool: 'move', followPlayhead: true, libraryTab:'media', rippleScope:'off', zeroCross:false, safeCuts:false, snap:true, autoInspector:true });
export const workspaceLayouts = [
  {id:'editing',label:'Editing',view:{mediaOpen:true,inspectorOpen:true,mediaWidth:224,inspectorWidth:280,trackHeight:116,autoInspector:true}},
  {id:'focus',label:'Fokus timeline',view:{mediaOpen:false,inspectorOpen:false,mediaWidth:224,inspectorWidth:280,trackHeight:144,autoInspector:false}},
  {id:'mixing',label:'Mixing',view:{mediaOpen:false,inspectorOpen:true,mediaWidth:224,inspectorWidth:320,trackHeight:176,autoInspector:true}},
] as const;

const storageKey = 'kuraudio.workspace.v1';
type StoredView = { id: string; view: WorkspaceView };
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value: unknown, fallback: number, minimum: number, maximum = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
function validateView(value: Record<string, unknown>): WorkspaceView {
  const defaults = defaultWorkspaceView;
  return {
    scale: bounded(value.scale, defaults.scale, 4, 960),
    scrollLeft: bounded(value.scrollLeft, 0, 0), scrollTop: bounded(value.scrollTop, 0, 0),
    mediaWidth: bounded(value.mediaWidth, defaults.mediaWidth, 180, 360),
    inspectorWidth: bounded(value.inspectorWidth, defaults.inspectorWidth, 240, 420),
    trackHeight: bounded(value.trackHeight, defaults.trackHeight, 104, 240),
    mediaOpen: typeof value.mediaOpen === 'boolean' ? value.mediaOpen : defaults.mediaOpen,
    inspectorOpen: typeof value.inspectorOpen === 'boolean' ? value.inspectorOpen : defaults.inspectorOpen,
    tool: value.tool === 'move' || value.tool === 'cut' || value.tool === 'range' || value.tool === 'gain' ? value.tool : defaults.tool,
    followPlayhead: typeof value.followPlayhead === 'boolean' ? value.followPlayhead : defaults.followPlayhead,
    libraryTab:value.libraryTab==='history'?'history':'media',
    rippleScope:value.rippleScope==='track'||value.rippleScope==='all'?value.rippleScope:'off',
    zeroCross:value.zeroCross===true,safeCuts:value.safeCuts===true,
    snap:typeof value.snap==='boolean'?value.snap:true, autoInspector:typeof value.autoInspector==='boolean'?value.autoInspector:true,
  };
}
function storedViews(): StoredView[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!record(value) || value.version !== 1 || !Array.isArray(value.views)) return [];
    const seen = new Set<string>(), views: StoredView[] = [];
    for (const entry of value.views) {
      if (!record(entry) || typeof entry.id !== 'string' || !entry.id || !record(entry.view) || seen.has(entry.id)) continue;
      seen.add(entry.id); views.push({ id: entry.id, view: validateView(entry.view) });
      if (views.length === 32) break;
    }
    return views;
  } catch { return []; }
}

/** Local view preferences never change project data, history, or recovery. */
export function loadWorkspace(projectId: string,defaults:Partial<WorkspaceView>={}): WorkspaceView {
  return storedViews().find(entry => entry.id === projectId)?.view ?? validateView({...defaultWorkspaceView,...defaults});
}
export function saveWorkspace(projectId: string, view: WorkspaceView): void {
  if (typeof projectId !== 'string' || !projectId || !record(view)) return;
  try {
    const views = [{ id: projectId, view: validateView(view) }, ...storedViews().filter(entry => entry.id !== projectId)].slice(0, 32);
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, views }));
  } catch { /* Preference failure must not interrupt editing or saving. */ }
}
