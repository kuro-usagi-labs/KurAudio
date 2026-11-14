import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { defaultWorkspaceView, loadWorkspace, saveWorkspace } from './workspace';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage); });
afterEach(() => vi.unstubAllGlobals());

describe('local project workspace views', () => {
  it('applies application defaults only to workspaces that have not been saved',()=>{
    const defaults={snap:false,safeCuts:true,followPlayhead:false};
    expect(loadWorkspace('new',defaults)).toMatchObject(defaults);
    saveWorkspace('saved',{...defaultWorkspaceView,mediaOpen:false,inspectorOpen:false,autoInspector:false});
    expect(loadWorkspace('saved',defaults)).toMatchObject({snap:true,safeCuts:false,followPlayhead:true,mediaOpen:false,inspectorOpen:false,autoInspector:false});
  });
  it('restores each project independently without sharing mutable defaults', () => {
    saveWorkspace('first', { ...defaultWorkspaceView, scale: 96, scrollLeft: 640, tool: 'range', mediaOpen: false });
    saveWorkspace('second', { ...defaultWorkspaceView, scale: 24, inspectorOpen: true, trackHeight: 200 });
    expect(loadWorkspace('first')).toMatchObject({ scale: 96, scrollLeft: 640, tool: 'range', mediaOpen: false, trackHeight: 116 });
    expect(loadWorkspace('second')).toMatchObject({ scale: 24, inspectorOpen: true, trackHeight: 200 });
    const missing = loadWorkspace('missing'); missing.scale = 200;
    expect(loadWorkspace('another')).toMatchObject({ scale: 48, mediaWidth: 224, inspectorWidth: 280, trackHeight: 116 });
  });

  it('clamps unsafe sizes and rejects invalid persisted field types', () => {
    saveWorkspace('bounds', { ...defaultWorkspaceView, scale: 999, scrollLeft: -2, scrollTop: NaN, mediaWidth: 1, inspectorWidth: Infinity, trackHeight: 400, tool: 'erase', mediaOpen: 'yes', inspectorOpen: 1, followPlayhead: null } as never);
    expect(loadWorkspace('bounds')).toEqual({ ...defaultWorkspaceView, scale: 960, scrollLeft: 0, scrollTop: 0, mediaWidth: 180, inspectorWidth: 280, trackHeight: 240, tool: 'move', mediaOpen: true, inspectorOpen: false, followPlayhead: true });
    saveWorkspace('minimum', { ...defaultWorkspaceView, scale: 0, inspectorWidth: 1, trackHeight: 0, mediaWidth: 999, scrollTop: 75 });
    expect(loadWorkspace('minimum')).toMatchObject({ scale: 4, inspectorWidth: 240, trackHeight: 104, mediaWidth: 360, scrollTop: 75 });
  });

  it('treats damaged JSON and unsupported storage versions as empty preferences', () => {
    saveWorkspace('saved', { ...defaultWorkspaceView, scale: 96 });
    const key = storage.key(0)!;
    for (const value of ['{broken', 'null', '[]', JSON.stringify({ version: 99, views: [] })]) {
      storage.setItem(key, value);
      expect(loadWorkspace('saved')).toEqual(defaultWorkspaceView);
    }
    saveWorkspace('__proto__', { ...defaultWorkspaceView, scale: 120 });
    expect(loadWorkspace('__proto__').scale).toBe(120);
  });

  it('keeps the 32 most recently saved views and refreshes an existing view', () => {
    for (let i = 0; i < 32; i++) saveWorkspace(`project-${i}`, { ...defaultWorkspaceView, scale: 96 });
    saveWorkspace('project-0', { ...defaultWorkspaceView, scale: 120 });
    saveWorkspace('project-32', { ...defaultWorkspaceView, scale: 144 });
    expect(loadWorkspace('project-1').scale).toBe(48);
    expect(loadWorkspace('project-0').scale).toBe(120);
    expect(loadWorkspace('project-32').scale).toBe(144);
    const value = JSON.parse(storage.getItem(storage.key(0)!)!);
    expect(value.views).toHaveLength(32);
  });

  it('ignores malformed records while retaining valid project preferences', () => {
    saveWorkspace('safe', { ...defaultWorkspaceView, scrollTop: 91 });
    const key = storage.key(0)!, value = JSON.parse(storage.getItem(key)!);
    value.views.unshift(null, { id: 'bad', view: null }, { id: 1, view: {} });
    storage.setItem(key, JSON.stringify(value));
    expect(loadWorkspace('safe').scrollTop).toBe(91);
    expect(loadWorkspace('bad')).toEqual(defaultWorkspaceView);
  });

  it('validates stored fields again before restoring an external or damaged view', () => {
    saveWorkspace('external', defaultWorkspaceView);
    const key = storage.key(0)!, value = JSON.parse(storage.getItem(key)!);
    value.views[0].view = { scale: '120', scrollLeft: -400, scrollTop: 84, mediaWidth: 999, inspectorWidth: 999, trackHeight: -1, tool: 'delete', followPlayhead: 0, mediaOpen: false, inspectorOpen: true };
    storage.setItem(key, JSON.stringify(value));
    expect(loadWorkspace('external')).toEqual({ ...defaultWorkspaceView, scale: 48, scrollLeft: 0, scrollTop: 84, mediaWidth: 360, inspectorWidth: 420, trackHeight: 104, tool: 'move', followPlayhead: true, mediaOpen: false, inspectorOpen: true });
  });

  it('does not let blocked local storage interrupt project use', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new DOMException('Blocked', 'SecurityError'); }, setItem() { throw new DOMException('Full', 'QuotaExceededError'); } });
    expect(loadWorkspace('project')).toEqual(defaultWorkspaceView);
    expect(() => saveWorkspace('project', defaultWorkspaceView)).not.toThrow();
  });
});
