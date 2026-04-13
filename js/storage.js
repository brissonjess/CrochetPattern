/**
 * storage.js — File-based project persistence
 *
 * Projects are stored as individual JSON files inside a user-chosen
 * "projects folder" (defaults to the projects/ subfolder next to index.html).
 * The FileSystemDirectoryHandle is persisted in a small config IndexedDB so
 * the user only needs to grant permission once per browser session.
 *
 * Falls back gracefully when the File System Access API is unavailable or
 * permission has been revoked — showing a reconnect prompt instead of crashing.
 */

CrochetApp.Storage = (() => {
  'use strict';

  // ── Config IndexedDB (stores the dir handle + migration flag) ─────────────
  const CFG_DB_NAME  = 'CrochetTapestryConfig';
  const CFG_DB_VER   = 1;
  const CFG_STORE    = 'config';
  const KEY_DIR      = 'projectsDirHandle';
  const KEY_MIGRATED = 'migratedFromIDB';

  // ── Legacy IndexedDB (read-only, used for one-time migration) ─────────────
  const LEGACY_DB_NAME = 'CrochetTapestryApp';
  const LEGACY_STORE   = 'projects';

  let _cfgDb     = null;
  let _dirHandle = null; // FileSystemDirectoryHandle | null

  // ── Config DB helpers ─────────────────────────────────────────────────────

  function _openCfgDb() {
    if (_cfgDb) return Promise.resolve(_cfgDb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CFG_DB_NAME, CFG_DB_VER);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(CFG_STORE);
      };
      req.onsuccess = e => { _cfgDb = e.target.result; resolve(_cfgDb); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function _cfgGet(key) {
    const db = await _openCfgDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(CFG_STORE, 'readonly').objectStore(CFG_STORE).get(key);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function _cfgSet(key, value) {
    const db = await _openCfgDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(CFG_STORE, 'readwrite').objectStore(CFG_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Directory handle management ───────────────────────────────────────────

  /**
   * Returns the current dir handle if permission is already granted, or null.
   * Does NOT prompt the user — call setupFolder() or requestAccess() for that.
   */
  async function getDirHandle() {
    if (_dirHandle) return _dirHandle;

    const handle = await _cfgGet(KEY_DIR);
    if (!handle) return null;

    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        _dirHandle = handle;
        return _dirHandle;
      }
    } catch (_) { /* handle may be stale */ }

    return null; // need user gesture to call requestPermission
  }

  /**
   * Called in response to a user gesture when permission is 'prompt'.
   * Returns true if access was granted.
   */
  async function requestAccess() {
    const handle = await _cfgGet(KEY_DIR);
    if (!handle) return false;
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        _dirHandle = handle;
        return true;
      }
    } catch (_) {}
    return false;
  }

  /**
   * Returns 'granted' | 'prompt' | 'none' — used on startup to decide
   * what UI to show without triggering a permission prompt.
   */
  async function getPermissionState() {
    const handle = await _cfgGet(KEY_DIR);
    if (!handle) return 'none';
    try {
      return await handle.queryPermission({ mode: 'readwrite' });
    } catch (_) {
      return 'none';
    }
  }

  /**
   * Show the directory picker, save the chosen handle, then run migration.
   * Must be called from a user gesture (button click).
   * Returns the chosen FileSystemDirectoryHandle.
   */
  async function setupFolder() {
    if (!window.showDirectoryPicker) {
      throw new Error('File System Access API is not supported in this browser.');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _dirHandle = handle;
    await _cfgSet(KEY_DIR, handle);
    await migrateFromIndexedDB(); // no-op if already done
    return handle;
  }

  /** Human-readable folder name for the currently configured handle. */
  async function getFolderName() {
    const handle = await _cfgGet(KEY_DIR);
    return handle ? handle.name : null;
  }

  // ── File-based project CRUD ───────────────────────────────────────────────

  function _filename(id) { return id + '.json'; }

  async function saveProject(project) {
    const dir = await getDirHandle();
    if (!dir) throw new Error('No projects folder configured. Please set up your projects folder first.');

    const serialized = CrochetApp.serializeProject(project);
    const json       = JSON.stringify(serialized, null, 2);

    const fileHandle = await dir.getFileHandle(_filename(project.id), { create: true });
    const writable   = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
  }

  async function loadProject(id) {
    const dir = await getDirHandle();
    if (!dir) return null;
    try {
      const fileHandle = await dir.getFileHandle(_filename(id));
      const file       = await fileHandle.getFile();
      const text       = await file.text();
      return CrochetApp.deserializeProject(JSON.parse(text));
    } catch (e) {
      if (e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async function listProjects() {
    const dir = await getDirHandle();
    if (!dir) return [];

    const summaries = [];
    for await (const [name, handle] of dir.entries()) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = await handle.getFile();
        const raw  = JSON.parse(await file.text());
        // Support both v1 (raw.grid) and v2 (raw.panels[]) formats
        const firstGrid = raw.grid || (raw.panels && raw.panels[0] && raw.panels[0].grid) || {};
        const panelCount = raw.panels ? raw.panels.length : 1;
        summaries.push({
          id:         raw.id,
          name:       raw.name,
          technique:  raw.technique,
          garmentId:  raw.garmentId || 'blank',
          panelCount,
          createdAt:  raw.createdAt,
          updatedAt:  raw.updatedAt,
          gridWidth:  firstGrid.width  || 0,
          gridHeight: firstGrid.height || 0,
        });
      } catch (_) { /* skip malformed files */ }
    }

    summaries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return summaries;
  }

  async function deleteProject(id) {
    const dir = await getDirHandle();
    if (!dir) return;
    try {
      await dir.removeEntry(_filename(id));
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e;
    }
  }

  // ── One-time migration from legacy IndexedDB ──────────────────────────────

  async function migrateFromIndexedDB() {
    const already = await _cfgGet(KEY_MIGRATED);
    if (already) return 0;

    const dir = await getDirHandle();
    if (!dir) return 0;

    let count = 0;
    try {
      const legacyProjects = await _readAllFromLegacyIDB();
      for (const raw of legacyProjects) {
        try {
          // Only migrate if the file doesn't already exist
          try { await dir.getFileHandle(_filename(raw.id)); continue; } catch (_) {}

          const project  = CrochetApp.deserializeProject(raw);
          const json     = JSON.stringify(CrochetApp.serializeProject(project), null, 2);
          const fh       = await dir.getFileHandle(_filename(project.id), { create: true });
          const writable = await fh.createWritable();
          await writable.write(json);
          await writable.close();
          count++;
        } catch (_) { /* skip individual failures */ }
      }
    } catch (_) { /* legacy DB may not exist — that's fine */ }

    await _cfgSet(KEY_MIGRATED, true);
    return count;
  }

  function _readAllFromLegacyIDB() {
    return new Promise((resolve, _reject) => {
      const req = indexedDB.open(LEGACY_DB_NAME, 1);
      req.onerror = () => resolve([]); // DB doesn't exist
      req.onsuccess = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE)) { resolve([]); return; }
        const tx  = db.transaction(LEGACY_STORE, 'readonly');
        const all = tx.objectStore(LEGACY_STORE).getAll();
        all.onsuccess = ev => resolve(ev.target.result || []);
        all.onerror   = () => resolve([]);
      };
    });
  }

  return {
    // Core CRUD
    saveProject,
    loadProject,
    listProjects,
    deleteProject,
    // Folder management
    setupFolder,
    getDirHandle,
    requestAccess,
    getPermissionState,
    getFolderName,
    // Migration
    migrateFromIndexedDB,
  };
})();