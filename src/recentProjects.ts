export type RecentProject = { id: string; name: string; path: string | null; time: number };
type RecentInput = { id: string; name: string; path: string | null; content?: string };
// Blob cloning keeps Home's metadata list from decoding up to 64 MiB of snapshot strings.
type StoredRecent = RecentProject & { content?: Blob };
const maximumSnapshotBytes = 64 * 1024 * 1024;
const hidden = new Set<string>();
let queue = Promise.resolve();

// Separate from KurAudio/recovery: these are successful explicit file operations only.
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('KurAudioRecents', 1);
    let abandoned = false;
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects', { keyPath: 'id' }); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { abandoned = true; reject(new Error('Recent-project storage is busy.')); };
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.then(() => {}, () => {});
  return result;
}
async function withRecords<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, rows: unknown[]) => T): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = database.transaction('projects', mode); }
    catch (error) { database.close(); reject(error); return; }
    let result: T;
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Recent-project storage failed.')); };
    try {
      const store = transaction.objectStore('projects'), request = store.getAll();
      request.onsuccess = () => {
        try { result = action(store, request.result); }
        catch (error) { transaction.abort(); database.close(); reject(error); }
      };
    } catch (error) { transaction.abort(); database.close(); reject(error); }
  });
}
function pathKey(path: string): string {
  return /^[a-z]:[\\/]|^[\\/]{2}/i.test(path) ? path.replaceAll('/', '\\').toLowerCase() : path;
}
function validate(value: unknown): StoredRecent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  // Allow minor clock skew, but do not let a corrupt future date poison MRU timestamps.
  if (typeof row.id !== 'string' || !row.id.trim() || typeof row.name !== 'string' || !row.name.trim() || typeof row.time !== 'number' || !Number.isFinite(row.time) || row.time < 0 || row.time > Date.now() + 86400000) return null;
  if (row.path !== null && (typeof row.path !== 'string' || !row.path.trim())) return null;
  const entry: StoredRecent = { id: row.id, name: row.name, path: row.path, time: row.time };
  if (row.path === null) {
    if (!(row.content instanceof Blob) || !row.content.size || row.content.size > maximumSnapshotBytes) return null;
    entry.content = row.content;
  }
  return entry;
}
function bounded(rows: StoredRecent[]): StoredRecent[] {
  const ids = new Set<string>(), paths = new Set<string>();
  const entries = rows.sort((a, b) => b.time - a.time).filter(row => {
    const path = row.path === null ? null : pathKey(row.path);
    if (ids.has(row.id) || path !== null && paths.has(path)) return false;
    ids.add(row.id); if (path !== null) paths.add(path); return true;
  }).slice(0, 8);
  let bytes = entries.reduce((sum, row) => sum + (row.content?.size ?? 0), 0);
  while (bytes > maximumSnapshotBytes) { const removed = entries.pop()!; bytes -= removed.content?.size ?? 0; }
  return entries;
}
function validRows(rows: unknown[]): StoredRecent[] { return rows.map(validate).filter((row): row is StoredRecent => row !== null); }
function publicEntry({ id, name, path, time }: StoredRecent): RecentProject { return { id, name, path, time }; }
async function removeStored(id: string): Promise<void> {
  await withRecords('readwrite', store => { store.delete(id); });
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  return enqueue(async () => {
    try { return await withRecords('readonly', (_store, rows) => bounded(validRows(rows).filter(row => !hidden.has(row.id))).map(publicEntry)); }
    catch { return []; }
  });
}

/** False means no current reopenable snapshot/path was persisted; file saving still succeeds. */
export async function rememberRecentProject(project: RecentInput): Promise<boolean> {
  const input = { ...project };
  return enqueue(async () => {
    try {
      const candidate = validate({ ...input, time: Date.now(), content: input.path === null && typeof input.content === 'string' ? new Blob([input.content], { type: 'application/json' }) : undefined });
      if (!candidate) throw new Error('Recent-project metadata or snapshot is invalid.');
      await withRecords('readwrite', (store, rows) => {
        const previous = validRows(rows);
        candidate.time = Math.max(Date.now(), ...previous.map(row => row.time + 1));
        const retained = bounded([candidate, ...previous.filter(row => row.id !== candidate.id && (candidate.path === null || row.path === null || pathKey(row.path) !== pathKey(candidate.path)))]);
        const retainedIds = new Set(retained.map(row => row.id));
        // getAll rows came from a keyPath store, so every stored id is a valid IDB key.
        for (const row of rows) { const id = (row as { id: IDBValidKey }).id; if (!retainedIds.has(id as string)) store.delete(id); }
        store.put(candidate);
      });
      hidden.delete(candidate.id);
      return true;
    } catch {
      if (input.path === null && typeof input.id === 'string' && input.id) {
        // Do not reopen an older snapshot after a failed explicit browser save.
        hidden.add(input.id);
        try { await removeStored(input.id); } catch { /* Storage denial is nonfatal. */ }
      }
      return false;
    }
  });
}

export async function readRecentProject(id: string): Promise<{ entry: RecentProject; content?: string } | null> {
  return enqueue(async () => {
    if (hidden.has(id)) return null;
    try {
      const row = await withRecords('readonly', (_store, rows) => bounded(validRows(rows).filter(entry => !hidden.has(entry.id))).find(entry => entry.id === id));
      if (!row) return null;
      return row.path === null ? { entry: publicEntry(row), content: await row.content!.text() } : { entry: publicEntry(row) };
    } catch { return null; }
  });
}
export async function forgetRecentProject(id: string): Promise<void> {
  return enqueue(async () => {
    hidden.add(id);
    try { await removeStored(id); } catch { /* Only forget the entry; never touch its file or recovery. */ }
  });
}
