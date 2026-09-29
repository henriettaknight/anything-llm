/**
 * @fileoverview Output Writer Service
 * Resolves the output root directory for a detection run and writes report files
 * (one xlsx per submodule + a global token_statistics.xlsx) into a per-run folder
 * using the File System Access API. Falls back to a browser saveAs download when the
 * API is unavailable.
 *
 * Output root resolution follows config.outputDirMode:
 *  - 'input'  (default): write inside the selected input directory
 *  - 'parent'           : write inside the input directory's parent (best-effort)
 *  - 'fixed'            : write inside a `detection_output/` subfolder of the input dir
 *  - 'custom'           : write to a user-picked directory, persisted in IndexedDB
 */

// Reuse the same IndexedDB database/store as the input directory handle.
const DB_NAME = 'AnythingLLM';
const STORE_NAME = 'directoryHandles';
const CUSTOM_OUTPUT_KEY = 'autodetection-custom-output-dir';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, handle: value });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result?.handle || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persist the custom output directory handle (cross-session reuse).
 * @param {FileSystemDirectoryHandle} handle
 */
async function persistCustomOutputHandle(handle) {
  if (!handle || typeof window === 'undefined' || !window.indexedDB) return;
  try {
    await idbPut(CUSTOM_OUTPUT_KEY, handle);
  } catch (e) {
    console.error('❌ Failed to persist custom output directory handle', e);
  }
}

/**
 * Restore a previously persisted custom output directory handle.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function restoreCustomOutputHandle() {
  if (typeof window === 'undefined' || !window.indexedDB) return null;
  try {
    return await idbGet(CUSTOM_OUTPUT_KEY);
  } catch (e) {
    console.error('❌ Failed to restore custom output directory handle', e);
    return null;
  }
}

/**
 * Remove a previously persisted custom output directory handle.
 */
async function clearCustomOutputHandle() {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(CUSTOM_OUTPUT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('❌ Failed to clear custom output directory handle', e);
  }
}

async function queryWritablePermission(handle) {
  if (!handle || !handle.queryPermission) return 'granted';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

async function ensureWritablePermission(handle) {
  const current = await queryWritablePermission(handle);
  if (current === 'granted') return true;
  if (!handle.requestPermission) return false;
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Resolve the output root directory handle for this run.
 * @param {Object} config - detection config ({ outputDirMode, customOutputDirHandle })
 * @param {FileSystemDirectoryHandle} inputDirHandle - the selected input directory handle
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function resolveOutputRoot(config, inputDirHandle) {
  const mode = config?.outputDirMode || 'input';

  if (mode === 'custom') {
    let handle = config?.customOutputDirHandle || (await restoreCustomOutputHandle());
    if (handle) {
      if (await ensureWritablePermission(handle)) return handle;
      console.warn('⚠️ Custom output directory permission denied, falling back to input directory');
      return inputDirHandle;
    }
    // No cached handle → ask the user (first run / after clear).
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      try {
        const picked = await window.showDirectoryPicker();
        if (await ensureWritablePermission(picked)) {
          await persistCustomOutputHandle(picked);
          return picked;
        }
      } catch (e) {
        if (e?.name !== 'AbortError') {
          console.error('❌ Failed to pick custom output directory', e);
        }
      }
    }
    return inputDirHandle;
  }

  if (mode === 'fixed') {
    if (!inputDirHandle) return inputDirHandle;
    return await inputDirHandle.getDirectoryHandle('detection_output', { create: true });
  }

  if (mode === 'parent') {
    if (inputDirHandle?.getParent) {
      try {
        const parent = await inputDirHandle.getParent();
        if (parent) return parent;
      } catch (e) {
        console.error('❌ Failed to get parent directory handle', e);
      }
    }
    console.warn('⚠️ Parent directory handle unavailable, falling back to input directory');
    return inputDirHandle;
  }

  // default: 'input'
  return inputDirHandle;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan existing run folders of form `{projectType}_{YYYYMMDD}_NN` under outputRoot
 * and return the next sequence number (max found + 1).
 * @param {FileSystemDirectoryHandle} outputRoot
 * @param {string} projectType
 * @param {string} runDate - YYYYMMDD
 * @returns {Promise<number>}
 */
async function nextRunSeq(outputRoot, projectType, runDate) {
  let seq = 0;
  if (outputRoot && typeof outputRoot.keys === 'function') {
    try {
      const re = new RegExp(`^${escapeRegExp(projectType)}_${runDate}_(\\d{2})$`);
      for await (const name of outputRoot.keys()) {
        const m = name.match(re);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > seq) seq = n;
        }
      }
    } catch (e) {
      console.error('❌ Failed to scan existing run folders', e);
    }
  }
  return seq + 1;
}

/**
 * Write a Blob/ArrayBuffer into the given directory handle.
 * Falls back to a browser saveAs download when the File System Access API
 * is unavailable or fails (main flow is never blocked).
 * @param {FileSystemDirectoryHandle|null} dirHandle
 * @param {string} fileName
 * @param {Blob|ArrayBuffer} data
 * @returns {Promise<void>}
 */
async function writeBlobToDir(dirHandle, fileName, data) {
  const blob = data instanceof Blob
    ? data
    : new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
    try {
      const fh = await dirHandle.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      console.error('❌ Failed to write file via File System Access API, falling back to saveAs', e);
    }
  }

  // Fallback: trigger a browser download (saveAs)
  console.warn('⚠️ File System Access API unavailable, falling back to saveAs download:', fileName);
  if (typeof window === 'undefined' || !window.document) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.visibility = 'hidden';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const outputWriterService = {
  resolveOutputRoot,
  nextRunSeq,
  writeBlobToDir,
  persistCustomOutputHandle,
  restoreCustomOutputHandle,
  clearCustomOutputHandle,
};

export default outputWriterService;
