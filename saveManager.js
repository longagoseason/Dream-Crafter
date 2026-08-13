"use strict";

(function exposeSaveManager(global) {
  const SAVE_VERSION = 1;
  const API_SAVE_URL = "./api/save";
  const DATABASE_NAME = "dream-crafter";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "saves";
  const SLOT_IDS = Object.freeze(["slot1", "slot2", "slot3", "slot4", "slot5"]);
  const IMPORTED_ID = "imported";
  const ACTIVE_KEY = "active-slot";
  const LEGACY_KEY = "primary";
  const IMPORTED_ORIGINAL_KEY = "imported-original";
  const IMPORTED_WORKING_KEY = "imported-working";
  const MASTER_DATA_KEYS = new Set(["data", "tables", "gameData", "masterData", "classes", "equipmentCatalog", "itemCatalog", "monsters", "skills", "maps", "stages"]);

  let gameVersion = "unknown";
  let storage = null;
  let storageMode = null;
  let lastLoadedSave = null;
  let activeSlotId = null;

  function clone(value) { return value == null ? null : JSON.parse(JSON.stringify(value)); }
  function slotKey(slotId) {
    if (SLOT_IDS.includes(slotId)) return `save-${slotId}`;
    if (slotId === IMPORTED_ID) return IMPORTED_WORKING_KEY;
    throw new Error(`無效的存檔格：${slotId}`);
  }
  function configureGameVersion(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized) throw new Error("PatchNote.csv 無法取得 Current Game Version");
    gameVersion = normalized;
    return gameVersion;
  }
  function prepareSave(save) {
    const prepared = { ...clone(save), version: SAVE_VERSION, saveVersion: SAVE_VERSION, gameVersion, savedAt: new Date().toISOString() };
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
    url(key) { return `${API_SAVE_URL}?key=${encodeURIComponent(key)}`; }
    async get(key) { const response = await fetch(this.url(key), { cache: "no-store" }); if (!response.ok) throw new Error(`玩家存檔 HTTP ${response.status}`); return (await response.json()).save; }
    async keys() { const response = await fetch(API_SAVE_URL, { cache: "no-store" }); if (!response.ok) throw new Error(`玩家存檔 HTTP ${response.status}`); return Object.keys((await response.json()).entries ?? {}); }
    async put(key, value, options = {}) { const response = await fetch(this.url(key), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), keepalive: Boolean(options.keepalive) }); if (!response.ok) throw new Error(`玩家存檔 HTTP ${response.status}`); return value; }
    async delete(key) { const response = await fetch(this.url(key), { method: "DELETE" }); if (!response.ok) throw new Error(`刪除存檔 HTTP ${response.status}`); }
  }

  class IndexedDbSaveStorage {
    constructor() { this.databasePromise = null; }
    open() {
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(`IndexedDB 開啟失敗：${request.error?.message ?? "未知錯誤"}`));
      });
      return this.databasePromise;
    }
    async request(mode, operation) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const request = operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(new Error(`IndexedDB 操作失敗：${request.error?.message ?? "未知錯誤"}`));
      });
    }
    get(key) { return this.request("readonly", (store) => store.get(key)); }
    keys() { return this.request("readonly", (store) => store.getAllKeys()); }
    async put(key, value) { await this.request("readwrite", (store) => store.put(value, key)); return value; }
    async delete(key) { await this.request("readwrite", (store) => store.delete(key)); }
  }

  function requireStorage() { if (!storage) throw new Error("SaveManager 尚未初始化"); return storage; }
  async function initialize(mode) {
    storageMode = mode === "local-api" ? "local-api" : "indexeddb";
    storage = storageMode === "local-api" ? new ApiSaveStorage() : new IndexedDbSaveStorage();
    const legacy = await storage.get(LEGACY_KEY);
    const existingSlot = await storage.get(slotKey("slot1"));
    if (legacy && !existingSlot) await storage.put(slotKey("slot1"), legacy);
    if (legacy) await storage.delete(LEGACY_KEY);
    const active = await storage.get(ACTIVE_KEY);
    activeSlotId = active?.slotId && [...SLOT_IDS, IMPORTED_ID].includes(active.slotId) ? active.slotId : null;
    if (!activeSlotId && (legacy || existingSlot)) await setActiveSlot("slot1");
    return storageMode;
  }
  async function setActiveSlot(slotId) {
    if (slotId !== null && ![...SLOT_IDS, IMPORTED_ID].includes(slotId)) throw new Error(`無效的存檔格：${slotId}`);
    activeSlotId = slotId;
    if (slotId === null) await requireStorage().delete(ACTIVE_KEY);
    else await requireStorage().put(ACTIVE_KEY, { slotId });
  }
  async function loadSlot(slotId) {
    lastLoadedSave = clone(await requireStorage().get(slotKey(slotId)));
    return clone(lastLoadedSave);
  }
  async function saveSlot(slotId, save, options = {}) {
    if (slotId === IMPORTED_ID && options.original) throw new Error("Imported Original 不可由遊戲進度覆寫");
    const prepared = prepareSave(save);
    const validation = validateSave(prepared);
    if (!validation.valid) throw new Error(validation.issues.join("；"));
    await requireStorage().put(slotKey(slotId), prepared, options);
    lastLoadedSave = clone(prepared);
    return clone(prepared);
  }
  async function deleteSlot(slotId) {
    if (slotId === IMPORTED_ID) { await requireStorage().delete(IMPORTED_ORIGINAL_KEY); await requireStorage().delete(IMPORTED_WORKING_KEY); }
    else await requireStorage().delete(slotKey(slotId));
    if (activeSlotId === slotId) { await setActiveSlot(null); lastLoadedSave = null; }
  }
  async function listSlots() {
    const output = {};
    for (const slotId of SLOT_IDS) output[slotId] = clone(await requireStorage().get(slotKey(slotId)));
    output.imported = clone(await requireStorage().get(IMPORTED_WORKING_KEY));
    return output;
  }
  async function importToImported(fileOrObject) {
    const parsed = await parseImport(fileOrObject);
    const original = clone(parsed);
    const working = prepareSave(parsed);
    await requireStorage().put(IMPORTED_ORIGINAL_KEY, original);
    await requireStorage().put(IMPORTED_WORKING_KEY, working);
    return clone(working);
  }
  async function resetImportedWorking() {
    const original = await requireStorage().get(IMPORTED_ORIGINAL_KEY);
    if (!original) throw new Error("Imported Original 不存在");
    const working = prepareSave(original);
    await requireStorage().put(IMPORTED_WORKING_KEY, working);
    return clone(working);
  }
  async function parseImport(fileOrObject) {
    let parsed = fileOrObject;
    if (typeof File !== "undefined" && fileOrObject instanceof File) {
      if (!fileOrObject.name.toLowerCase().endsWith(".json")) throw new Error("請選擇 .json 存檔");
      try { parsed = JSON.parse(await fileOrObject.text()); } catch { throw new Error("JSON 格式錯誤，未覆蓋目前存檔"); }
    }
    const validation = validateSave(parsed);
    if (!validation.valid) throw new Error(`${validation.issues.join("；")}，未覆蓋目前存檔`);
    return clone(parsed);
  }
  function exportFileName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    const safeVersion = gameVersion.replace(/^ver/i, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    return `dream-crafter-save-ver${safeVersion}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
  }
  async function exportSave(save = lastLoadedSave) {
    if (!save) throw new Error("目前沒有可匯出的存檔");
    const prepared = prepareSave(save);
    const blob = new Blob([JSON.stringify(prepared, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = exportFileName(); document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    return prepared;
  }

  global.DreamerSaveManager = {
    SAVE_VERSION, SLOT_IDS, IMPORTED_ID, initialize, configureGameVersion, setActiveSlot, loadSlot, saveSlot, deleteSlot, listSlots,
    importToImported, resetImportedWorking, exportSave, exportFileName, importSave: parseImport, validateSave, prepareSave,
    get GAME_VERSION() { return gameVersion; }, get storageMode() { return storageMode; }, get activeSlotId() { return activeSlotId; }, get lastLoadedSave() { return clone(lastLoadedSave); },
  };
})(window);
