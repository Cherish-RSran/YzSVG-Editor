/** 极简 IndexedDB 封装（不引第三方依赖），用于工程自动保存与历史快照 */

const DB_NAME = 'svg-editor';
const DB_VERSION = 1;
const STORE = 'docs';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * 打开数据库。
 *
 * 两个必须处理的现实情况：
 * 1. **open 可能永远不 settle**：当有别处发起了 `deleteDatabase`（比如用户清站点数据、
 *    或另一个标签页正在删库）时，新的 open 请求会被一直挂起，既不 success 也不 error。
 *    这时整个「启动探测 → 弹窗询问 → 启动自动保存」链路都会卡死，表现为"从来不问我、
 *    也从来不自动保存"。所以必须加超时：超时后判定为不可用，由调用方降级到 localStorage。
 * 2. 隐私模式等场景下 `indexedDB` 直接不存在，同样要降级而不是抛错。
 */
const OPEN_TIMEOUT = 1500;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };
    const timer = window.setTimeout(
      () => done(() => reject(new Error('IndexedDB 打开超时'))),
      OPEN_TIMEOUT,
    );
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => done(() => resolve(req.result));
    req.onerror = () => done(() => reject(req.error ?? new Error('IndexedDB 打开失败')));
    // 被 deleteDatabase 阻塞时：明确放弃这次打开，别让调用方无限等下去
    req.onblocked = () => done(() => reject(new Error('IndexedDB 打开被阻塞')));
  });
  // 失败不算定局：清掉缓存，下次调用可以再试一次（比如删库阻塞结束后）
  dbPromise = opening.catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 隐私模式等场景下静默失败，降级到 localStorage 由调用方处理 */
  }
}

export async function idbGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result?.value as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: number;
  svg: string;
}

const SNAP_KEY = 'snapshots';

export async function listSnapshots(): Promise<Snapshot[]> {
  const list = await idbGet<Snapshot[]>(SNAP_KEY);
  return Array.isArray(list) ? list : [];
}

export async function pushSnapshot(svg: string, name = '手动快照', limit = 20): Promise<void> {
  const list = await listSnapshots();
  list.unshift({ id: `s${Date.now().toString(36)}`, name, createdAt: Date.now(), svg });
  await idbSet(SNAP_KEY, list.slice(0, limit));
}

export async function deleteSnapshot(id: string): Promise<void> {
  const list = await listSnapshots();
  await idbSet(SNAP_KEY, list.filter((s) => s.id !== id));
}

export async function setSnapshotName(id: string, name: string): Promise<void> {
  const list = await listSnapshots();
  await idbSet(
    SNAP_KEY,
    list.map((s) => (s.id === id ? { ...s, name } : s)),
  );
}
