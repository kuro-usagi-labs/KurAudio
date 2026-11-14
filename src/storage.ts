import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { audioContext, media, putMedia, type Media, MAX_DECODED_BYTES, peaksFor } from './audio';
import { type Project, validateProject } from './model';

export const desktop = isTauri();
export const MAX_PROJECT_BYTES = 400 * 1024 * 1024;
export async function readProjectFile(file: File): Promise<string> { if (file.size > MAX_PROJECT_BYTES) throw new Error('Proyek melebihi batas ukuran 400 MB.'); return file.text(); }
export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = []; for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(chunks.join(''));
}
export function fromBase64(str: string): Uint8Array { const raw = atob(str); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
export async function decodeBytes(bytes: Uint8Array): Promise<AudioBuffer> {
  try { return await audioContext().decodeAudioData(bytes.slice().buffer as ArrayBuffer); }
  catch {
    if (!desktop) throw new Error('Format audio ini tidak dapat dibaca browser. Coba WAV/MP3 atau gunakan aplikasi desktop.');
    const wav = await invoke<ArrayBuffer>('decode_audio', { bytesBase64: toBase64(bytes) });
    return audioContext().decodeAudioData(wav);
  }
}
export async function importBytes(bytes: Uint8Array, name: string, destination = media) {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('Batas ukuran per berkas adalah 100 MB.');
  return putMedia(await decodeBytes(bytes), bytes, name, undefined, 0, destination);
}
export async function pickAudio(): Promise<{ name: string; bytes: Uint8Array }[] | null> {
  if (!desktop) return null;
  const paths = await open({ multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'aiff', 'aif'] }] });
  if (!paths) return [];
  return Promise.all((Array.isArray(paths) ? paths : [paths]).map(async path => ({ name: path.split(/[\\/]/).at(-1)!, bytes: new Uint8Array(await invoke<ArrayBuffer>('read_audio', { path })) })));
}
export function serializeProject(project: Project): string {
  const version = project.clips.some(clip => clip.effects?.enabled !== undefined) ? 4 : 3;
  const content = JSON.stringify({ format: 'kuraudio', version, project, media: project.assets.map(a => {
    const m = media.get(a.id); if (!m) throw new Error(`Media hilang: ${a.name}`);
    return { id: a.id, data: toBase64(m.bytes) };
  }) });
  if (content.length > MAX_PROJECT_BYTES) throw new Error('Proyek melebihi batas ukuran 400 MB.');
  return content;
}
export async function deserializeProject(content: string): Promise<{ project: Project; decoded: Map<string, Media> }> {
  if (content.length > MAX_PROJECT_BYTES) throw new Error('Proyek melebihi batas ukuran 400 MB.');
  const doc = JSON.parse(content);
  if (!doc || doc.format !== 'kuraudio' || ![1, 2, 3, 4].includes(doc.version) || !Array.isArray(doc.media)) throw new Error('Berkas ini bukan proyek KurAudio yang didukung.');
  const project = validateProject(doc.project), decoded = new Map<string, Media>();
  if (doc.media.length !== project.assets.length) throw new Error('Daftar media proyek tidak lengkap.');
  let size = 0;
  for (const a of project.assets) {
    const entries = doc.media.filter((m: { id: string }) => m.id === a.id);
    if (entries.length !== 1 || typeof entries[0].data !== 'string') throw new Error(`Audio tidak ditemukan: ${a.name}`);
    const bytes = fromBase64(entries[0].data), buffer = await decodeBytes(bytes);
    size += buffer.length * buffer.numberOfChannels * 4;
    if (size > MAX_DECODED_BYTES) throw new Error('Proyek membutuhkan lebih dari 256 MB memori audio.');
    if (Math.abs(buffer.duration - a.duration) > 0.03) throw new Error(`Durasi audio tidak cocok: ${a.name}`);
    decoded.set(a.id, { bytes, buffer, peaks: peaksFor(buffer) });
  }
  return { project, decoded };
}
export function installMedia(decoded: Map<string, Media>) { media.clear(); for (const [id, m] of decoded) media.set(id, m); }
export function download(bytes: Uint8Array | string, name: string, type: string) {
  const data = typeof bytes === 'string' ? bytes : bytes.slice().buffer as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function saveProject(project: Project, currentPath: string | null, saveAs = false, content?: string): Promise<string | null> {
  const name = project.name.replace(/[<>:"/\\|?*]/g, '_');
  if (!desktop) { download(content ?? serializeProject(project), `${name}.kura`, 'application/json'); return 'browser'; }
  const path = !saveAs && currentPath ? currentPath : await save({ defaultPath: `${name}.kura`, filters: [{ name: 'KurAudio Project', extensions: ['kura'] }] });
  if (!path) return null;
  await invoke('write_project', { path, content: content ?? serializeProject(project) }); return path;
}
export async function pickProject(): Promise<{ path: string; content: string } | null> {
  if (!desktop) return null;
  const path = await open({ multiple: false, filters: [{ name: 'KurAudio Project', extensions: ['kura'] }] });
  if (!path) return null;
  const content = await invoke<string>('read_project', { path }); return { path, content };
}

type Recovery = { project: Project; media: { id: string; bytes: Uint8Array }[]; time: number; dirty: boolean };
let database: Promise<IDBDatabase> | undefined;
let persistedMedia = new Set<string>();
let recoveryQueue = Promise.resolve();
function enqueueRecovery<T>(action: () => Promise<T>): Promise<T> { const result = recoveryQueue.then(action); recoveryQueue = result.then(() => {}, () => {}); return result; }
function db() { return database ??= new Promise((resolve, reject) => {
  const req = indexedDB.open('KurAudio', 1); let abandoned = false;
  req.onupgradeneeded = () => req.result.createObjectStore('recovery');
  req.onsuccess = () => { if (abandoned) { req.result.close(); return; } req.result.onversionchange = () => { req.result.close(); database = undefined; persistedMedia.clear(); }; resolve(req.result); };
  req.onerror = () => { database = undefined; reject(req.error); };
  req.onblocked = () => { abandoned = true; database = undefined; reject(new Error('Penyimpanan pemulihan sedang dipakai versi lain.')); };
}); }
export async function autosave(project: Project, dirty: boolean) {
  // Capture binaries before awaiting: opening another project may replace media.
  const snapshot = structuredClone(project), binaries = new Map(snapshot.assets.map(asset => { const audio = media.get(asset.id); if (!audio) throw new Error(`Audio pemulihan hilang: ${asset.name}`); return [asset.id, audio.bytes] as const; }));
  return enqueueRecovery(async () => {
    const database = await db(), transaction = database.transaction('recovery', 'readwrite'), store = transaction.objectStore('recovery'), ids = new Set(binaries.keys());
    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => { persistedMedia = ids; resolve(); }; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      try {
        for (const [id, bytes] of binaries) if (!persistedMedia.has(id)) store.put(bytes, `media:${id}`);
        for (const id of persistedMedia) if (!ids.has(id)) store.delete(`media:${id}`);
        store.put({ project: snapshot, time: Date.now(), dirty, mediaIds: [...ids] }, 'session');
      } catch (error) { transaction.abort(); reject(error); }
    });
  });
}
export async function readRecovery(): Promise<Recovery | null> {
  await recoveryQueue;
  const database = await db(); return new Promise((resolve, reject) => {
    const store = database.transaction('recovery').objectStore('recovery'), req = store.get('session');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const session = req.result;
      if (!session) { resolve(null); return; }
      try { session.project = validateProject(session.project); } catch { reject(new Error('Metadata pemulihan rusak. Buka berkas .kura yang terakhir disimpan.')); return; }
      if (Array.isArray(session.media)) { resolve(session); return; }
      if (!Array.isArray(session.mediaIds)) { reject(new Error('Pemulihan tidak lengkap')); return; }
      const entries: Recovery['media'] = [];
      if (!session.mediaIds.length) { resolve({ ...session, media: [] }); return; }
      for (const id of session.mediaIds) {
        const entry = store.get(`media:${id}`);
        entry.onerror = () => reject(entry.error);
        entry.onsuccess = () => { if (!entry.result) { reject(new Error('Audio pemulihan hilang')); return; } entries.push({ id, bytes: entry.result }); if (entries.length === session.mediaIds.length) { persistedMedia = new Set(session.mediaIds); resolve({ ...session, media: entries }); } };
      }
    };
  });
}
export async function decodeRecovery(recovery: Recovery) {
  return deserializeProject(JSON.stringify({ format: 'kuraudio', version: 1, project: recovery.project, media: recovery.media.map(m => ({ id: m.id, data: toBase64(m.bytes) })) }));
}
export async function clearRecovery(projectId?: string) {
  return enqueueRecovery(async () => { const database = await db(); return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('recovery', 'readwrite'), store = tx.objectStore('recovery'); let cleared = false;
    if (!projectId) { store.clear(); cleared = true; }
    else { const request = store.get('session'); request.onsuccess = () => { if (request.result?.project?.id === projectId) { store.clear(); cleared = true; } }; }
    tx.oncomplete = () => { if (cleared) persistedMedia.clear(); resolve(); }; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); });
}
