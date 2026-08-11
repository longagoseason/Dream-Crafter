"use strict";

(function exposeSaveManager(global) {
  const SAVE_VERSION = 1;
  const GAME_VERSION = "0.1.0";
  const API_SAVE_URL = "./api/save";
  const DATABASE_NAME = "dream-crafter";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "saves";
  const PRIMARY_KEY = "primary";
  const MASTER_DATA_KEYS = new Set(["data", "tables", "gameData", "masterData", "classes", "equipmentCatalog", "itemCatalog", "monsters", "skills", "maps", "stages"]);

  function clone(value) { return value == null ? null : JSON.parse(JSON.stringify(value)); }

  function prepareSave(save) {
    const prepared = {
      ...clone(save),
      version: SAVE_VERSION,
      saveVersion: SAVE_VERSION,
      gameVersion: GAME_VERSION,
      savedAt: new Date().toISOString(),
    };
    for (const key of MASTER_DATA_KEYS) delete prepared[key];
    return prepared;
  }

  function validateSave(save) {
    const issues = [];
    if (!save || typeof save !== "object" || Array.isArray(save)) issues.push("存檔必須是 JSON 物件");
    if (issues.length) return { valid: false, issues };
    const saveVersion = Number(save.saveVersion ?? save.version);
    if (saveVersion !== SAVE_VERSION) issues.push(`不支援的 saveVersion：${save.saveVersion ?? save.version ?? "未設定"}`);
    if (!Array.isArray(save.roster) || save.roster.length < 3) issues.push("缺少有效的 roster 角色資料");
    if (!Array.isArray(save.inventory)) issues.push("缺少 inventory 背包資料");
    if (!Number.isFinite(Number(save.gold)) || Number(save.gold) < 0) issues.push("gold 必須是大於或等於 0 的數字");
    if (save.roster?.some((hero) => !hero || typeof hero.classId !== "string" || !Number.isFinite(Number(hero.level)))) issues.push("roster 含有無效的職業或等級資料");
    return { valid: issues.length === 0, issues, saveVersion };
  }

  class ApiSaveStorage {
    async load() {
      const response = await fetch(API_SAVE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`玩家存檔 HTTP ${response.status}`);
      return (await response.json()).save;
    }
    async save(save, options = {}) {
      const response = await fetch(API_SAVE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(save),
        keepalive: Boolean(options.keepalive),
      });
      if (!response.ok) throw new Error(`玩家存檔 HTTP ${response.status}`);
      return save;
    }
    async delete() {
      const response = await fetch(API_SAVE_URL, { method: "DELETE" });
      if (!response.ok) throw new Error(`刪除存檔 HTTP ${response.status}`);
    }
  }

  class IndexedDbSaveStorage {
    constructor() { this.databasePromise = null; }
    open() {
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(`IndexedDB 開啟失敗：${request.error?.message ?? "未知錯誤"}`));
      });
      return this.databasePromise;
    }
    async request(mode, operation) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(new Error(`IndexedDB 操作失敗：${request.error?.message ?? "未知錯誤"}`));
      });
    }
    load() { return this.request("readonly", (store) => store.get(PRIMARY_KEY)); }
    async save(save) { await this.request("readwrite", (store) => store.put(save, PRIMARY_KEY)); return save; }
    async delete() { await this.request("readwrite", (store) => store.delete(PRIMARY_KEY)); }
  }

  let storage = null;
  let storageMode = null;
  let lastLoadedSave = null;

  async function initialize(mode) {
    storageMode = mode === "local-api" ? "local-api" : "indexeddb";
    storage = storageMode === "local-api" ? new ApiSaveStorage() : new IndexedDbSaveStorage();
    return storageMode;
  }

  function requireStorage() {
    if (!storage) throw new Error("SaveManager 尚未初始化");
    return storage;
  }

  async function loadGame() {
    lastLoadedSave = clone(await requireStorage().load());
    return clone(lastLoadedSave);
  }

  async function saveGame(save, options = {}) {
    const prepared = prepareSave(save);
    const validation = validateSave(prepared);
    if (!validation.valid) throw new Error(validation.issues.join("；"));
    await requireStorage().save(prepared, options);
    lastLoadedSave = clone(prepared);
    return clone(prepared);
  }

  async function hasSave() { return Boolean(await requireStorage().load()); }
  async function deleteSave() { await requireStorage().delete(); lastLoadedSave = null; }

  function exportFileName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `dream-crafter-save-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
  }

  async function exportSave(save = lastLoadedSave) {
    if (!save) throw new Error("目前沒有可匯出的存檔");
    const prepared = prepareSave(save);
    const blob = new Blob([JSON.stringify(prepared, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName();
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return prepared;
  }

  async function importSave(fileOrObject) {
    let parsed = fileOrObject;
    if (typeof File !== "undefined" && fileOrObject instanceof File) {
      if (!fileOrObject.name.toLowerCase().endsWith(".json")) throw new Error("請選擇 .json 存檔");
      try { parsed = JSON.parse(await fileOrObject.text()); }
      catch { throw new Error("JSON 格式錯誤，未覆蓋目前存檔"); }
    }
    const validation = validateSave(parsed);
    if (!validation.valid) throw new Error(`${validation.issues.join("；")}，未覆蓋目前存檔`);
    return clone(parsed);
  }

  global.DreamerSaveManager = {
    SAVE_VERSION,
    GAME_VERSION,
    initialize,
    loadGame,
    saveGame,
    hasSave,
    deleteSave,
    exportSave,
    importSave,
    validateSave,
    prepareSave,
    get storageMode() { return storageMode; },
    get lastLoadedSave() { return clone(lastLoadedSave); },
  };
})(window);
