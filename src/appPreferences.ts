export type AppPreferences = {
  appearance: 'light' | 'dark' | 'system';
  motion: 'system' | 'reduced';
  previewVolume: number;
  snap: boolean;
  zeroCross: boolean;
  safeCuts: boolean;
  followPlayhead: boolean;
  automaticCheckpoints: boolean;
  checkpointSeconds: 30 | 60 | 120;
};
export const defaultAppPreferences: Readonly<AppPreferences> = Object.freeze({
  appearance: 'dark', motion: 'system', previewVolume: .5, snap: true, zeroCross: false,
  safeCuts: false, followPlayhead: true, automaticCheckpoints: true, checkpointSeconds: 30,
});
const key = 'kuraudio.preferences.v1';
function validated(value: Record<string, unknown>): AppPreferences {
  const result: AppPreferences = { ...defaultAppPreferences };
  for (const name of ['snap','zeroCross','safeCuts','followPlayhead','automaticCheckpoints'] as const) {
    if (typeof value[name] === 'boolean') result[name] = value[name];
  }
  result.motion = value.motion === 'reduced' ? 'reduced' : 'system';
  if (value.appearance === 'light' || value.appearance === 'system') result.appearance = value.appearance;
  if (typeof value.previewVolume === 'number' && Number.isFinite(value.previewVolume)) result.previewVolume = Math.max(0, Math.min(1, value.previewVolume));
  if (value.checkpointSeconds === 60 || value.checkpointSeconds === 120) result.checkpointSeconds = value.checkpointSeconds;
  return result;
}
export function loadAppPreferences(): AppPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value === 'object' && !Array.isArray(value) && 'version' in value && value.version === 1) return validated(value as Record<string, unknown>);
  } catch { /* Defaults remain usable when browser storage is denied. */ }
  return { ...defaultAppPreferences };
}
/** A failed preference write never prevents editing, file saves, or closing. */
export function saveAppPreferences(preferences: AppPreferences): boolean {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, ...validated(preferences) })); return true; }
  catch { return false; }
}
