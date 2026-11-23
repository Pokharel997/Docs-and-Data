'use strict';
// Tiny key-value store: IndexedDB (can hold File objects and file handles), localStorage as a fallback.
const Store = (() => {
  let dbp = null;
  const db = () => dbp ||= new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no indexedDB'));
    const r = indexedDB.open('data-docs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const q = fn(d.transaction('kv', mode).objectStore('kv'));
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  };
  const plain = v => JSON.stringify(v, (k, x) => (x instanceof Blob || (window.FileSystemHandle && x instanceof FileSystemHandle)) ? undefined : x);
  return {
    async get(key) {
      try { return await tx('readonly', s => s.get(key)); }
      catch { try { return JSON.parse(localStorage.getItem('dd.kv.' + key) || 'null') ?? undefined; } catch { return undefined; } }
    },
    async set(key, value) {
      try { await tx('readwrite', s => s.put(value, key)); }
      catch { try { localStorage.setItem('dd.kv.' + key, plain(value)); } catch { /* storage full */ } }
    },
  };
})();
