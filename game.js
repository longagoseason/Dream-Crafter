"use strict";

const TICK_MS = 100;
const INVENTORY_MAX_SLOTS = 1000;
const INVENTORY_RESERVE_SLOTS = 10;
const INVENTORY_SLOT_SIZE = 60;
const INVENTORY_SLOT_GAP = 3;
const INVENTORY_MAX_PAGE_BUTTONS = 10;
const BIG_STORAGE_MAX_SLOTS = 200;
const COLLECTION_PAGE_COUNT = 10;
const SLOT_PATTERN_BASE = "./assets/slot-patterns/";
const DEFAULT_MID_FIG_COLOR = "#A0A0A0";
const DEFAULT_MID_FIG_SIZE = 80;
const { combatStat, luckyRollCount, rollLuckyRange, rollCritical, rollAttackAvoidance, mitigate, calculateAttackDamage, calculateHeal } = BattleService;
const ATTRIBUTE_KEYS = ["STR", "CON", "INT", "WIS", "DEX", "LUK"];
const DERIVED_STAT_KEYS = ["ATK", "MATK", "CRI", "CRI_DMG", "AC", "MR", "AAR", "SAR", "HP", "HPR", "MP", "MPR", "ADAM", "MDAM"];
const EQUIPMENT_SLOTS = [
  { key: "necklace_1", positions: ["necklace"] }, { key: "earrings_1", positions: ["earrings"] },
  { key: "helmet_1", positions: ["helmet"] }, { key: "earrings_2", positions: ["earrings"] },
  { key: "weapon_1", positions: ["physical_weapon", "magic_weapon"] }, { key: "body_1", positions: ["body"] },
  { key: "shield_1", positions: ["shield"] }, { key: "ring_1", positions: ["ring"] },
  { key: "ring_2", positions: ["ring"] }, { key: "kneepads_1", positions: ["kneepads"] },
  { key: "ring_3", positions: ["ring"] }, { key: "ring_4", positions: ["ring"] },
  { key: "idol_1", positions: ["idol"] }, { key: "gloves_1", positions: ["gloves"] },
  { key: "shoe_1", positions: ["shoe"] }, { key: "gloves_2", positions: ["gloves"] }, { key: "core_1", positions: ["core"] },
];

const state = {
  data: null, map: null, previousMapId: null, roster: [], party: [], enemies: [], gold: 0, drops: [], inventory: [], inventoryPage: 0, inventoryPageCapacity: 36, inventoryColumns: 6, inventoryRows: 6, inventoryPageWindowStart: 0,
  equipmentCharacter: "A", equipmentEditSets: {}, infoCharacter: "A", attributeCharacter: "A", skillCharacter: "A", enhanceCharacter: "A", enhanceEquipmentSet: 1, enhanceEquipmentSlot: null,
  enhanceSelectedAttribute: null, enhanceSelectedType: "bless", enhanceStoneKeys: { bless: null, curse: null, chaos: null }, enhanceReturnStoneKey: null, enhanceOperation: null, shopMode: "buy", rightPage: "battle", battleLogChannel: "all", elapsed: 0, spawnElapsed: 0, paused: false, lastTime: 0, savePending: false, savePromise: null, saveTransition: false, currentSlot: null,
  savedMapId: null, townAutoReturn: false, teamName: "隊伍", autoSellItemIds: new Set(), welcomeView: "welcome", patchNoteSeries: null,
  mapMenuOpenGroups: new Set(), warehouseMode: "big", bigStorage: [], bigStoragePage: 0, bigStoragePageCapacity: 30, bigStorageColumns: 5, bigStorageRows: 6,
  collections: [], collectionPage: 0, collectionInventoryPage: 0, collectionInventoryCapacity: 30, collectionStoragePage: 0, collectionStorageCapacity: 30,
  adventureStartedAt: null, claimedRewards: new Set(),
};
const equipmentTooltipModels = new WeakMap();
const enhancementFlashKeyframes = new Set();
const slotPatternStatus = new Map();
const BULK_SHOP_EFFECTS = new Set(["HPrecover", "MPrecover", "Return_Enhance", "Chaos_Enhance", "Bless_Enhance", "Curse_Enhance"]);
const $ = (selector) => document.querySelector(selector);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n) => Math.max(0, Math.round(n * 10) / 10);
const roundStat = (n) => Math.round(n * 10) / 10;
// Keep resource changes precise between frames. Display formatting is handled separately;
// rounding to one decimal here would erase small rates such as 0.1 HPR/MPR.
const roundSigned = (n) => Math.round(n * 1000000) / 1000000;
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const runtimeWarningKeys = new Set();

function aarSarMaximum() {
  const configured = Number(systemSettings()?.AAR_SAR_max);
  if (Number.isFinite(configured)) return clamp(configured, 0, 100);
  const warningKey = "invalid:AAR_SAR_max";
  if (!runtimeWarningKeys.has(warningKey)) {
    runtimeWarningKeys.add(warningKey);
    console.warn("[WARN] Dreamer_Syetem.csv AAR_SAR_max is invalid; fallback to 95%.");
  }
  return 95;
}

function configuredArmorRate() {
  const configured = Number(systemSettings()?.armor_rate);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const warningKey = "invalid:armor_rate";
  if (!runtimeWarningKeys.has(warningKey)) {
    runtimeWarningKeys.add(warningKey);
    console.warn("[WARN] Dreamer_Syetem.csv armor_rate is invalid; fallback to 2.");
  }
  return 2;
}

function rollConfiguredAttackAvoidance(attacker, target, damageType, random = Math.random) {
  return rollAttackAvoidance(attacker, target, damageType, random, aarSarMaximum());
}

async function init() {
  try {
    if (!globalThis.DreamerCsvLoader || !globalThis.DreamerRuntime || !globalThis.DreamerSaveManager) throw new Error("csvLoader.js、runtimePlatform.js 或 saveManager.js 尚未載入");
    const runtimeMode = await DreamerRuntime.initialize();
    await DreamerSaveManager.initialize(runtimeMode);
    const gameData = await DreamerRuntime.loadGameData();
    state.data = gameData;
    validateGameData(state.data);
    DreamerSaveManager.configureGameVersion(getCurrentGameVersion());
    const activeSlot = DreamerSaveManager.activeSlotId;
    const saved = activeSlot ? await DreamerSaveManager.loadSlot(activeSlot) : null;
    document.title = String(systemSettings().Homepage_title || document.title);
    applyCsvColorTheme();
    buildInventoryGrid();
    setupInventoryPages();
    buildParty();
    state.currentSlot = saved ? activeSlot : null;
    const saveLoaded = applyPlayerSave(saved);
    if (!saveLoaded) { initializeStorageState(); grantInitialItems(); }
    setupEquipmentTooltip();
    setupEquipmentPanel();
    setupCharacterInfoPanel();
    setupAttributePanel();
    setupSkillPanel();
    setupRecoveryPanel();
    setupSaveManagerPanel();
    setupWelcomePanel();
    setupRewardPanel();
    setupRightPanel();
    setupShop();
    setupWarehouse();
    setupStatusPanel();
    setupEnhancePanel();
    buildMapSelect();
    const firstBattleMap = state.data.map.find((map) => map.map_id !== "town001" && map.max_monsters > 0);
    if (!firstBattleMap) throw new Error("map.csv 沒有可進入的戰鬥地圖");
    if (saveLoaded) {
      forceSafeTown();
      state.paused = true;
      await persistPlayerSave(false, true);
    } else {
      forceSafeTown();
      state.paused = true;
    }
    updatePauseButton();
    if (saveLoaded) openWelcomePanel();
    $("#pause-button").addEventListener("click", togglePause);
    $("#save-status").textContent = `${saveLoaded ? "進度已載入" : "新存檔"} · ${DreamerSaveManager.storageMode === "indexeddb" ? "瀏覽器存檔" : "本機 JSON"}`;
    setInterval(persistPlayerSave, 5000);
    window.addEventListener("beforeunload", () => persistPlayerSave(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistPlayerSave(true); });
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
    if (!saveLoaded) { await renderSaveManagerPanel(); $("#save-manager-dialog").showModal(); }
  } catch (error) {
    $("#status").textContent = "資料載入失敗";
    addLog(`無法載入遊戲資料：${error.message}。資料來源：${globalThis.DreamerRuntime?.dataSource ?? "尚未判定"}。`);
  }
}

function exportPlayerSave() {
  return {
    version: 1,
    saveVersion: 1,
    gameVersion: globalThis.DreamerSaveManager?.GAME_VERSION ?? getCurrentGameVersion(),
    teamName: state.teamName,
    gold: state.gold,
    inventory: state.inventory.map((entry) => entry.isEquipment
      ? { key: entry.key, itemUuid: entry.itemUuid, itemId: entry.itemId, inventoryIndex: entry.inventoryIndex, locked: Boolean(entry.locked), enhancement: entry.enhancement, quantity: 1, isEquipment: true }
      : { key: entry.key || entry.itemId, itemId: entry.itemId, inventoryIndex: entry.inventoryIndex, quantity: entry.quantity, locked: Boolean(entry.locked), isEquipment: false }),
    autoSellItemIds: [...state.autoSellItemIds],
    bigStorage: state.bigStorage.map((entry) => serializePortableEntry(entry, "storageIndex")),
    collections: state.collections.map((collection) => ({
      collectionId: collection.collectionId,
      name: collection.name,
      equipment: Object.fromEntries(Object.entries(collection.equipment ?? {}).map(([slot, equipped]) => [slot, serializeEquipmentInstance(equipped)])),
    })),
    adventure_started_at: state.adventureStartedAt,
    claimed_rewards: [...state.claimedRewards],
    currentMapId: state.map?.map_id ?? null,
    paused: Boolean(state.paused),
    townAutoReturn: state.map?.map_id === "town001" && state.townAutoReturn,
    previousMapId: state.map?.map_id === "town001" ? state.previousMapId : state.map?.map_id,
    roster: state.roster.map((hero) => ({
      classId: hero.classId, slot: hero.slot, level: hero.level, exp: hero.exp, attributes: hero.attributes,
      customName: hero.customName,
      equipment: hero.equipmentSets["1"], equipmentSets: hero.equipmentSets, activeEquipmentSet: hero.activeEquipmentSet,
      levelPlan: hero.levelPlan, growthStats: hero.growthStats,
      hp: hero.hp, mp: hero.mp, learnedSkillIds: [...hero.learnedSkillIds], skillEnabled: hero.skillEnabled,
      skillSettings: hero.skillSettings,
      recoverySettings: hero.recoverySettings,
      itemCooldowns: hero.itemCooldowns, resetAvailableAt: hero.resetAvailableAt,
    })),
  };
}

function applyPlayerSave(saved) {
  if (!saved || Number(saved.saveVersion ?? saved.version) !== 1 || !Array.isArray(saved.roster)) return false;
  const savedByClass = new Map(saved.roster.map((hero) => [hero.classId, hero]));
  const knownClassIds = new Set(state.roster.map((hero) => hero.classId));
  const partySlots = saved.roster.filter((hero) => knownClassIds.has(hero.classId)).map((hero) => hero.slot).filter(Boolean);
  if (partySlots.length !== 3 || new Set(partySlots).size !== 3 || !partySlots.every((slot) => ["A", "B", "C"].includes(slot))) return false;

  for (const hero of state.roster) {
    const source = savedByClass.get(hero.classId);
    if (!source) continue;
    hero.customName = normalizeCharacterName(source.customName);
    hero.name = hero.customName || hero.className;
    hero.slot = source.slot ?? null;
    hero.id = hero.slot ?? hero.classId;
    hero.level = clamp(Math.trunc(Number(source.level) || 1), 1, 100);
    hero.exp = Math.max(0, Number(source.exp) || 0);
    hero.attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, Math.max(0, Number(source.attributes?.[key]) || 0)]));
    initializeEquipmentSets(hero, source.equipmentSets ?? { "1": source.equipment ?? {}, "2": {} }, source.activeEquipmentSet);
    hero.levelPlan = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, clamp(Math.trunc(Number(source.levelPlan?.[key]) || 0), 0, 5)]));
    hero.growthStats = Object.fromEntries(DERIVED_STAT_KEYS.map((key) => [key, Math.max(0, Number(source.growthStats?.[key] ?? (key === "HP" ? source.hpGrowth : key === "MP" ? source.mpGrowth : 0)) || 0)]));
    hero.learnedSkillIds = new Set((source.learnedSkillIds ?? []).filter((skillId) => state.data.characterSkills.some((skill) => skill.skill_id === skillId && skill.class_id === hero.classId)));
    hero.skillEnabled = { ...(source.skillEnabled ?? {}) };
    hero.skillSettings = Object.fromEntries(Object.entries(source.skillSettings ?? {}).filter(([skillId]) => state.data.characterSkills.some((skill) => skill.skill_id === skillId && skill.class_id === hero.classId)));
    grantBuiltInSkills(hero);
    const legacyAutoRecovery = source.autoRecoveryEnabled !== false;
    hero.recoverySettings = {
      hpEnabled: source.recoverySettings?.hpEnabled ?? legacyAutoRecovery,
      hpPercent: clamp(Number(source.recoverySettings?.hpPercent ?? 20), 1, 100),
      hpItemId: source.recoverySettings?.hpItemId ?? null,
      mpEnabled: source.recoverySettings?.mpEnabled ?? legacyAutoRecovery,
      mpPercent: clamp(Number(source.recoverySettings?.mpPercent ?? 20), 1, 100),
      mpItemId: source.recoverySettings?.mpItemId ?? null,
    };
    hero.itemCooldowns = Object.fromEntries(Object.entries(source.itemCooldowns ?? {}).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
    hero.resetAvailableAt = Math.max(0, Number(source.resetAvailableAt) || 0);
    recalculateHeroStats(hero, true);
    hero.hp = clamp(Number(source.hp) || 0, 0, hero.maxHp);
    hero.mp = clamp(Number(source.mp) || 0, 0, hero.maxMp);
  }
  state.party = ["A", "B", "C"].map((slot) => state.roster.find((hero) => hero.slot === slot));
  state.gold = Math.max(0, Math.trunc(Number(saved.gold) || 0));
  state.teamName = normalizeTeamName(saved.teamName);
  state.inventory = (saved.inventory ?? [])
    .map((entry) => ({ entry, item: catalogItem(entry.itemId) }))
    .filter(({ item }) => Boolean(item))
    .map(({ entry, item }) => state.data.equipment.some((candidate) => candidate.item_id === entry.itemId)
      ? { ...normalizeEquipmentInstance(entry), inventoryIndex: Number(entry.inventoryIndex), name: item.item_name, quantity: 1, isEquipment: true }
      : { key: entry.key || entry.itemId, itemId: entry.itemId, inventoryIndex: Number(entry.inventoryIndex), name: item.item_name, quantity: Math.max(1, Math.trunc(Number(entry.quantity) || 1)), locked: Boolean(entry.locked), isEquipment: false });
  normalizeInventoryIndices();
  state.bigStorage = normalizePortableEntries(saved.bigStorage ?? saved.warehouse ?? [], BIG_STORAGE_MAX_SLOTS, "storageIndex");
  state.collections = normalizeCollections(saved.collections ?? saved.collectionStorage ?? []);
  const legacyAdventureTime = saved.adventure_started_at ?? saved.savedAt;
  state.adventureStartedAt = validAdventureTimestamp(legacyAdventureTime) ? new Date(legacyAdventureTime).toISOString() : new Date().toISOString();
  state.claimedRewards = new Set((Array.isArray(saved.claimed_rewards) ? saved.claimed_rewards : []).map((value) => String(value)).filter(Boolean));
  state.autoSellItemIds = new Set((saved.autoSellItemIds ?? []).filter((itemId) => catalogItem(itemId)));
  ensureUniqueEquipmentUuids();
  state.savedMapId = saved.currentMapId ?? null;
  state.townAutoReturn = Boolean(saved.townAutoReturn);
  state.previousMapId = saved.previousMapId ?? null;
  updateCharacterControls();
  return true;
}

async function persistPlayerSave(keepalive = false, force = false) {
  if (!state.data || !state.currentSlot || !globalThis.DreamerSaveManager || (state.saveTransition && !force)) return null;
  if (state.savePromise) return state.savePromise;
  state.savePending = true;
  state.savePromise = (async () => {
    try {
    const saved = await DreamerSaveManager.saveSlot(state.currentSlot, exportPlayerSave(), { keepalive });
    if ($("#save-status")) $("#save-status").textContent = "進度已儲存";
    return saved;
  } catch (error) {
    if ($("#save-status")) $("#save-status").textContent = `存檔失敗：${error.message}`;
    throw error;
  } finally { state.savePending = false; state.savePromise = null; }
  })();
  return state.savePromise;
}

const transitionDelay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function updatePauseButton() { if ($("#pause-button")) $("#pause-button").textContent = state.paused ? "繼續" : "暫停"; }

function forceSafeTown() {
  state.enemies = [];
  state.spawnElapsed = 0;
  for (const hero of state.roster) { hero.buffs = []; hero.casting = null; hero.skillCooldowns = {}; }
  state.map = null;
  enterTown(false);
  state.townAutoReturn = false;
}

function resetRuntimeFromSave(saved) {
  state.enemies = []; state.inventory = []; state.bigStorage = []; state.collections = []; state.gold = 0; state.drops = []; state.autoSellItemIds = new Set();
  state.elapsed = 0; state.spawnElapsed = 0; state.savedMapId = null; state.previousMapId = null; state.townAutoReturn = false;
  state.adventureStartedAt = null; state.claimedRewards = new Set();
  buildParty();
  const loaded = applyPlayerSave(saved);
  if (!loaded) { initializeStorageState(); grantInitialItems(); }
  forceSafeTown();
  state.paused = true;
  updatePauseButton();
  updateCharacterControls();
  updateMapLocks();
  render();
  return loaded;
}

async function runSaveTransition(operation) {
  if (state.saveTransition) throw new Error("已有存檔轉換正在進行");
  state.saveTransition = true;
  state.paused = true;
  updatePauseButton();
  const overlay = $("#save-transition-overlay");
  overlay.hidden = false;
  try {
    await transitionDelay(1000);
    const result = await operation();
    await transitionDelay(1000);
    return result;
  } finally {
    state.lastTime = performance.now();
    state.saveTransition = false;
    overlay.hidden = true;
    updatePauseButton();
  }
}

function validateGameData(data) {
  const requiredTables = [
    "classes", "equipment", "item", "characterAttribute", "attributeIndex", "characterSkills", "monsters", "monsterSkills", "skill",
    "map", "mapSpawn", "lootDrops", "specialLoot", "playerLevel", "dreamerSystem", "gameColorIndex", "enhanceLevel", "enhanceSaveEnchant", "enhanceOverEnchant", "enhanceChaosEnchant", "welcomeNews", "patchNotes", "rewards",
  ];
  const missing = requiredTables.filter((key) => !Array.isArray(data?.[key]));
  if (missing.length) throw new Error(`資料版本不相容，缺少資料表：${missing.join("、")}`);
}

function csvColor(value, fallback = "#ededed") {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value ?? "")) ? String(value) : fallback;
}

const LEGACY_COLOR_LOCATIONS = {
  player_name: "right_player_name", monster_normal: "right_monster_normal", monster_boss: "right_monster_boss",
  critical_hit: "right_critical_hit", dodge: "right_dodge", Mirror_color: "left_Mirror_color",
};

function indexedColor(location, fallback = "#ededed") {
  const row = state.data?.gameColorIndex?.find((entry) => entry.color_location === location);
  return csvColor(row?.color_name, fallback);
}

function gameColor(field, fallback = "#ededed") {
  return indexedColor(LEGACY_COLOR_LOCATIONS[field] ?? field, fallback);
}

function applyCsvColorTheme() {
  const rootStyle = document.documentElement?.style;
  if (!rootStyle?.setProperty) return;
  for (const row of state.data?.gameColorIndex ?? []) {
    const variable = `--color-${String(row.color_location).replaceAll("_", "-").toLowerCase()}`;
    rootStyle.setProperty(variable, csvColor(row.color_name));
  }
  const enhanceAccent = [...(state.data?.enhanceLevel ?? [])].sort((a, b) => a.enhance_level - b.enhance_level)[0]?.enhance_color;
  rootStyle.setProperty("--enhance-ui-accent", csvColor(enhanceAccent, "#ededed"));
  rootStyle.setProperty("--slot-mid-size", `${midFigureSizePercent()}%`);
}

function playerSkillLogColor(skill) {
  return csvColor(skill?.skill_color, "#ededed");
}

function systemSettings() {
  return state.data.dreamerSystem[0];
}

function validAdventureTimestamp(value) {
  return Boolean(value) && Number.isFinite(new Date(value).getTime());
}

function localDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function validRewardDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatRewardDate(value) {
  const text = String(value ?? "");
  return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

function rewardEligibility(row) {
  const adventureDate = localDateKey(state.adventureStartedAt);
  return Boolean(adventureDate && validRewardDate(row?.date) && adventureDate >= String(row.date));
}

function rewardValidation(row, logError = false) {
  const type = String(row?.type ?? "").trim();
  const rewardId = String(row?.reward_id ?? "").trim();
  const value = Number(row?.value);
  let error = "";
  let name = "";
  if (!rewardId) error = "缺少 reward_id";
  else if (!validRewardDate(row?.date)) error = `日期格式錯誤：${row?.date ?? "空白"}`;
  else if (type === "murmur") {
    if (!String(row.intro ?? "").trim()) error = "murmur 缺少 intro";
  } else if (!Number.isInteger(value) || value <= 0) error = "value 必須是大於 0 的整數";
  else if (type === "equipment") {
    const item = state.data.equipment.find((candidate) => candidate.item_id === row.id);
    if (!item) error = `equipment.csv 找不到 id=${row.id || "空白"}`;
    else name = item.item_name;
  } else if (type === "item") {
    const item = state.data.item.find((candidate) => candidate.item_id === row.id);
    if (!item) error = `item.csv 找不到 id=${row.id || "空白"}`;
    else name = item.item_name;
  } else if (type === "gold") name = "金幣";
  else error = `不支援的 type=${type || "空白"}`;
  if (error && logError) {
    const warningKey = `reward:${rewardId || "empty"}:${error}`;
    if (!runtimeWarningKeys.has(warningKey)) {
      runtimeWarningKeys.add(warningKey);
      console.error(`Reward error: reward_id=${rewardId || "(empty)"}, type=${type || "(empty)"}, id=${row?.id || "(empty)"}: ${error}`);
    }
  }
  return { valid: !error, error, type, rewardId, value, name };
}

function hasUnclaimedReward() {
  return (state.data?.rewards ?? []).some((row) => {
    const result = rewardValidation(row);
    return result.type !== "murmur" && result.valid && rewardEligibility(row) && !state.claimedRewards.has(result.rewardId);
  });
}

function renderRewardButton() {
  const button = $("#reward-button");
  if (!button) return;
  const highlighted = hasUnclaimedReward();
  button.classList.toggle("has-unclaimed", highlighted);
  if (highlighted) button.style.backgroundColor = indexedColor("Reward_not_get", "#FF0000");
  else button.style.removeProperty("background-color");
}

function rewardDisplayName(row, validation = rewardValidation(row)) {
  const quantity = Number(row.value).toLocaleString("en-US");
  return validation.type === "gold" ? `金幣 x ${quantity}` : `${validation.name || row.id || "資料錯誤"} x ${quantity}`;
}

function renderRewardPanel() {
  const adventure = $("#reward-adventure-time");
  const container = $("#reward-groups");
  if (!adventure || !container) return;
  adventure.textContent = state.adventureStartedAt
    ? `開始冒險於 ${new Date(state.adventureStartedAt).toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "尚未建立冒險時間";
  container.replaceChildren();
  const eligibleRows = (state.data.rewards ?? []).map((row, sourceIndex) => ({ row, sourceIndex })).filter(({ row }) => rewardEligibility(row));
  const dates = [...new Set(eligibleRows.map(({ row }) => String(row.date)))].sort((a, b) => b.localeCompare(a));
  for (const [dateIndex, date] of dates.entries()) {
    const rows = eligibleRows.filter(({ row }) => String(row.date) === date).sort((a, b) => a.sourceIndex - b.sourceIndex);
    const murmurs = rows.filter(({ row }) => String(row.type).trim() === "murmur").map(({ row }) => String(row.intro ?? "").trim()).filter(Boolean);
    const details = document.createElement("details"); details.className = "reward-group"; details.open = dateIndex === 0;
    const summary = document.createElement("summary"); summary.textContent = `${formatRewardDate(date)}${murmurs.length ? `  ${murmurs.join("／")}` : ""}`;
    const body = document.createElement("div"); body.className = "reward-group-body";
    for (const murmur of murmurs) { const p = document.createElement("p"); p.className = "reward-murmur"; p.textContent = murmur; body.append(p); }
    for (const { row } of rows.filter(({ row }) => String(row.type).trim() !== "murmur")) {
      const validation = rewardValidation(row, true);
      const line = document.createElement("div"); line.className = "reward-row";
      const label = document.createElement("span"); label.textContent = validation.valid ? rewardDisplayName(row, validation) : `資料錯誤：${row.reward_id}`;
      const button = document.createElement("button"); button.type = "button"; button.dataset.rewardId = String(row.reward_id ?? "");
      const claimed = state.claimedRewards.has(validation.rewardId);
      button.textContent = claimed ? "已領取" : validation.valid ? "領取" : "無法領取";
      button.disabled = claimed || !validation.valid;
      if (!validation.valid) button.title = validation.error;
      line.append(label, button); body.append(line);
    }
    details.append(summary, body); container.append(details);
  }
  if (!dates.length) { const empty = document.createElement("p"); empty.className = "reward-murmur"; empty.textContent = "目前沒有符合開始冒險日期的獎勵。"; container.append(empty); }
}

function rewardHasInventoryCapacity(validation) {
  const freeSlots = Math.max(0, INVENTORY_MAX_SLOTS - state.inventory.length);
  if (validation.type === "equipment") return freeSlots >= validation.value;
  if (validation.type === "item") return state.inventory.some((entry) => !entry.isEquipment && entry.itemId === validation.rowId) || freeSlots >= 1;
  return true;
}

async function claimReward(rewardId) {
  const row = state.data.rewards.find((candidate) => String(candidate.reward_id) === String(rewardId));
  const validation = rewardValidation(row, true);
  if (!row || !validation.valid || validation.type === "murmur" || !rewardEligibility(row) || state.claimedRewards.has(validation.rewardId)) throw new Error(validation.error || "此獎勵目前不可領取");
  validation.rowId = row.id;
  if (!rewardHasInventoryCapacity(validation)) throw new Error("背包空間不足，獎勵未發放。");
  const inventoryBefore = JSON.parse(JSON.stringify(state.inventory));
  const goldBefore = state.gold;
  const claimedBefore = new Set(state.claimedRewards);
  try {
    if (validation.type === "equipment" || validation.type === "item") {
      const result = addInventoryItem(row.id, validation.name, validation.value);
      if (result.full || result.quantity !== validation.value) throw new Error("背包無法完整容納獎勵");
    } else if (validation.type === "gold") state.gold += validation.value;
    state.claimedRewards.add(validation.rewardId);
    if (state.savePromise) await state.savePromise;
    await persistPlayerSave(false, true);
  } catch (error) {
    state.inventory = inventoryBefore;
    state.gold = goldBefore;
    state.claimedRewards = claimedBefore;
    throw error;
  }
  render();
  renderRewardPanel();
}

function setupRewardPanel() {
  const dialog = $("#reward-dialog");
  $("#reward-button").addEventListener("click", () => { renderRewardPanel(); $("#reward-message").textContent = ""; dialog.showModal(); });
  $("#reward-close").addEventListener("click", () => dialog.close());
  $("#reward-groups").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-reward-id]");
    if (!button) return;
    const message = $("#reward-message");
    button.disabled = true;
    try { await claimReward(button.dataset.rewardId); message.textContent = "獎勵已完整領取並儲存。"; message.classList.remove("error"); }
    catch (error) { message.textContent = error.message; message.classList.add("error"); renderRewardPanel(); }
  });
  renderRewardButton();
}

function midFigureSizePercent() {
  const raw = systemSettings()?.mid_fig_size;
  const text = String(raw ?? "").trim();
  const numeric = text === "" ? Number.NaN : Number(text);
  return clamp(Number.isFinite(numeric) ? numeric : DEFAULT_MID_FIG_SIZE, 0, 200);
}

function versionParts(version) {
  const match = String(version ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareGameVersions(left, right) {
  const a = versionParts(left) ?? [-1, -1, -1];
  const b = versionParts(right) ?? [-1, -1, -1];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function getCurrentGameVersion() {
  const versions = [...new Set((state.data?.patchNotes ?? []).map((row) => row.version).filter((version) => versionParts(version)))];
  if (!versions.length) throw new Error("PatchNote.csv 沒有有效的 version");
  return versions.sort(compareGameVersions).at(-1);
}

function multipliedGoldReward(baseGold) {
  const settings = systemSettings();
  const multiplier = Number(settings.gold_multiplier ?? settings.money_multiplier ?? 1);
  return Math.max(0, Math.round(Number(baseGold) * multiplier));
}

function multipliedExperienceReward(penalizedExperience) {
  return Math.max(0, Math.round(Number(penalizedExperience) * systemSettings().exp_multiplier));
}

function calculatedItemDropRate(baseDropRate, totalLuck, levelDifference) {
  const multipliedBaseRate = Math.min(100, Number(baseDropRate) * systemSettings().item_drop_rate);
  const luckyRate = Math.min(100, multipliedBaseRate * (1 + Math.max(0, totalLuck) / 100));
  return Math.min(100, Math.max(multipliedBaseRate * .2, luckyRate * (1 - (Math.max(levelDifference, 3) - 3) * .1)));
}

function setupEquipmentPanel() {
  for (const button of document.querySelectorAll(".character-tabs button")) {
    button.addEventListener("click", () => showEquipment(button.dataset.character));
  }
  for (const cell of document.querySelectorAll("#equipment-grid [data-slot]")) {
    cell.addEventListener("click", () => unequipItem(state.equipmentCharacter, cell.dataset.slot));
  }
  for (const button of document.querySelectorAll("[data-equipment-set]")) {
    button.addEventListener("click", () => {
      const hero = state.party.find((member) => member.slot === state.equipmentCharacter);
      if (!hero) return;
      state.equipmentEditSets[hero.classId] = equipmentSetNumber(button.dataset.equipmentSet);
      showEquipment(hero.slot);
    });
  }
  for (const input of document.querySelectorAll("[data-active-equipment-set]")) {
    input.addEventListener("change", () => {
      const hero = state.party.find((member) => member.slot === state.equipmentCharacter);
      if (hero) switchActiveEquipmentSet(hero, input.dataset.activeEquipmentSet);
    });
  }
  showEquipment("A");
}

function switchActiveEquipmentSet(hero, setNumber) {
  const nextSet = equipmentSetNumber(setNumber);
  hero.activeEquipmentSet = nextSet;
  recalculateHeroStats(hero);
  showEquipment(hero.slot);
  render();
  if ($("#character-info-dialog")?.open) renderCharacterInfoPanel();
  if ($("#attribute-dialog")?.open) renderAttributePanel();
  if ($("#enhance-dialog")?.open) renderEnhancePanel();
  persistPlayerSave();
  return nextSet;
}

function showEquipment(slot) {
  const hero = state.party.find((member) => member.slot === slot);
  if (!hero) return;
  state.equipmentCharacter = slot;
  document.querySelectorAll(".character-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.character === slot));
  const editSet = editedEquipmentSet(hero);
  const resolvedEquipment = resolvedEquipmentForSet(hero, editSet);
  for (const row of document.querySelectorAll("[data-set-row]")) {
    const setNumber = equipmentSetNumber(row.dataset.setRow);
    row.querySelector(".equipment-set-class").textContent = hero.className;
    row.querySelector("[data-equipment-set]").classList.toggle("editing", setNumber === editSet);
    row.querySelector("[data-active-equipment-set]").checked = setNumber === hero.activeEquipmentSet;
  }
  for (const cell of $("#equipment-grid").children) {
    if (!cell.dataset.slot) continue;
    const source = resolvedEquipment[cell.dataset.slot];
    const equipped = source?.instance;
    const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
    const positions = cell.dataset.position.split(",");
    cell.classList.toggle("equipped", Boolean(item));
    cell.classList.toggle("mirror-equipment", Boolean(item && source.isMirror));
    cell.style.setProperty("--mirror-color", indexedColor("left_Mirror_color"));
    cell.textContent = item ? equipmentButtonText(item, equipped) : equipmentSlotLabel(positions[0]);
    applyEnhancementVisual(cell, equipped, item);
    assignEquipmentTooltip(cell, item, source?.isMirror ? `鏡像自 Set ${source.sourceSet}` : "點擊卸下", equipped);
    if (!item) cell.title = "尚未裝備";
    cell.setAttribute("aria-label", item
      ? source.isMirror ? `Set ${editSet} 鏡像 ${equipmentDisplayName(item, equipped)}` : `卸下 Set ${editSet} 的 ${equipmentDisplayName(item, equipped)}`
      : `Set ${editSet} 空的${equipmentSlotLabel(positions[0])}欄位`);
  }
}

function emptyEnhancement() {
  return { level: 0, blessCount: 0, curseCount: 0, chaosCount: 0, returnCount: 0, safeBonus: {}, blessBonus: {}, curseBonus: {}, chaosBonus: {}, history: [] };
}

function normalizeEnhancement(source = {}) {
  source = source || {};
  const enhancement = source.enhancement ?? source;
  const cleanBonus = (value) => Object.fromEntries(Object.entries(value ?? {}).filter(([key, amount]) => [...DERIVED_STAT_KEYS, ...ATTRIBUTE_KEYS].includes(key) && Number.isFinite(Number(amount))).map(([key, amount]) => [key, Number(amount)]));
  return {
    level: Math.max(0, Math.trunc(Number(enhancement.level ?? enhancement.enhance_level) || 0)),
    blessCount: Math.max(0, Math.trunc(Number(enhancement.blessCount ?? enhancement.bless_count) || 0)),
    curseCount: Math.max(0, Math.trunc(Number(enhancement.curseCount ?? enhancement.curse_count) || 0)),
    chaosCount: Math.max(0, Math.trunc(Number(enhancement.chaosCount ?? enhancement.chaos_count) || 0)),
    returnCount: Math.max(0, Math.trunc(Number(enhancement.returnCount ?? enhancement.return_count) || 0)),
    safeBonus: cleanBonus(enhancement.safeBonus ?? enhancement.safe_bonus),
    blessBonus: cleanBonus(enhancement.blessBonus ?? enhancement.bless_bonus),
    curseBonus: cleanBonus(enhancement.curseBonus ?? enhancement.curse_bonus),
    chaosBonus: cleanBonus(enhancement.chaosBonus ?? enhancement.chaos_bonus),
    history: Array.isArray(enhancement.history ?? enhancement.enhance_history)
      ? (enhancement.history ?? enhancement.enhance_history).map((entry) => ({ ...entry, results: entry.results ? { ...entry.results } : undefined }))
      : [],
  };
}

function normalizeEquipmentInstance(source = {}) {
  const itemUuid = source.itemUuid || source.item_uuid || source.key || crypto.randomUUID();
  return { key: itemUuid, itemUuid, itemId: source.itemId ?? source.item_id, locked: Boolean(source.locked), enhancement: normalizeEnhancement(source) };
}

function serializeEquipmentInstance(instance) {
  const normalized = normalizeEquipmentInstance(instance);
  return { key: normalized.key, itemUuid: normalized.itemUuid, itemId: normalized.itemId, locked: Boolean(normalized.locked), enhancement: normalized.enhancement, quantity: 1, isEquipment: true };
}

function serializePortableEntry(entry, indexKey = "inventoryIndex") {
  return entry.isEquipment
    ? { ...serializeEquipmentInstance(entry), [indexKey]: entry[indexKey] }
    : { key: entry.key || entry.itemId, itemId: entry.itemId, [indexKey]: entry[indexKey], quantity: Math.max(1, Math.trunc(Number(entry.quantity) || 1)), locked: Boolean(entry.locked), isEquipment: false };
}

function normalizePortableEntries(entries, maximum, indexKey) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ entry, item: catalogItem(entry?.itemId ?? entry?.item_id) }))
    .filter(({ item }) => Boolean(item))
    .slice(0, maximum)
    .map(({ entry, item }, order) => state.data.equipment.some((candidate) => candidate.item_id === (entry.itemId ?? entry.item_id))
      ? { ...normalizeEquipmentInstance(entry), [indexKey]: order, name: item.item_name, quantity: 1, isEquipment: true }
      : { key: entry.key || entry.itemId || entry.item_id, itemId: entry.itemId ?? entry.item_id, [indexKey]: order, name: item.item_name, quantity: Math.max(1, Math.trunc(Number(entry.quantity) || 1)), locked: Boolean(entry.locked), isEquipment: false });
}

function normalizeCollectionName(value, collectionId) {
  const text = [...String(value ?? "").trim()].slice(0, 20).join("");
  return text || `收藏庫 ${collectionId}`;
}

function normalizeCollections(source = []) {
  const rows = Array.isArray(source) ? source : [];
  return Array.from({ length: COLLECTION_PAGE_COUNT }, (_, index) => {
    const collectionId = index + 1;
    const saved = rows.find((row) => Number(row?.collectionId) === collectionId) ?? rows[index] ?? {};
    return { collectionId, name: normalizeCollectionName(saved.name, collectionId), equipment: normalizeEquipmentMap(saved.equipment ?? {}) };
  });
}

function initializeStorageState() {
  state.bigStorage = [];
  state.collections = normalizeCollections([]);
  state.bigStoragePage = state.collectionInventoryPage = state.collectionStoragePage = 0;
}

function equipmentSetNumber(value) {
  return Number(value) === 2 ? 2 : 1;
}

function normalizeEquipmentMap(source = {}) {
  const migrated = { ...(source ?? {}) };
  for (const [legacyKey, currentKey] of [["bracers", "gloves_1"], ["bracers_1", "gloves_1"], ["bracers_2", "gloves_2"]]) {
    if (migrated[legacyKey] && !migrated[currentKey]) migrated[currentKey] = migrated[legacyKey];
    delete migrated[legacyKey];
  }
  return Object.fromEntries(Object.entries(migrated)
    .filter(([slot, equipped]) => EQUIPMENT_SLOTS.some((candidate) => candidate.key === slot)
      && state.data.equipment.some((item) => item.item_id === (equipped?.itemId ?? equipped?.item_id)))
    .map(([slot, equipped]) => [slot, normalizeEquipmentInstance(equipped)]));
}

function initializeEquipmentSets(hero, source = {}, activeSet = 1) {
  hero.equipmentSets = {
    "1": normalizeEquipmentMap(source["1"] ?? source.set1 ?? {}),
    "2": normalizeEquipmentMap(source["2"] ?? source.set2 ?? {}),
  };
  hero.activeEquipmentSet = equipmentSetNumber(activeSet);
  const descriptor = Object.getOwnPropertyDescriptor(hero, "equipment");
  if (!descriptor?.get) {
    Object.defineProperty(hero, "equipment", {
      configurable: true,
      enumerable: false,
      get() { return this.equipmentSets[String(this.activeEquipmentSet)] ?? {}; },
      set(value) { this.equipmentSets[String(this.activeEquipmentSet)] = value ?? {}; },
    });
  }
}

function equipmentConfig(hero, setNumber = hero?.activeEquipmentSet) {
  return hero?.equipmentSets?.[String(equipmentSetNumber(setNumber))] ?? {};
}

function editedEquipmentSet(hero) {
  return equipmentSetNumber(state.equipmentEditSets[hero.classId] ?? hero.activeEquipmentSet);
}

function resolvedEquipmentForSet(hero, setNumber = hero?.activeEquipmentSet) {
  const selectedSet = equipmentSetNumber(setNumber);
  const otherSet = selectedSet === 1 ? 2 : 1;
  const selected = equipmentConfig(hero, selectedSet);
  const other = equipmentConfig(hero, otherSet);
  const resolved = {};
  for (const { key } of EQUIPMENT_SLOTS) {
    if (selected[key]) resolved[key] = { instance: selected[key], sourceSet: selectedSet, isMirror: false };
    else if (other[key]) resolved[key] = { instance: other[key], sourceSet: otherSet, isMirror: true };
  }
  const weapon = resolved.weapon_1?.instance
    ? state.data.equipment.find((item) => item.item_id === resolved.weapon_1.instance.itemId)
    : null;
  if (weapon?.weapon_type === "two_hand_weapon" && resolved.shield_1) {
    if (selected.shield_1 && !selected.weapon_1) delete resolved.weapon_1;
    else delete resolved.shield_1;
  }
  return resolved;
}

function equipmentSlotSource(hero, slot, setNumber = hero?.activeEquipmentSet) {
  return resolvedEquipmentForSet(hero, setNumber)[slot] ?? null;
}

function ensureUniqueEquipmentUuids() {
  const used = new Set();
  const equipmentInstances = [
    ...state.roster.flatMap((hero) => Object.values(hero.equipmentSets ?? {}).flatMap((equipmentSet) => Object.values(equipmentSet ?? {}))),
    ...state.inventory.filter((entry) => entry.isEquipment),
    ...state.bigStorage.filter((entry) => entry.isEquipment),
    ...state.collections.flatMap((collection) => Object.values(collection.equipment ?? {})),
  ];
  for (const instance of equipmentInstances) {
    let itemUuid = instance.itemUuid || instance.key || crypto.randomUUID();
    if (used.has(itemUuid)) itemUuid = crypto.randomUUID();
    instance.itemUuid = itemUuid;
    instance.key = itemUuid;
    instance.enhancement = normalizeEnhancement(instance);
    used.add(itemUuid);
  }
}

function enhancementBonus(instance) {
  const enhancement = normalizeEnhancement(instance);
  return [...Object.entries(enhancement.safeBonus), ...Object.entries(enhancement.blessBonus), ...Object.entries(enhancement.curseBonus), ...Object.entries(enhancement.chaosBonus)]
    .reduce((result, [key, value]) => ({ ...result, [key]: (result[key] ?? 0) + Number(value) }), {});
}

function equipmentDisplayName(item, instance) {
  const level = normalizeEnhancement(instance).level;
  return `${level > 0 ? `+${level} ` : ""}${item.item_name}`;
}

function enhancementLevelSetting(instance) {
  return state.data?.enhanceLevel?.find((row) => row.enhance_level === normalizeEnhancement(instance).level);
}

function equipmentButtonText(item, instance) {
  const lines = [];
  const enhanceLevel = normalizeEnhancement(instance).level;
  if (enhanceLevel > 0) lines.push(`+${enhanceLevel}`);
  const name = String(item?.item_name ?? instance?.name ?? instance?.itemId ?? "").trim();
  lines.push(...slotNameLines(name));
  return lines.join("\n");
}

function slotNameLines(name) {
  return String(name ?? "").trim().split(/\s+/).filter(Boolean);
}

function darkenHexColor(color, factor = .52) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(color ?? ""));
  if (!match) return "#252525";
  return `#${match.slice(1).map((part) => Math.round(parseInt(part, 16) * factor).toString(16).padStart(2, "0")).join("")}`;
}

function enhancementStarPositions(count) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  if (total === 16) {
    const positions = [];
    for (let column = 1; column <= 5; column++) positions.push({ gridColumn: column, gridRow: 1 }, { gridColumn: column, gridRow: 5 });
    for (let row = 2; row <= 4; row++) positions.push({ gridColumn: 1, gridRow: row }, { gridColumn: 5, gridRow: row });
    return positions;
  }
  if (total <= 10) {
    const bottomCount = Math.min(5, total);
    const topCount = Math.max(0, total - bottomCount);
    const line = (amount, top) => Array.from({ length: amount }, (_, index) => ({
      left: `${((index + 1) / (amount + 1)) * 100}%`,
      top: top ? "8%" : "92%",
    }));
    return [...line(bottomCount, false), ...line(topCount, true)];
  }
  const perimeter = 4;
  return Array.from({ length: total }, (_, index) => {
    const progress = index / total * perimeter;
    if (progress < 1) return { left: `${progress * 100}%`, top: "4%" };
    if (progress < 2) return { left: "96%", top: `${(progress - 1) * 100}%` };
    if (progress < 3) return { left: `${(3 - progress) * 100}%`, top: "96%" };
    return { left: "4%", top: `${(4 - progress) * 100}%` };
  });
}

function validSlotPatternName(value) {
  const name = String(value ?? "").trim();
  return /^[^\\/:*?"<>|]+\.png$/i.test(name) ? name : "";
}

function optionalCssColor(value, fallback = "") {
  const color = String(value ?? "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function monitorSlotPattern(path) {
  if (!path || slotPatternStatus.has(path) || typeof Image === "undefined") return;
  slotPatternStatus.set(path, "loading");
  const image = new Image();
  image.onload = () => slotPatternStatus.set(path, "loaded");
  image.onerror = () => {
    slotPatternStatus.set(path, "missing");
    console.warn(`[Dream-Crafter] mid_figure 圖檔載入失敗：${path}`);
    document.querySelectorAll?.(".slot-mid-figure").forEach((layer) => {
      if (layer.dataset.patternPath === path) layer.remove();
    });
  };
  image.src = path;
}

function createMidFigureLayer(sourceItem, setting, flashDelay) {
  const requestedName = String(sourceItem?.mid_figure ?? "").trim();
  const fileName = validSlotPatternName(requestedName);
  if (requestedName && !fileName && !slotPatternStatus.has(`invalid:${requestedName}`)) {
    slotPatternStatus.set(`invalid:${requestedName}`, "missing");
    console.warn(`[Dream-Crafter] mid_figure 檔名不合法，已略過：${requestedName}`);
  }
  if (!fileName || typeof document?.createElement !== "function") return null;
  const path = `${SLOT_PATTERN_BASE}${encodeURIComponent(fileName)}`;
  if (slotPatternStatus.get(path) === "missing") return null;
  monitorSlotPattern(path);
  const layer = document.createElement("span");
  layer.className = "slot-mid-figure";
  layer.dataset.patternPath = path;
  layer.setAttribute("aria-hidden", "true");
  layer.style.setProperty("--slot-mid-mask", `url("${path}")`);
  layer.style.setProperty("--slot-mid-color", optionalCssColor(sourceItem?.mid_fig_color, DEFAULT_MID_FIG_COLOR));
  const flashMidColor = optionalCssColor(setting?.flash_mid_shading);
  if (setting && flashDelay > 0 && flashMidColor) {
    layer.style.setProperty("--enhance-flash-mid-color", flashMidColor);
    layer.style.animationName = ensureEnhancementMidFlashKeyframes(flashDelay);
    layer.style.animationDuration = `${flashDelay + 15}s`;
    layer.style.animationTimingFunction = "linear";
    layer.style.animationIterationCount = "infinite";
  }
  return layer;
}

function applyEnhancementVisual(element, instance, sourceItem = null) {
  const setting = enhancementLevelSetting(instance);
  const levelColor = setting ? csvColor(setting.enhance_color, "#ffffff") : "#ffffff";
  const starColor = setting ? csvColor(setting.star_color, levelColor) : "#ffffff";
  const flashShading = setting ? csvColor(setting.flash_shading, levelColor) : "#ffffff";
  const flashName = setting ? csvColor(setting.flash_name, levelColor) : "#ffffff";
  element.style.color = setting ? levelColor : "";
  element.style.whiteSpace = "pre-line";
  element.classList?.toggle("slot-visual", Boolean(sourceItem));
  element.classList?.toggle("enhancement-visual", Boolean(setting));
  const flashDelay = Math.max(0, Number(setting?.is_flashing) || 0);
  element.classList?.toggle("enhancement-flash", Boolean(setting && flashDelay > 0));
  const starCount = Math.max(0, Math.trunc(Number(setting?.star_count) || 0));
  element.classList?.toggle("has-enhancement-stars", starCount > 0);
  if (element.style.setProperty) {
    element.style.setProperty("--enhance-color", levelColor);
    element.style.setProperty("--enhance-star-color", starColor);
    if (setting && flashDelay > 0) {
      const animationName = ensureEnhancementFlashKeyframes(flashDelay);
      element.style.setProperty("--enhance-flash-name", animationName);
      element.style.setProperty("--enhance-flash-duration", `${flashDelay + 15}s`);
      element.style.setProperty("--enhance-flash-base-bg", element.classList?.contains?.("mirror-equipment") ? "var(--mirror-color)" : "var(--color-left-equipment-filled-background)");
      element.style.setProperty("--enhance-flash-base-name", levelColor);
      element.style.setProperty("--enhance-flash-shading", flashShading);
      element.style.setProperty("--enhance-flash-name-color", flashName);
    }
  }
  if ((!sourceItem && !setting) || typeof element.replaceChildren !== "function" || typeof document?.createElement !== "function") return;
  const label = document.createElement("span");
  label.className = `equipment-label${instance ? " equipment-name" : ""}`;
  label.textContent = element.textContent;
  const midFigure = createMidFigureLayer(sourceItem, setting, flashDelay);
  const layers = midFigure ? [midFigure, label] : [label];
  if (!starCount) {
    element.replaceChildren(...layers);
    return;
  }
  const stars = document.createElement("span");
  stars.className = `enhancement-stars-layer${starCount === 16 ? " star-frame-16" : ""}`;
  stars.setAttribute("aria-hidden", "true");
  for (const position of enhancementStarPositions(starCount)) {
    const star = document.createElement("span");
    star.className = "enhancement-star";
    star.textContent = "★";
    if (position.gridColumn) {
      star.style.gridColumn = position.gridColumn;
      star.style.gridRow = position.gridRow;
    } else {
      star.style.left = position.left;
      star.style.top = position.top;
    }
    stars.append(star);
  }
  element.replaceChildren(...layers, stars);
}

function ensureEnhancementFlashKeyframes(waitSeconds) {
  const wait = Math.max(0, Number(waitSeconds) || 0);
  const key = Math.round(wait * 1000);
  const name = `enhance-flash-${key}`;
  if (enhancementFlashKeyframes.has(name)) return name;
  enhancementFlashKeyframes.add(name);
  const total = wait + 15;
  const waitPercent = wait / total * 100;
  const fadeInPercent = (wait + 5) / total * 100;
  const holdPercent = (wait + 10) / total * 100;
  if (typeof document !== "undefined" && document.head?.append) {
    const style = document.createElement("style");
    style.dataset.enhancementFlash = name;
    style.textContent = `@keyframes ${name}{0%,${waitPercent}%{background-color:var(--enhance-flash-base-bg);color:var(--enhance-flash-base-name)}${fadeInPercent}%,${holdPercent}%{background-color:var(--enhance-flash-shading);color:var(--enhance-flash-name-color)}100%{background-color:var(--enhance-flash-base-bg);color:var(--enhance-flash-base-name)}}`;
    document.head.append(style);
  }
  return name;
}

function ensureEnhancementMidFlashKeyframes(waitSeconds) {
  const wait = Math.max(0, Number(waitSeconds) || 0);
  const key = Math.round(wait * 1000);
  const name = `enhance-mid-flash-${key}`;
  if (enhancementFlashKeyframes.has(name)) return name;
  enhancementFlashKeyframes.add(name);
  const total = wait + 15;
  const waitPercent = wait / total * 100;
  const fadeInPercent = (wait + 5) / total * 100;
  const holdPercent = (wait + 10) / total * 100;
  const style = document.createElement("style");
  style.dataset.enhancementFlash = name;
  style.textContent = `@keyframes ${name}{0%,${waitPercent}%{background-color:var(--slot-mid-color)}${fadeInPercent}%,${holdPercent}%{background-color:var(--enhance-flash-mid-color)}100%{background-color:var(--slot-mid-color)}}`;
  document.head.append(style);
  return name;
}

function equipmentTooltipModel(item, action, instance = null) {
  if (!item) return null;
  const bonus = enhancementBonus(instance);
  const statValue = (key) => Number(item[key] ?? 0) + Number(bonus[key] ?? 0);
  const formatStat = (key) => {
    const value = statValue(key);
    return { key, value, text: `${key}${value > 0 ? "+" : ""}${formatEnhancementValue(key, value)}` };
  };
  const primary = DERIVED_STAT_KEYS
    .map((key) => [key, Number(item[key] ?? 0) + Number(bonus[key] ?? 0)])
    .filter(([, value]) => value)
    .map(([key]) => formatStat(key));
  const attributes = ATTRIBUTE_KEYS
    .map((key) => formatStat(key))
    .filter(({ value }) => value);
  const enhancement = normalizeEnhancement(instance);
  return {
    title: equipmentDisplayName(item, instance),
    itemLevel: Number(item.item_level),
    bless: enhancement.level >= 5 ? enhancement.blessCount : null,
    curse: enhancement.level >= 5 ? enhancement.curseCount : null,
    chaos: enhancement.level >= 5 ? enhancement.chaosCount : null,
    returned: enhancement.returnCount,
    primary,
    attributes,
    action,
  };
}

function equipmentTooltip(item, action, instance = null) {
  const model = equipmentTooltipModel(item, action, instance);
  if (!model) return "";
  const lines = [`${model.title} | Lv.${model.itemLevel}`];
  if (model.bless !== null || model.returned > 0) lines.push(`祝福 ${model.bless ?? 0} | 詛咒 ${model.curse ?? 0} | 混沌 ${model.chaos ?? 0} | 倒回 ${model.returned}`);
  const rowCount = Math.max(model.primary.length, model.attributes.length);
  for (let index = 0; index < rowCount; index++) {
    lines.push(`${model.primary[index]?.text ?? ""} | ${model.attributes[index]?.text ?? ""}`.trimEnd());
  }
  if (model.action) lines.push(model.action);
  return lines.join("\n");
}

function assignEquipmentTooltip(element, item, action, instance = null) {
  if (!element) return;
  if (!item) {
    equipmentTooltipModels.delete(element);
    delete element.dataset.equipmentTooltip;
    return;
  }
  equipmentTooltipModels.set(element, equipmentTooltipModel(item, action, instance));
  element.dataset.equipmentTooltip = "true";
  if (typeof element.removeAttribute === "function") element.removeAttribute("title");
  else element.title = "";
}

function renderEquipmentTooltip(popup, model) {
  popup.replaceChildren();
  const title = document.createElement("strong");
  title.className = "equipment-tooltip-title";
  const name = document.createElement("span");
  name.textContent = model.title;
  const level = document.createElement("span");
  level.textContent = `Lv.${model.itemLevel}`;
  title.append(name, level);
  popup.append(title);

  if (model.bless !== null || model.returned > 0) {
    const headings = document.createElement("div");
    headings.className = "equipment-tooltip-row equipment-tooltip-headings";
    const counts = document.createElement("span");
    counts.textContent = `祝福 ${model.bless ?? 0}　詛咒 ${model.curse ?? 0}　混沌 ${model.chaos ?? 0}　倒回 ${model.returned}`;
    headings.append(counts);
    popup.append(headings);
  }

  const rowCount = Math.max(model.primary.length, model.attributes.length);
  for (let index = 0; index < rowCount; index++) {
    const row = document.createElement("div");
    row.className = "equipment-tooltip-row";
    const primary = document.createElement("span");
    primary.textContent = model.primary[index]?.text ?? "";
    const attribute = document.createElement("span");
    attribute.textContent = model.attributes[index]?.text ?? "";
    row.append(primary, attribute);
    popup.append(row);
  }

  if (model.action) {
    const action = document.createElement("small");
    action.className = "equipment-tooltip-action";
    action.textContent = model.action;
    popup.append(action);
  }
}

function setupEquipmentTooltip() {
  const popup = $("#equipment-tooltip");
  if (!popup) return;
  let activeElement = null;
  const move = (event) => {
    const gap = 14;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    popup.style.left = `${Math.max(8, Math.min(event.clientX + gap, window.innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(event.clientY + gap, window.innerHeight - height - 8))}px`;
  };
  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest?.("[data-equipment-tooltip]");
    const model = target ? equipmentTooltipModels.get(target) : null;
    if (!model) return;
    const tooltipHost = target.closest?.("#enhance-dialog") ?? document.body;
    if (popup.parentElement !== tooltipHost) tooltipHost.append(popup);
    activeElement = target;
    renderEquipmentTooltip(popup, model);
    popup.hidden = false;
    move(event);
  });
  document.addEventListener("mousemove", (event) => {
    if (activeElement) move(event);
  });
  document.addEventListener("mouseout", (event) => {
    if (!activeElement || event.relatedTarget && activeElement.contains(event.relatedTarget)) return;
    activeElement = null;
    popup.hidden = true;
  });
}

function itemTooltip(item) {
  if (!item) return "";
  const enhancementStone = enhancementStoneDisplay(item);
  if (enhancementStone) {
    return `${item.item_name}\n${enhancementStone.effectName} 機率提升 ${item.effect_value_min}% ~ ${item.effect_value_max}%`;
  }
  const lines = [item.item_name];
  const effectNames = { HPrecover: "生命恢復", MPrecover: "魔力恢復" };
  if (effectNames[item.effect]) lines.push(`${effectNames[item.effect]} ${item.effect_value_min}~${item.effect_value_max}`);
  else if (item.effect === "learn_skill") {
    const className = state.data.classes.find((row) => row.class_id === item.target)?.class_name ?? item.target ?? "未知職業";
    const level = state.data.characterSkills.find((row) => row.skill_id === item.skill_id)?.level;
    lines[0] = `${item.item_name} | Lv. ${Number.isFinite(Number(level)) ? Number(level) : "?"}`;
    lines.push(`${className} 技能書`);
  }
  else if (item.effect) lines.push(`效果 ${item.effect}`);
  if (item.cooldown !== null && item.cooldown !== undefined) lines.push(`冷卻時間 ${item.cooldown} 秒`);
  return lines.join("\n");
}

function equipmentSlotLabel(position) {
  return { necklace:"項鍊", earrings:"耳環", helmet:"頭盔", physical_weapon:"武器", magic_weapon:"武器", body:"盔甲", shield:"副手", ring:"戒指", kneepads:"護膝", idol:"神像", gloves:"手套", shoe:"鞋子", core:"核心" }[position] ?? position;
}

function buildInventoryGrid() {
  const grid = $("#inventory-grid");
  grid.replaceChildren();
  for (let i = 0; i < state.inventoryPageCapacity; i++) {
    const cell = document.createElement("button"); cell.type = "button"; cell.disabled = true;
    cell.addEventListener("click", () => useInventoryCell(i)); grid.append(cell);
  }
}

function setupInventoryPages() {
  const recalculate = () => recalculateInventoryLayout();
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(recalculate);
    observer.observe($(".field-box"));
  } else window.addEventListener("resize", recalculate);
  requestAnimationFrame(recalculate);
}

function selectInventoryPage(page) {
  state.inventoryPage = clamp(Math.trunc(Number(page) || 0), 0, inventoryPageCount() - 1);
  if (state.inventoryPage < state.inventoryPageWindowStart) state.inventoryPageWindowStart = state.inventoryPage;
  if (state.inventoryPage >= state.inventoryPageWindowStart + INVENTORY_MAX_PAGE_BUTTONS) state.inventoryPageWindowStart = state.inventoryPage - INVENTORY_MAX_PAGE_BUTTONS + 1;
  renderInventoryPagination();
}

function inventoryEntryAt(inventoryIndex) {
  return state.inventory.find((entry) => entry.inventoryIndex === inventoryIndex) ?? null;
}

function usedInventoryIndices(excluding = null) {
  return new Set(state.inventory.filter((entry) => entry !== excluding).map((entry) => entry.inventoryIndex).filter((index) => Number.isInteger(index) && index >= 0 && index < INVENTORY_MAX_SLOTS));
}

function firstFreeInventoryIndex(preferredIndex = null, excluding = null) {
  const used = usedInventoryIndices(excluding);
  const preferred = Number(preferredIndex);
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < INVENTORY_MAX_SLOTS && !used.has(preferred)) return preferred;
  for (let index = 0; index < INVENTORY_MAX_SLOTS; index++) if (!used.has(index)) return index;
  return -1;
}

function compactInventory() {
  state.inventory = state.inventory
    .map((entry, order) => ({ entry, order, index: Number(entry.inventoryIndex) }))
    .sort((left, right) => {
      const leftValid = Number.isInteger(left.index) && left.index >= 0 && left.index < INVENTORY_MAX_SLOTS;
      const rightValid = Number.isInteger(right.index) && right.index >= 0 && right.index < INVENTORY_MAX_SLOTS;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      return leftValid && left.index !== right.index ? left.index - right.index : left.order - right.order;
    })
    .slice(0, INVENTORY_MAX_SLOTS)
    .map(({ entry }, inventoryIndex) => { entry.inventoryIndex = inventoryIndex; return entry; });
  state.inventoryPage = clamp(state.inventoryPage, 0, inventoryPageCount() - 1);
  state.inventoryPageWindowStart = clamp(state.inventoryPageWindowStart, 0, Math.max(0, inventoryPageCount() - INVENTORY_MAX_PAGE_BUTTONS));
  renderInventoryPagination();
  return state.inventory;
}

function normalizeInventoryIndices() {
  return compactInventory();
}

function removeInventoryEntryAt(arrayIndex) {
  if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= state.inventory.length) return null;
  const [removed] = state.inventory.splice(arrayIndex, 1);
  compactInventory();
  return removed ?? null;
}

function inventoryPageCount() {
  const capacity = Math.max(1, state.inventoryPageCapacity);
  const highest = state.inventory.reduce((maximum, entry) => Math.max(maximum, Number(entry.inventoryIndex) || 0), -1);
  const accessibleSlots = Math.min(INVENTORY_MAX_SLOTS, Math.max(capacity, highest + 1 + INVENTORY_RESERVE_SLOTS));
  return Math.max(1, Math.ceil(accessibleSlots / capacity));
}

function renderInventoryPagination() {
  const pagination = document.querySelector(".inventory-pages");
  if (!pagination) return;
  const pageCount = inventoryPageCount();
  state.inventoryPage = clamp(state.inventoryPage, 0, pageCount - 1);
  const maxStart = Math.max(0, pageCount - INVENTORY_MAX_PAGE_BUTTONS);
  state.inventoryPageWindowStart = clamp(state.inventoryPageWindowStart, 0, maxStart);
  if (state.inventoryPage < state.inventoryPageWindowStart) state.inventoryPageWindowStart = state.inventoryPage;
  if (state.inventoryPage >= state.inventoryPageWindowStart + INVENTORY_MAX_PAGE_BUTTONS) state.inventoryPageWindowStart = state.inventoryPage - INVENTORY_MAX_PAGE_BUTTONS + 1;
  const signature = `${pageCount}:${state.inventoryPage}:${state.inventoryPageWindowStart}`;
  if (pagination.dataset.renderSignature === signature) return;
  pagination.dataset.renderSignature = signature;
  pagination.replaceChildren();
  const makeButton = (text, action, disabled = false, active = false) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = text; button.disabled = disabled; button.classList.toggle("active", active);
    button.addEventListener("click", action); pagination.append(button);
  };
  makeButton("‹", () => { state.inventoryPageWindowStart = Math.max(0, state.inventoryPageWindowStart - INVENTORY_MAX_PAGE_BUTTONS); renderInventoryPagination(); }, state.inventoryPageWindowStart === 0);
  const end = Math.min(pageCount, state.inventoryPageWindowStart + INVENTORY_MAX_PAGE_BUTTONS);
  for (let page = state.inventoryPageWindowStart; page < end; page++) makeButton(String(page + 1), () => { selectInventoryPage(page); renderInventory(); }, false, page === state.inventoryPage);
  makeButton("›", () => { state.inventoryPageWindowStart = Math.min(maxStart, state.inventoryPageWindowStart + INVENTORY_MAX_PAGE_BUTTONS); renderInventoryPagination(); }, end >= pageCount);
}

function recalculateInventoryLayout() {
  const grid = $("#inventory-grid");
  const field = $(".field-box");
  if (!grid || !field) return;
  const oldCapacity = Math.max(1, state.inventoryPageCapacity);
  const anchorIndex = state.inventoryPage * oldCapacity;
  const styles = getComputedStyle(grid);
  const horizontalPadding = parseFloat(styles.paddingLeft || 0) + parseFloat(styles.paddingRight || 0);
  const verticalPadding = parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0);
  const width = Math.max(INVENTORY_SLOT_SIZE, grid.clientWidth - horizontalPadding);
  const pageHeight = document.querySelector(".inventory-pages")?.offsetHeight || 38;
  const height = Math.max(INVENTORY_SLOT_SIZE, field.clientHeight - pageHeight - verticalPadding - 2);
  const columns = Math.max(1, Math.floor((width + INVENTORY_SLOT_GAP) / (INVENTORY_SLOT_SIZE + INVENTORY_SLOT_GAP)));
  const rows = Math.max(1, Math.floor((height + INVENTORY_SLOT_GAP) / (INVENTORY_SLOT_SIZE + INVENTORY_SLOT_GAP)));
  const capacity = Math.max(1, columns * rows);
  if (capacity === state.inventoryPageCapacity && columns === state.inventoryColumns && rows === state.inventoryRows) return;
  state.inventoryColumns = columns; state.inventoryRows = rows; state.inventoryPageCapacity = capacity;
  grid.style.setProperty("--inventory-columns", columns);
  grid.style.setProperty("--inventory-rows", rows);
  state.inventoryPage = clamp(Math.floor(anchorIndex / capacity), 0, inventoryPageCount() - 1);
  buildInventoryGrid();
  renderInventoryPagination();
  renderInventory();
  if (state.rightPage === "warehouse") recalculateBigStorageLayout();
}

function buildParty() {
  const preferredClassIds = ["priest", "mage", "warrior"];
  const orderedClassIds = [
    ...preferredClassIds.filter((classId) => state.data.classes.some((cls) => cls.class_id === classId)),
    ...state.data.classes.map((cls) => cls.class_id).filter((classId) => !preferredClassIds.includes(classId)),
  ];
  const assignments = ["A", "B", "C"].map((slot, index) => ({ slot, classId: orderedClassIds[index] }));
  state.roster = state.data.classes.map((cls) => {
    const assignment = assignments.find((row) => row.classId === cls.class_id);
    const slot = assignment?.slot ?? null;
    const classId = cls.class_id;
    const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, cls[key] ?? 0]));
    const hero = { id: slot ?? classId, slot, className: cls.class_name, customName: "", name: cls.class_name, classId, level: 1, exp: 0, attributes,
      levelPlan: defaultLevelPlan(attributes), growthStats: Object.fromEntries(DERIVED_STAT_KEYS.map((key) => [key, 0])), hp: 0, mp: 0, cooldown: 0,
      learnedSkillIds: new Set(), skillEnabled: {}, skillSettings: {}, skillCooldowns: {}, itemCooldowns: {}, casting: null, buffs: [],
      recoverySettings: { hpEnabled: true, hpPercent: 20, hpItemId: null, mpEnabled: true, mpPercent: 20, mpItemId: null }, resetAvailableAt: 0 };
    initializeEquipmentSets(hero);
    assignInitialEquipment(hero, cls);
    recalculateHeroStats(hero, true);
    grantBuiltInSkills(hero);
    return hero;
  });
  state.party = assignments.map(({ classId }) => state.roster.find((hero) => hero.classId === classId)).filter(Boolean);
  if (typeof document !== "undefined") updateCharacterControls();
}

function swapPartyMember(slot, classId) {
  const partyIndex = state.party.findIndex((hero) => hero.slot === slot);
  const incoming = state.roster.find((hero) => hero.classId === classId);
  if (partyIndex < 0 || !incoming || (incoming.slot && incoming.slot !== slot)) return false;
  const outgoing = state.party[partyIndex];
  if (incoming === outgoing) return true;
  outgoing.slot = null;
  outgoing.id = outgoing.classId;
  incoming.slot = slot;
  incoming.id = slot;
  state.party[partyIndex] = incoming;
  return true;
}

function changePartyMember(slot, classId) {
  const outgoing = state.party.find((hero) => hero.slot === slot);
  if (!outgoing || !swapPartyMember(slot, classId)) return;
  const incoming = state.party.find((hero) => hero.slot === slot);
  addLog(`${outgoing.name} 更換為 ${incoming.name}；HP、MP 狀態各自保留。`);
  updateCharacterControls();
  updateMapLocks();
  const selectedEquipment = document.querySelector(".character-tabs button.active")?.dataset.character ?? slot;
  showEquipment(selectedEquipment);
  if ($("#attribute-dialog")?.open) renderAttributePanel();
  if ($("#character-info-dialog")?.open) renderCharacterInfoPanel();
  if ($("#skill-dialog")?.open) renderSkillPanel();
  render();
}

function updateCharacterControls() {
  for (const selector of [".character-tabs", "#character-info-characters", "#attribute-characters", "#skill-characters", "#enhance-characters"]) {
    for (const button of document.querySelectorAll(`${selector} button`)) {
      const hero = state.party.find((member) => member.slot === button.dataset.character);
      if (!hero) continue;
      button.textContent = selector === "#attribute-characters" ? `${hero.className} Lv.${hero.level}` : hero.className;
    }
  }
}

function defaultLevelPlan(attributes) {
  const plan = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 0]));
  const primary = ATTRIBUTE_KEYS.reduce((best, key) => attributes[key] > attributes[best] ? key : best, ATTRIBUTE_KEYS[0]);
  plan[primary] = 5;
  return plan;
}

function heroGear(hero) {
  return Object.values(resolvedEquipmentForSet(hero))
    .map(({ instance: equipped }) => {
      const item = state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId);
      if (!item) return null;
      const bonus = enhancementBonus(equipped);
      return { ...item, ...Object.fromEntries([...DERIVED_STAT_KEYS, ...ATTRIBUTE_KEYS].map((key) => [key, Number(item[key] ?? 0) + Number(bonus[key] ?? 0)])) };
    })
    .filter(Boolean);
}

function assignInitialEquipment(hero, cls) {
  const equipment = equipmentConfig(hero, 1);
  for (const itemId of [cls.initial_weapon, cls.initial_body].filter(Boolean)) {
    const item = state.data.equipment.find((row) => row.item_id === itemId);
    const slotKey = findEquipmentSlot(hero, item, 1);
    if (item && slotKey) equipment[slotKey] = normalizeEquipmentInstance({ itemId });
  }
}

function findEquipmentSlot(hero, item, setNumber = hero?.activeEquipmentSet) {
  const equipment = equipmentConfig(hero, setNumber);
  const compatible = EQUIPMENT_SLOTS.filter((slot) => {
    if (slot.positions.includes(item?.EQ_position)) return true;
    return item?.weapon_type === "martial_weapon" && slot.key === "shield_1";
  });
  if (item?.weapon_type === "martial_weapon") {
    const mainWeapon = equipment.weapon_1
      ? state.data.equipment.find((row) => row.item_id === equipment.weapon_1.itemId)
      : null;
    if (mainWeapon?.weapon_type === "two_hand_weapon") return "weapon_1";
  }
  return compatible.find((slot) => !equipment[slot.key])?.key ?? compatible[0]?.key ?? null;
}

function effectiveAttributes(hero) {
  const gear = heroGear(hero);
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, hero.attributes[key] + gear.reduce((sum, item) => sum + (item[key] ?? 0), 0)]));
}

function equipmentStatContribution(hero, statName) {
  if (!hero?.equipmentSets) return 0;
  const gear = heroGear(hero);
  const direct = gear.reduce((sum, item) => sum + Number(item[statName] ?? 0), 0);
  const attributeDriven = state.data.characterAttribute.reduce((sum, rule) => {
    const coefficient = Number(rule[statName]) || 0;
    const equipmentAttribute = gear.reduce((total, item) => total + Number(item[rule.Attribute] ?? 0), 0);
    return sum + coefficient * equipmentAttribute;
  }, 0);
  return roundStat(direct + attributeDriven);
}

function recalculateHeroStats(hero, refill = false) {
  const cls = state.data.classes.find((row) => row.class_id === hero.classId);
  const gear = heroGear(hero);
  const stat = (name) => (cls[`base_${name}`] ?? 0) + gear.reduce((sum, item) => sum + (item[name] ?? 0), 0);
  const attr = effectiveAttributes(hero);
  const attributeBonus = (name) => state.data.characterAttribute.reduce((sum, rule) => sum + (Number(rule[name]) || 0) * (Number(attr[rule.Attribute]) || 0), 0);
  const calculated = Object.fromEntries(DERIVED_STAT_KEYS.map((key) => [key, stat(key) + attributeBonus(key) + (hero.growthStats?.[key] ?? 0)]));
  const overBonuses = Object.fromEntries(DERIVED_STAT_KEYS.map((key) => [key, 0]));
  for (const rule of state.data.characterAttribute) {
    if (!(rule.over_att_num > 0) || !rule.over_effect || rule.overvalue === null) continue;
    const points = Number(attr[rule.Attribute]) || 0;
    const occurrences = rule.Recursive ? Math.floor(points / rule.over_att_num) : (points >= rule.over_att_num ? 1 : 0);
    if (occurrences <= 0) continue;
    const context = { ...attr, ...calculated };
    const formula = String(rule.overvalue).replace(/\s+/g, "");
    const formulaMatch = formula.match(/^([A-Za-z_]+)\*(-?\d+(?:\.\d+)?)$/);
    const perOccurrence = formulaMatch ? (Number(context[formulaMatch[1]]) || 0) * Number(formulaMatch[2]) : Number(formula);
    overBonuses[rule.over_effect] += perOccurrence * occurrences;
  }
  hero.overAttributeBonuses = overBonuses;
  for (const key of DERIVED_STAT_KEYS) hero[key] = roundStat(calculated[key] + overBonuses[key]);
  hero.maxHp = Math.max(1, hero.HP);
  hero.maxMp = Math.max(0, hero.MP);
  for (const key of ATTRIBUTE_KEYS) hero[key] = attr[key];
  hero.attackType = gear.some((item) => item.EQ_position === "magic_weapon") ? "magic" : "melee";
  if (refill) { hero.hp = hero.maxHp; hero.mp = hero.maxMp; }
  else { hero.hp = Math.min(hero.hp, hero.maxHp); hero.mp = Math.min(hero.mp, hero.maxMp); }
}

function setupCharacterInfoPanel() {
  $("#character-info-button").addEventListener("click", () => {
    state.infoCharacter = state.equipmentCharacter;
    renderCharacterInfoPanel();
    $("#character-info-dialog").showModal();
  });
  $("#character-info-close").addEventListener("click", () => $("#character-info-dialog").close());
  for (const button of document.querySelectorAll("#character-info-characters button")) {
    button.addEventListener("click", () => {
      state.infoCharacter = button.dataset.character;
      renderCharacterInfoPanel();
    });
  }
}

function signedStat(value, digits = null) {
  const numeric = digits === null ? roundStat(Number(value) || 0) : Math.round((Number(value) || 0) * (10 ** digits)) / (10 ** digits);
  const formatted = digits === null ? formatExactNumber(numeric) : numeric.toFixed(digits);
  return `${numeric >= 0 ? "+" : ""}${formatted}`;
}

function attributeDefinition(attribute) {
  return state.data?.attributeIndex?.find((row) => row.Attribute === attribute) ?? null;
}

function indexedAttributeLabel(attribute) {
  const definition = attributeDefinition(attribute);
  return definition?.name_Attribute ? `${attribute} [${definition.name_Attribute}]` : attribute;
}

function characterInfoStat(attribute, value, numericValue = null) {
  return {
    label: indexedAttributeLabel(attribute),
    value,
    valueClass: Number(numericValue) < 0 ? "negative-value" : "positive-value",
    title: attributeDefinition(attribute)?.document_Attribute ?? "",
  };
}

function characterInfoCells(hero) {
  const attributes = effectiveAttributes(hero);
  const requiredExp = requiredExpFor(hero.level);
  return [
    { text: hero.name, className: "header" }, { text: "", className: "header" }, { text: `Lv.${hero.level}`, className: "header right" },
    characterInfoStat("HP", formatExactNumber(hero.hp)), characterInfoStat("MP", formatExactNumber(hero.mp)), characterInfoStat("EXP", hero.level >= 100 ? "MAX" : `${formatExactNumber(hero.exp)}/${formatCompactNumber(requiredExp ?? 0)}`),
    characterInfoStat("ATK", signedStat(combatStat(hero, "ATK")), combatStat(hero, "ATK")), characterInfoStat("AC", signedStat(combatStat(hero, "AC")), combatStat(hero, "AC")), characterInfoStat("STR", signedStat(attributes.STR), attributes.STR),
    characterInfoStat("MATK", signedStat(combatStat(hero, "MATK")), combatStat(hero, "MATK")), characterInfoStat("MR", signedStat(combatStat(hero, "MR")), combatStat(hero, "MR")), characterInfoStat("CON", signedStat(attributes.CON), attributes.CON),
    characterInfoStat("ADAM", signedStat(combatStat(hero, "ADAM")), combatStat(hero, "ADAM")), characterInfoStat("HPR", signedStat(combatStat(hero, "HPR"), 1), combatStat(hero, "HPR")), characterInfoStat("INT", signedStat(attributes.INT), attributes.INT),
    characterInfoStat("MDAM", signedStat(combatStat(hero, "MDAM")), combatStat(hero, "MDAM")), characterInfoStat("MPR", signedStat(combatStat(hero, "MPR"), 1), combatStat(hero, "MPR")), characterInfoStat("WIS", signedStat(attributes.WIS), attributes.WIS),
    characterInfoStat("CRI", signedStat(combatStat(hero, "CRI")), combatStat(hero, "CRI")), characterInfoStat("AAR", signedStat(combatStat(hero, "AAR")), combatStat(hero, "AAR")), characterInfoStat("DEX", signedStat(attributes.DEX), attributes.DEX),
    characterInfoStat("CRI_DMG", signedStat(combatStat(hero, "CRI_DMG")), combatStat(hero, "CRI_DMG")), characterInfoStat("SAR", signedStat(combatStat(hero, "SAR")), combatStat(hero, "SAR")), characterInfoStat("LUK", signedStat(attributes.LUK), attributes.LUK),
  ];
}

function renderCharacterInfoPanel() {
  const hero = state.party.find((member) => member.slot === state.infoCharacter) ?? state.party[0];
  if (!hero) return;
  state.infoCharacter = hero.slot;
  document.querySelectorAll("#character-info-characters button").forEach((button) => button.classList.toggle("active", button.dataset.character === hero.slot));
  const cells = characterInfoCells(hero);
  const grid = $("#character-info-grid");
  grid.replaceChildren(...cells.map((cell) => {
    const element = document.createElement("div");
    element.className = `character-info-cell ${cell.className ?? ""}`.trim();
    if (cell.title) element.title = cell.title;
    if (cell.label) {
      const label = document.createElement("strong"); label.textContent = cell.label;
      const value = document.createElement("span"); value.textContent = cell.value; value.className = cell.valueClass ?? "";
      element.append(label, value);
    } else element.textContent = cell.text;
    return element;
  }));
}

function setupAttributePanel() {
  buildAttributeGrid();
  $("#attribute-button").addEventListener("click", () => { renderAttributePanel(); $("#attribute-dialog").showModal(); });
  $("#attribute-close").addEventListener("click", () => $("#attribute-dialog").close());
  for (const button of document.querySelectorAll("#attribute-characters button")) {
    button.addEventListener("click", () => { state.attributeCharacter = button.dataset.character; renderAttributePanel(); });
  }
  for (const input of document.querySelectorAll("[data-attribute]")) input.addEventListener("input", updateAttributeTotal);
  $("#attribute-form").addEventListener("submit", saveAttributePlan);
}

function buildAttributeGrid() {
  const grid = $("#attribute-grid");
  grid.replaceChildren(...ATTRIBUTE_KEYS.map((key) => {
    const row = document.createElement("div");
    row.className = "attribute-plan-row";
    const name = document.createElement("span");
    name.className = "attribute-name";
    const keyLabel = document.createElement("span");
    keyLabel.textContent = `${indexedAttributeLabel(key)} + `;
    const current = document.createElement("strong");
    current.className = "attribute-current";
    current.dataset.current = key;
    name.append(keyLabel, current);
    const inputWrap = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.max = "5"; input.step = "1"; input.dataset.attribute = key;
    input.setAttribute("aria-label", `${indexedAttributeLabel(key)} 未來升級配置`);
    inputWrap.append(input);
    const levelGain = document.createElement("strong");
    levelGain.className = "attribute-level-gain";
    levelGain.dataset.levelGain = key;
    const gearBonus = document.createElement("strong");
    gearBonus.className = "attribute-gear-bonus";
    gearBonus.dataset.gearBonus = key;
    row.title = attributeDefinition(key)?.document_Attribute ?? "";
    row.append(name, inputWrap, levelGain, gearBonus);
    return row;
  }));
}

function renderAttributePanel() {
  const hero = state.party.find((member) => member.slot === state.attributeCharacter);
  if (!hero) return;
  const current = effectiveAttributes(hero);
  const cls = state.data.classes.find((row) => row.class_id === hero.classId);
  const gear = heroGear(hero);
  document.querySelectorAll("#attribute-characters button").forEach((button) => {
    const member = state.party.find((candidate) => candidate.slot === button.dataset.character);
    if (member) button.textContent = `${member.className} Lv.${member.level}`;
    button.classList.toggle("active", button.dataset.character === hero.slot);
  });
  for (const key of ATTRIBUTE_KEYS) {
    const gearBonus = gear.reduce((sum, item) => sum + Number(item[key] ?? 0), 0);
    const levelGain = Number(hero.attributes[key] ?? 0) - Number(cls?.[key] ?? 0);
    $(`[data-current="${key}"]`).textContent = formatExactNumber(current[key]);
    $(`[data-level-gain="${key}"]`).textContent = signedStat(levelGain);
    $(`[data-gear-bonus="${key}"]`).textContent = signedStat(gearBonus);
    $(`[data-attribute="${key}"]`).value = hero.levelPlan[key];
  }
  $("#attribute-message").textContent = `${hero.name} Lv.${hero.level}：每次升級自動套用這組配置。`;
  $("#attribute-message").classList.remove("error");
  updateAttributeTotal();
}

function updateAttributeTotal() {
  const total = ATTRIBUTE_KEYS.reduce((sum, key) => sum + clamp(Number($(`[data-attribute="${key}"]`).value) || 0, 0, 5), 0);
  $("#attribute-total").textContent = `${total} / 5`;
  return total;
}

function saveAttributePlan(event) {
  event.preventDefault();
  const message = $("#attribute-message");
  if (updateAttributeTotal() !== 5) {
    message.textContent = "配置總和必須剛好是 5 點。";
    message.classList.add("error");
    return;
  }
  const hero = state.party.find((member) => member.slot === state.attributeCharacter);
  hero.levelPlan = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, clamp(Math.trunc(Number($(`[data-attribute="${key}"]`).value) || 0), 0, 5)]));
  message.textContent = `${hero.name} Lv.${hero.level} 的下次升級配置已儲存。`;
  message.classList.remove("error");
  addLog(`${hero.name} 已更新升級屬性配置。`);
}

function setupSkillPanel() {
  $("#skill-button").addEventListener("click", () => { renderSkillPanel(); $("#skill-dialog").showModal(); });
  $("#skill-close").addEventListener("click", () => $("#skill-dialog").close());
  for (const button of document.querySelectorAll("#skill-characters button")) {
    button.addEventListener("click", () => { state.skillCharacter = button.dataset.character; renderSkillPanel(); });
  }
}

function setupRecoveryPanel() {
  $("#recovery-button").addEventListener("click", () => { renderRecoveryPanel(); $("#recovery-dialog").showModal(); });
  $("#recovery-close").addEventListener("click", () => $("#recovery-dialog").close());
  const teamNameInput = $("#team-name-input");
  teamNameInput.value = state.teamName;
  teamNameInput.addEventListener("input", () => {
    const limited = [...teamNameInput.value].slice(0, 20).join("");
    teamNameInput.value = limited;
    state.teamName = limited;
    $("#team-name").textContent = limited || "隊伍";
  });
  teamNameInput.addEventListener("change", () => {
    state.teamName = normalizeTeamName(teamNameInput.value);
    teamNameInput.value = state.teamName;
    $("#team-name").textContent = state.teamName;
    persistPlayerSave();
  });
}

function saveSummaryData(save = globalThis.DreamerSaveManager?.lastLoadedSave) {
  const roster = Array.isArray(save?.roster) ? save.roster : [];
  const names = roster.map((member) => {
    const hero = state.roster.find((candidate) => candidate.classId === member.classId);
    return member.customName || hero?.className || member.classId;
  }).filter(Boolean);
  return {
    characters: names.join("、") || "—",
    level: roster.length ? `最高 Lv.${Math.max(...roster.map((member) => Number(member.level) || 1))}` : "—",
    savedAt: save?.savedAt ? new Date(save.savedAt).toLocaleString("zh-TW") : "尚未存檔",
    gameVersion: save?.gameVersion ?? DreamerSaveManager.GAME_VERSION,
    saveVersion: save?.saveVersion ?? save?.version ?? DreamerSaveManager.SAVE_VERSION,
    storage: DreamerSaveManager.storageMode === "indexeddb" ? "瀏覽器 IndexedDB" : "本機 saves/player-save.json",
  };
}

async function renderSaveManagerPanel() {
  const summary = saveSummaryData();
  $("#save-summary-character").textContent = summary.characters;
  $("#save-summary-level").textContent = summary.level;
  $("#save-summary-time").textContent = summary.savedAt;
  $("#save-summary-game-version").textContent = summary.gameVersion;
  $("#save-summary-save-version").textContent = summary.saveVersion;
  $("#save-summary-storage").textContent = summary.storage;
  const slots = await DreamerSaveManager.listSlots();
  const container = $("#save-slot-list");
  container.replaceChildren();
  for (const slotId of [...DreamerSaveManager.SLOT_IDS, DreamerSaveManager.IMPORTED_ID]) {
    const save = slots[slotId];
    const row = document.createElement("section");
    row.className = `save-slot${state.currentSlot === slotId ? " active" : ""}`;
    const copy = document.createElement("div"); copy.className = "save-slot-copy";
    const title = document.createElement("strong"); title.textContent = slotId === "imported" ? "Imported（外部測試）" : `Slot ${slotId.slice(4)}`;
    const detail = document.createElement("small");
    if (save) {
      const data = saveSummaryData(save);
      detail.textContent = `${data.characters}｜${data.level}｜${data.gameVersion}｜${data.savedAt}`;
    } else detail.textContent = "空白存檔格";
    copy.append(title, detail);
    const actions = document.createElement("div"); actions.className = "save-slot-actions";
    const primary = document.createElement("button"); primary.type = "button"; primary.textContent = save ? "讀取" : slotId === "imported" ? "等待匯入" : "開始新遊戲";
    primary.disabled = !save && slotId === "imported";
    primary.addEventListener("click", async () => {
      try {
        if (save) await switchSaveSlot(slotId);
        else await startNewGameInSlot(slotId);
      } catch (error) { showSaveManagerMessage(error.message, true); }
    });
    actions.append(primary);
    if (slotId === "imported" && save) {
      const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "重置原始檔";
      reset.addEventListener("click", async () => { if (window.confirm("確定要從 Imported Original 重建測試存檔嗎？目前測試進度會被取代。")) await resetImportedSlot(); });
      actions.append(reset);
    }
    if (save) {
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "刪除";
      remove.addEventListener("click", async () => { try { await confirmAndDeleteSlot(slotId); } catch (error) { showSaveManagerMessage(error.message, true); } });
      actions.append(remove);
    }
    row.append(copy, actions); container.append(row);
  }
  return slots;
}

function showSaveManagerMessage(text, error = false) {
  const message = $("#save-manager-message");
  message.textContent = text; message.classList.toggle("error", error);
}

async function switchSaveSlot(slotId, suppliedSave = null) {
  await runSaveTransition(async () => {
    if (state.currentSlot) await persistPlayerSave(false, true);
    const saved = suppliedSave ?? await DreamerSaveManager.loadSlot(slotId);
    if (!saved) throw new Error("這個存檔格沒有有效資料");
    await DreamerSaveManager.setActiveSlot(slotId);
    state.currentSlot = slotId;
    if (!resetRuntimeFromSave(saved)) throw new Error("存檔資料無法建立角色狀態");
    await persistPlayerSave(false, true);
  });
  await renderSaveManagerPanel();
  if ($("#save-manager-dialog")?.open) $("#save-manager-dialog").close();
  showSaveManagerMessage("讀取完成：已回到 town001 並暫停，請按「繼續」恢復遊戲。", false);
}

async function startNewGameInSlot(slotId) {
  const number = slotId.slice(4);
  if (!window.confirm(`存檔 ${number} 目前沒有遊戲資料。\n\n是否使用存檔 ${number} 開始全新遊戲？`)) return;
  await runSaveTransition(async () => {
    if (state.currentSlot) await persistPlayerSave(false, true);
    resetRuntimeFromSave(null);
    state.adventureStartedAt = new Date().toISOString();
    state.claimedRewards = new Set();
    await DreamerSaveManager.setActiveSlot(slotId);
    state.currentSlot = slotId;
    try { await persistPlayerSave(false, true); }
    catch (error) { state.currentSlot = null; await DreamerSaveManager.setActiveSlot(null); await DreamerSaveManager.deleteSlot(slotId); throw error; }
  });
  await renderSaveManagerPanel();
  if ($("#save-manager-dialog")?.open) $("#save-manager-dialog").close();
  showSaveManagerMessage("新遊戲建立完成：目前位於 town001 並暫停。", false);
}

async function resetImportedSlot() {
  await runSaveTransition(async () => {
    if (state.currentSlot) await persistPlayerSave(false, true);
    const saved = await DreamerSaveManager.resetImportedWorking();
    await DreamerSaveManager.setActiveSlot("imported");
    state.currentSlot = "imported";
    resetRuntimeFromSave(saved);
    await persistPlayerSave(false, true);
  });
  await renderSaveManagerPanel();
  if ($("#save-manager-dialog")?.open) $("#save-manager-dialog").close();
  showSaveManagerMessage("Imported Working Copy 已由 Original 重建。", false);
}

async function confirmAndDeleteSlot(slotId) {
  if (!window.confirm("確定要刪除此存檔嗎？\n\n此動作無法復原。")) return;
  const slots = await DreamerSaveManager.listSlots();
  const existingCount = Object.values(slots).filter(Boolean).length;
  if (existingCount === 1 && !window.confirm("這是目前最後一個存檔。\n\n刪除後，所有遊戲存檔都會被清除。\n之後只能開始全新遊戲或重新匯入存檔。\n\n確定要繼續嗎？")) return;
  if (state.currentSlot === slotId) {
    await runSaveTransition(async () => {
      await DreamerSaveManager.deleteSlot(slotId);
      state.currentSlot = null;
      resetRuntimeFromSave(null);
    });
  } else await DreamerSaveManager.deleteSlot(slotId);
  await renderSaveManagerPanel();
  showSaveManagerMessage("存檔已刪除；請自行選擇其他存檔或開始新遊戲。", false);
}

function setupSaveManagerPanel() {
  const dialog = $("#save-manager-dialog");
  const message = $("#save-manager-message");
  const fileInput = $("#save-import-file");
  $("#save-manager-button").addEventListener("click", async () => {
    await persistPlayerSave();
    await renderSaveManagerPanel();
    message.textContent = "";
    message.classList.remove("error");
    if ($("#recovery-dialog")?.open) $("#recovery-dialog").close();
    dialog.showModal();
  });
  $("#save-manager-close").addEventListener("click", () => dialog.close());
  $("#save-export").addEventListener("click", async () => {
    try {
      if (!state.currentSlot) throw new Error("請先建立或匯入一個存檔");
      dialog.close();
      await runSaveTransition(async () => {
        if (state.savePromise) await state.savePromise;
        forceSafeTown(); state.paused = true; updatePauseButton();
        const saved = await persistPlayerSave(false, true);
        await DreamerSaveManager.exportSave(saved);
      });
      message.textContent = "完整存檔已安全匯出；目前位於 town001 並保持暫停。";
      message.classList.remove("error");
      await renderSaveManagerPanel();
    } catch (error) {
      message.textContent = `匯出失敗：${error.message}`;
      message.classList.add("error");
    }
  });
  $("#save-import").addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = await DreamerSaveManager.importSave(file);
      const highestLevel = Math.max(...imported.roster.map((member) => Number(member.level) || 1));
      if (!window.confirm(`確認匯入至 Imported？\n匯入檔案最高角色等級：Lv.${highestLevel}\nSlot 1～5 不會被覆蓋。`)) {
        message.textContent = "已取消匯入，目前存檔沒有變更。";
        message.classList.remove("error");
        return;
      }
      dialog.close();
      await runSaveTransition(async () => {
        if (state.currentSlot) await persistPlayerSave(false, true);
        const working = await DreamerSaveManager.importToImported(imported);
        working.adventure_started_at = new Date().toISOString();
        await DreamerSaveManager.setActiveSlot("imported");
        state.currentSlot = "imported";
        resetRuntimeFromSave(working);
        await persistPlayerSave(false, true);
      });
      message.textContent = "匯入成功；Original 已保留，Working Copy 已載入 town001 並暫停。";
      message.classList.remove("error");
      await renderSaveManagerPanel();
    } catch (error) {
      message.textContent = `匯入失敗：${error.message}`;
      message.classList.add("error");
    }
  });
}

function renderWelcomePanel() {
  const container = $("#welcome-lines");
  container.replaceChildren();
  $("#welcome-dialog-title").textContent = "歡迎訊息";
  $("#welcome-view-toggle").textContent = "Patch Note";
  for (const row of state.data.welcomeNews) {
    const line = document.createElement("p");
    line.textContent = String(row.welcome_name ?? "").replaceAll("{GAME_VERSION}", getCurrentGameVersion());
    line.style.color = csvColor(row.welcome_color);
    line.style.fontSize = `${Number(row.welcome_pt)}pt`;
    line.style.fontWeight = row.is_Bold ? "700" : "400";
    container.append(line);
  }
}

function patchNoteSeriesList() {
  return [...new Set(state.data.patchNotes.map((row) => versionParts(row.version)?.slice(0, 2).join(".")).filter(Boolean))]
    .sort((left, right) => compareGameVersions(`${right}.0`, `${left}.0`));
}

function renderPatchNotePanel() {
  const container = $("#welcome-lines");
  container.replaceChildren();
  $("#welcome-dialog-title").textContent = "更新紀錄";
  $("#welcome-view-toggle").textContent = "歡迎訊息";
  const seriesList = patchNoteSeriesList();
  if (!seriesList.includes(state.patchNoteSeries)) state.patchNoteSeries = seriesList[0] ?? null;

  const seriesNav = document.createElement("nav");
  seriesNav.className = "patch-note-series";
  seriesNav.setAttribute("aria-label", "Patch Note 主版本");
  for (const series of seriesList) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = series;
    button.classList.toggle("active", series === state.patchNoteSeries);
    button.style.color = indexedColor("Patchnote_main_color");
    button.addEventListener("click", () => { state.patchNoteSeries = series; renderPatchNotePanel(); });
    seriesNav.append(button);
  }
  container.append(seriesNav);

  const versions = [...new Set(state.data.patchNotes
    .filter((row) => versionParts(row.version)?.slice(0, 2).join(".") === state.patchNoteSeries)
    .map((row) => row.version))].sort((left, right) => compareGameVersions(right, left));
  for (const version of versions) {
    const section = document.createElement("section");
    section.className = "patch-note-version";
    const heading = document.createElement("h3");
    heading.textContent = `--- Ver ${version} ---`;
    heading.style.color = indexedColor("Patchnote_ver_color");
    section.append(heading);
    const rows = state.data.patchNotes.filter((row) => row.version === version);
    const typeOrder = [...new Set(rows.map((row) => row.type))];
    for (const type of typeOrder) {
      const typeHeading = document.createElement("h4");
      typeHeading.textContent = `【${type}】`;
      typeHeading.style.color = indexedColor("Patchnote_type_color");
      section.append(typeHeading);
      const list = document.createElement("ul");
      list.style.color = indexedColor("Patchnote_color");
      for (const row of rows.filter((candidate) => candidate.type === type)) {
        const item = document.createElement("li");
        item.textContent = row.patch_note;
        list.append(item);
      }
      section.append(list);
    }
    container.append(section);
  }
}

function renderWelcomeDialogContent() {
  if (state.welcomeView === "patch") renderPatchNotePanel();
  else renderWelcomePanel();
}

function openWelcomePanel() {
  const dialog = $("#welcome-dialog");
  state.welcomeView = "welcome";
  renderWelcomeDialogContent();
  if (!dialog.open) dialog.showModal();
}

function setupWelcomePanel() {
  $("#welcome-button").addEventListener("click", openWelcomePanel);
  $("#welcome-view-toggle").addEventListener("click", () => {
    state.welcomeView = state.welcomeView === "welcome" ? "patch" : "welcome";
    renderWelcomeDialogContent();
  });
  $("#welcome-close").addEventListener("click", () => $("#welcome-dialog").close());
}

function normalizeTeamName(value) {
  const normalized = [...String(value ?? "").trim()].slice(0, 20).join("");
  return normalized || "隊伍";
}

function normalizeCharacterName(value) {
  return [...String(value ?? "").trim()].slice(0, 20).join("");
}

function setCharacterName(hero, value) {
  if (!hero) return "";
  hero.customName = normalizeCharacterName(value);
  hero.name = hero.customName || hero.className;
  render();
  if ($("#character-info-dialog")?.open) renderCharacterInfoPanel();
  persistPlayerSave();
  return hero.customName;
}

function setupEnhancePanel() {
  $("#anvil-button").addEventListener("click", () => {
    state.enhanceCharacter = state.equipmentCharacter;
    const hero = state.party.find((member) => member.slot === state.enhanceCharacter);
    state.enhanceEquipmentSet = equipmentSetNumber(hero?.activeEquipmentSet);
    state.enhanceEquipmentSlot = null;
    state.enhanceSelectedAttribute = null;
    state.enhanceOperation = null;
    renderEnhancePanel();
    $("#enhance-dialog").append($("#equipment-tooltip"));
    $("#enhance-dialog").showModal();
  });
  $("#enhance-close").addEventListener("click", () => {
    $("#enhance-dialog").close();
    $("#equipment-tooltip").hidden = true;
    document.body.append($("#equipment-tooltip"));
  });
  for (const button of document.querySelectorAll("#enhance-characters button")) {
    button.addEventListener("click", () => {
      state.enhanceCharacter = button.dataset.character;
      const hero = state.party.find((member) => member.slot === state.enhanceCharacter);
      state.enhanceEquipmentSet = equipmentSetNumber(hero?.activeEquipmentSet);
      state.enhanceEquipmentSlot = null;
      state.enhanceSelectedAttribute = null;
      state.enhanceStoneKeys = { bless: null, curse: null, chaos: null };
      state.enhanceReturnStoneKey = null;
      state.enhanceOperation = null;
      renderEnhancePanel();
    });
  }
  for (const button of document.querySelectorAll("[data-enhance-set]")) {
    button.addEventListener("click", () => {
      state.enhanceEquipmentSet = equipmentSetNumber(button.dataset.enhanceSet);
      state.enhanceEquipmentSlot = null;
      state.enhanceSelectedAttribute = null;
      state.enhanceStoneKeys = { bless: null, curse: null, chaos: null };
      state.enhanceReturnStoneKey = null;
      state.enhanceOperation = null;
      renderEnhancePanel();
    });
  }
  for (const button of document.querySelectorAll("#enhance-equipment-grid [data-slot]")) {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.enhanceEquipmentSlot = button.dataset.slot;
      state.enhanceSelectedAttribute = null;
      state.enhanceStoneKeys = { bless: null, curse: null, chaos: null };
      state.enhanceReturnStoneKey = null;
      state.enhanceOperation = null;
      renderEnhancePanel();
    });
  }
  document.querySelectorAll("[data-enhance-stone-type]").forEach((select) => select.addEventListener("change", (event) => {
    state.enhanceStoneKeys[event.currentTarget.dataset.enhanceStoneType] = event.currentTarget.value;
    renderEnhancePanel();
  }));
  document.querySelectorAll("[data-enhance-type]").forEach((button) => button.addEventListener("click", () => {
    state.enhanceSelectedType = button.dataset.enhanceType;
    state.enhanceOperation = button.dataset.enhanceType;
    renderEnhancePanel();
  }));
  $("#enhance-return-stone").addEventListener("change", (event) => {
    state.enhanceReturnStoneKey = event.currentTarget.value;
    renderEnhancePanel();
  });
  $("#enhance-return-mode").addEventListener("click", () => {
    state.enhanceOperation = "return";
    renderEnhancePanel();
  });
  $("#enhance-return-confirm").addEventListener("click", () => {
    if (state.enhanceOperation !== "return") return;
    const hero = state.party.find((member) => member.slot === state.enhanceCharacter);
    const result = performEquipmentRollback(hero, state.enhanceEquipmentSlot, {
      stoneKey: state.enhanceReturnStoneKey,
      setNumber: state.enhanceEquipmentSet,
    });
    addLog(result.message);
    state.enhanceOperation = null;
    if (result.destroyed) state.enhanceEquipmentSlot = null;
    showEquipment(state.equipmentCharacter);
    render();
    renderEnhancePanel();
    persistPlayerSave();
  });
  $("#enhance-confirm").addEventListener("click", () => {
    const hero = state.party.find((member) => member.slot === state.enhanceCharacter);
    const equipped = hero ? equipmentConfig(hero, state.enhanceEquipmentSet)?.[state.enhanceEquipmentSlot] : null;
    const nextLevel = equipped ? normalizeEnhancement(equipped).level + 1 : 0;
    const operationAllowed = nextLevel <= 4 ? state.enhanceOperation === "safe" : state.enhanceOperation === state.enhanceSelectedType;
    if (!operationAllowed) return;
    const result = performEquipmentEnhancement(hero, state.enhanceEquipmentSlot, {
      attribute: state.enhanceSelectedAttribute,
      type: state.enhanceSelectedType,
      stoneKey: state.enhanceStoneKeys[state.enhanceSelectedType],
      setNumber: state.enhanceEquipmentSet,
    });
    addLog(result.message);
    const enhancedLevel = equipped ? normalizeEnhancement(equipped).level : 0;
    state.enhanceOperation = result.success && enhancedLevel < 4 ? "safe" : null;
    if (result.destroyed) state.enhanceEquipmentSlot = null;
    showEquipment(state.equipmentCharacter);
    render();
    renderEnhancePanel();
    persistPlayerSave();
  });
}

function maximumEnhanceLevel(itemLevel) {
  return Number(itemLevel) >= 80 ? 15 : Math.min(10, Math.floor(Number(itemLevel) / 10) + 5);
}

function equipmentEnhanceCost(item, instance) {
  const itemLevel = Number(item.item_level);
  const enhanceLevel = normalizeEnhancement(instance).level;
  return Math.max(0, Math.round(Number(systemSettings().base_enhance_cost) * (1 + itemLevel / 10) * (enhanceLevel + 1)));
}

function equipmentRollbackCost(item, instance) {
  const itemLevel = Number(item.item_level);
  const enhanceLevel = normalizeEnhancement(instance).level;
  return Math.max(0, Math.round(Number(systemSettings().base_enhance_cost) * (1 + itemLevel / 10) * enhanceLevel));
}

function enhancementRow(tableName, position) {
  return state.data[tableName].find((row) => row.position === position);
}

function safeEnhanceOptions(item) {
  const position = enhancementRow("enhanceSaveEnchant", item.EQ_position);
  const values = enhancementRow("enhanceSaveEnchant", "stability_range");
  return [...DERIVED_STAT_KEYS, ...ATTRIBUTE_KEYS]
    .filter((stat) => position?.[stat] === true)
    .map((stat) => ({ stat, value: Number(values?.[stat]) || 0 }));
}

function overEnhancePool(item) {
  const position = enhancementRow("enhanceOverEnchant", item.EQ_position);
  return [...DERIVED_STAT_KEYS, ...ATTRIBUTE_KEYS].filter((stat) => position?.[stat] === true);
}

function chaosEnhancePool(item) {
  const position = enhancementRow("enhanceChaosEnchant", item.EQ_position);
  return [...DERIVED_STAT_KEYS, ...ATTRIBUTE_KEYS].filter((stat) => position?.[stat] === true);
}

function enhancementStoneEntries(type = null) {
  const effectForType = { bless: "Bless_Enhance", curse: "Curse_Enhance", chaos: "Chaos_Enhance", return: "Return_Enhance" };
  return state.inventory.filter((entry) => {
    const item = state.data.item.find((candidate) => candidate.item_id === entry.itemId);
    return item?.item_id.startsWith("sp")
      && ["Bless_Enhance", "Curse_Enhance", "Chaos_Enhance", "Return_Enhance"].includes(item.effect)
      && (!type || item.effect === effectForType[type])
      && entry.quantity > 0;
  }).sort((left, right) => {
    const leftItem = state.data.item.find((candidate) => candidate.item_id === left.itemId);
    const rightItem = state.data.item.find((candidate) => candidate.item_id === right.itemId);
    const leftNumber = String(leftItem?.item_num ?? leftItem?.item_id ?? "");
    const rightNumber = String(rightItem?.item_num ?? rightItem?.item_id ?? "");
    return leftNumber.localeCompare(rightNumber, undefined, { numeric: true, sensitivity: "base" });
  });
}

function addEnhancementValues(target, values) {
  for (const [stat, value] of Object.entries(values)) {
    const total = Number(target[stat] ?? 0) + Number(value);
    target[stat] = ["HPR", "MPR", "CRI"].includes(stat) ? Math.round(total * 10) / 10 : total;
  }
}

function randomIntegerWith(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function rollEnhancementValue(stat, min, max, multiplier, random) {
  const scaledMin = Math.round(Number(min) * Number(multiplier) * 100) / 100;
  const scaledMax = Math.round(Number(max) * Number(multiplier) * 100) / 100;
  const raw = scaledMin + (scaledMax - scaledMin) * random();
  if (stat === "CRI") return Math.round(raw * 10) / 10;
  const scale = ["HPR", "MPR"].includes(stat) ? 10 : 1;
  return Math.ceil(raw * scale) / scale;
}

function formatEnhancementValue(stat, value) {
  const numeric = Number(value) || 0;
  return ["HPR", "MPR"].includes(stat) ? roundStat(numeric).toFixed(1) : formatExactNumber(numeric);
}

function inventoryButtonText(item) {
  if (!item) return "";
  if (item.isEquipment) return equipmentButtonText(catalogItem(item.itemId), item);
  return [...slotNameLines(item.name), `x ${item.quantity}`].join("\n");
}

function enhancementStoneDisplay(item) {
  const effectName = item?.effect === "Bless_Enhance"
    ? "祝福強化"
    : item?.effect === "Curse_Enhance" ? "詛咒強化"
      : item?.effect === "Chaos_Enhance" ? "混沌強化"
        : item?.effect === "Return_Enhance" ? "倒回強化" : null;
  if (!effectName) return null;
  const match = /^(Lv\.\d+)\s+(.+)$/.exec(String(item.item_name ?? "").trim());
  return {
    effectName,
    level: match?.[1] ?? `Lv.${Number(item.item_level) || 1}`,
    name: match?.[2] ?? item.item_name,
  };
}

function drawEnhancementStats(pool, count, random) {
  const available = [...pool];
  const selected = [];
  for (let index = 0; index < count; index++) {
    const chosen = Math.min(available.length - 1, Math.floor(random() * available.length));
    selected.push(available.splice(chosen, 1)[0]);
  }
  return selected;
}

function consumeInventoryEntry(entry) {
  const index = state.inventory.indexOf(entry);
  if (index < 0) return false;
  if (entry.quantity > 1) entry.quantity -= 1;
  else removeInventoryEntryAt(index);
  return true;
}

function performEquipmentEnhancement(hero, equipmentSlot, selection = {}, random = Math.random) {
  const setNumber = equipmentSetNumber(selection.setNumber ?? hero?.activeEquipmentSet);
  const equipment = hero ? equipmentConfig(hero, setNumber) : null;
  const equipped = equipment?.[equipmentSlot];
  const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
  if (!hero || !equipped || !item) return { success: false, message: "請先選擇仍然存在的裝備。" };
  const instance = normalizeEquipmentInstance(equipped);
  equipment[equipmentSlot] = instance;
  const enhancement = instance.enhancement;
  const nextLevel = enhancement.level + 1;
  const maximum = maximumEnhanceLevel(item.item_level);
  if (nextLevel > maximum) return {
    success: false,
    reason: "maximum_level",
    message: `Set ${setNumber} 的 ${equipmentDisplayName(item, instance)}（裝備等級 ${item.item_level}）強化上限為 +${maximum}；未消耗金幣或強化石。`,
  };
  const levelSetting = nextLevel >= 5 ? state.data.enhanceLevel.find((row) => row.enhance_level === nextLevel) : null;
  if (nextLevel >= 5 && (!levelSetting || !levelSetting.enabled)) return { success: false, message: `+${nextLevel} 尚未由 Enhance_level.csv 開放。` };
  const cost = equipmentEnhanceCost(item, instance);
  if (state.gold < cost) return { success: false, message: `金幣不足，需要 ${cost.toLocaleString()} 金幣。` };

  if (nextLevel <= 4) {
    const option = safeEnhanceOptions(item).find(({ stat }) => stat === selection.attribute);
    if (!option) return { success: false, message: "請選擇本次安全強化屬性。" };
    state.gold -= cost;
    enhancement.level = nextLevel;
    addEnhancementValues(enhancement.safeBonus, { [option.stat]: option.value });
    enhancement.history.push({ level: nextLevel, type: "safe", attribute: option.stat, value: option.value, cost });
    recalculateHeroStats(hero);
    return { success: true, destroyed: false, cost, message: `${item.item_name} 強化為 +${nextLevel}，${option.stat} +${formatEnhancementValue(option.stat, option.value)}，消耗 ${cost.toLocaleString()} 金幣。` };
  }

  const stoneEntry = enhancementStoneEntries(selection.type).find((entry) => entry.key === selection.stoneKey || entry.itemUuid === selection.stoneKey);
  const stone = stoneEntry ? state.data.item.find((candidate) => candidate.item_id === stoneEntry.itemId) : null;
  if (!stone) return { success: false, message: "請選擇背包中的祝福或詛咒強化石。" };
  const type = stone.effect === "Bless_Enhance" ? "bless" : stone.effect === "Curse_Enhance" ? "curse" : "chaos";
  const stoneBonus = randomIntegerWith(random, Number(stone.effect_value_min), Number(stone.effect_value_max));
  const actualSuccessRate = clamp(Number(levelSetting.success_rate) + stoneBonus, 0, 100);
  state.gold -= cost;
  consumeInventoryEntry(stoneEntry);
  if (random() * 100 >= actualSuccessRate) {
    delete equipment[equipmentSlot];
    recalculateHeroStats(hero);
    return {
      success: false, destroyed: true, cost, actualSuccessRate,
      message: `${equipmentDisplayName(item, instance)} 強化 +${nextLevel} 失敗並永久消失；消耗 ${cost.toLocaleString()} 金幣與 ${stone.item_name}。`,
    };
  }

  const drawCount = type === "chaos" ? chaosEnhancePool(item).length : Number(levelSetting[type === "bless" ? "bless_affixes" : "curse_affixes"]);
  const rangeTable = type === "chaos" ? "enhanceChaosEnchant" : "enhanceOverEnchant";
  const rangeMin = enhancementRow(rangeTable, `${type}_min`);
  const rangeMax = enhancementRow(rangeTable, `${type}_max`);
  const results = {};
  const pool = type === "chaos" ? chaosEnhancePool(item) : overEnhancePool(item);
  for (const stat of drawEnhancementStats(pool, drawCount, random)) {
    results[stat] = rollEnhancementValue(stat, Number(rangeMin[stat]), Number(rangeMax[stat]), levelSetting.enhance_buff, random);
  }
  enhancement.level = nextLevel;
  enhancement[`${type}Count`] += 1;
  addEnhancementValues(enhancement[`${type}Bonus`], results);
  enhancement.history.push({
    level: nextLevel, type, stone_item_id: stone.item_id, base_success_rate: levelSetting.success_rate,
    stone_bonus: stoneBonus, actual_success_rate: actualSuccessRate, cost, results,
  });
  recalculateHeroStats(hero);
  const resultText = Object.entries(results).map(([stat, value]) => `${stat} ${value >= 0 ? "+" : ""}${formatEnhancementValue(stat, value)}`).join("、");
  return {
    success: true, destroyed: false, cost, actualSuccessRate, results,
    message: `${item.item_name} 強化為 +${nextLevel}（${{ bless: "祝福", curse: "詛咒", chaos: "混沌" }[type]}）：${resultText}。`,
  };
}

function subtractEnhancementValues(target, values) {
  for (const [stat, value] of Object.entries(values ?? {})) {
    const total = Number(target[stat] ?? 0) - Number(value);
    const normalized = ["HPR", "MPR", "CRI"].includes(stat) ? Math.round(total * 10) / 10 : total;
    if (Math.abs(normalized) < 1e-9) delete target[stat];
    else target[stat] = normalized;
  }
}

function performEquipmentRollback(hero, equipmentSlot, selection = {}, random = Math.random) {
  const setNumber = equipmentSetNumber(selection.setNumber ?? hero?.activeEquipmentSet);
  const equipment = hero ? equipmentConfig(hero, setNumber) : null;
  const equipped = equipment?.[equipmentSlot];
  const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
  if (!hero || !equipped || !item) return { success: false, message: "請先選擇仍然存在的裝備。" };
  const instance = normalizeEquipmentInstance(equipped);
  equipment[equipmentSlot] = instance;
  const enhancement = instance.enhancement;
  const currentLevel = enhancement.level;
  if (currentLevel < 5) return { success: false, message: "裝備最低只能倒回至 +4。" };
  const lastEntryIndex = enhancement.history.reduce((found, entry, index) => Number(entry.level) === currentLevel ? index : found, -1);
  const lastEntry = enhancement.history[lastEntryIndex];
  if (!lastEntry) return { success: false, message: `找不到 +${currentLevel} 的強化紀錄，未執行倒回。` };
  const levelSetting = state.data.enhanceLevel.find((row) => row.enhance_level === currentLevel);
  if (!levelSetting?.enabled) return { success: false, message: `+${currentLevel} 尚未在 Enhance_level.csv 開放。` };
  const stoneEntry = enhancementStoneEntries("return").find((entry) => entry.key === selection.stoneKey || entry.itemUuid === selection.stoneKey);
  const stone = stoneEntry ? state.data.item.find((candidate) => candidate.item_id === stoneEntry.itemId) : null;
  if (!stone || stone.effect !== "Return_Enhance") return { success: false, message: "背包中沒有可用的倒回石。" };
  const cost = equipmentRollbackCost(item, instance);
  if (state.gold < cost) return { success: false, message: `金幣不足，需要 ${cost.toLocaleString()} 金幣。` };
  const stoneBonus = randomIntegerWith(random, Number(stone.effect_value_min), Number(stone.effect_value_max));
  const actualSuccessRate = clamp(Number(levelSetting.success_rate) + stoneBonus, 0, 100);
  state.gold -= cost;
  consumeInventoryEntry(stoneEntry);
  if (random() * 100 >= actualSuccessRate) {
    delete equipment[equipmentSlot];
    recalculateHeroStats(hero);
    return {
      success: false, destroyed: true, cost, actualSuccessRate,
      message: `${equipmentDisplayName(item, instance)} 倒回至 +${currentLevel - 1} 失敗並永久消失；消耗 ${cost.toLocaleString()} 金幣與 ${stone.item_name}。`,
    };
  }
  if (lastEntry.type === "safe") {
    subtractEnhancementValues(enhancement.safeBonus, { [lastEntry.attribute]: lastEntry.value });
  } else if (["bless", "curse", "chaos"].includes(lastEntry.type)) {
    subtractEnhancementValues(enhancement[`${lastEntry.type}Bonus`], lastEntry.results);
    enhancement[`${lastEntry.type}Count`] = Math.max(0, enhancement[`${lastEntry.type}Count`] - 1);
  } else {
    return { success: false, message: `無法辨識 +${currentLevel} 的強化類型，未執行倒回。` };
  }
  enhancement.history.splice(lastEntryIndex, 1);
  enhancement.level = currentLevel - 1;
  enhancement.returnCount += 1;
  recalculateHeroStats(hero);
  return {
    success: true, destroyed: false, cost, actualSuccessRate, removed: lastEntry,
    message: `${item.item_name} 已倒回至 +${enhancement.level}，最後一次${enhancementTypeLabel(lastEntry.type)}強化結果已移除。`,
  };
}

function renderEnhancePanelLegacy() {
  const hero = state.party.find((member) => member.slot === state.enhanceCharacter);
  if (!hero) return;
  document.querySelectorAll("#enhance-characters button").forEach((button) => button.classList.toggle("active", button.dataset.character === hero.slot));
  $("#enhance-class").textContent = hero.className;
  const selectedSet = equipmentSetNumber(state.enhanceEquipmentSet);
  document.querySelectorAll("[data-enhance-set]").forEach((button) => button.classList.toggle("active", Number(button.dataset.enhanceSet) === selectedSet));
  const selectedEquipment = equipmentConfig(hero, selectedSet);
  for (const button of document.querySelectorAll("#enhance-equipment-grid [data-slot]")) {
    const equipped = selectedEquipment[button.dataset.slot];
    const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
    button.disabled = !item;
    button.classList.toggle("equipped", Boolean(item));
    button.classList.remove("mirror-equipment");
    button.classList.toggle("selected", button.dataset.slot === state.enhanceEquipmentSlot && Boolean(item));
    button.textContent = item ? equipmentButtonText(item, equipped) : equipmentSlotLabel(button.dataset.position.split(",")[0]);
    applyEnhancementVisual(button, equipped, item);
    assignEquipmentTooltip(button, item, `Set ${selectedSet}；點擊選擇`, equipped);
    if (!item) button.title = "尚未裝備";
  }

  const equipped = selectedEquipment[state.enhanceEquipmentSlot];
  const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
  const options = $("#enhance-attribute-options");
  const stoneRow = $("#enhance-stone-row");
  const stoneSelect = $("#enhance-stone");
  const confirm = $("#enhance-confirm");
  options.replaceChildren();
  stoneSelect.replaceChildren();
  stoneRow.hidden = true;
  confirm.disabled = true;
  if (!item) {
    $("#enhance-item-name").textContent = "請選擇裝備";
    $("#enhance-summary").textContent = "點選左側已裝備的物品。";
    $("#enhance-message").textContent = "";
    confirm.textContent = "執行強化";
    return;
  }

  const enhancement = normalizeEnhancement(equipped);
  const nextLevel = enhancement.level + 1;
  const maximum = maximumEnhanceLevel(item.item_level);
  const cost = equipmentEnhanceCost(item, equipped);
  $("#enhance-item-name").textContent = equipmentDisplayName(item, equipped);
  $("#enhance-summary").textContent = `下一階 +${nextLevel}｜上限 +${maximum}\n費用 ${cost.toLocaleString()} 金幣｜持有 ${state.gold.toLocaleString()} 金幣`;
  if (nextLevel > maximum) {
    $("#enhance-message").textContent = `Set ${selectedSet}｜裝備等級 ${item.item_level} 的強化上限為 +${maximum}；不會讀取或消耗強化石。`;
    return;
  }
  if (nextLevel <= 4) {
    for (const option of safeEnhanceOptions(item)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${option.stat} +${formatEnhancementValue(option.stat, option.value)}`;
      button.classList.toggle("selected", state.enhanceSelectedAttribute === option.stat);
      button.addEventListener("click", () => { state.enhanceSelectedAttribute = option.stat; renderEnhancePanel(); });
      options.append(button);
    }
    $("#enhance-message").textContent = "安全強化成功率 100%，請選擇一項屬性。";
    confirm.disabled = !state.enhanceSelectedAttribute || state.gold < cost;
    confirm.textContent = `強化至 +${nextLevel}`;
    return;
  }

  const setting = state.data.enhanceLevel.find((row) => row.enhance_level === nextLevel);
  if (!setting || !setting.enabled) {
    $("#enhance-message").textContent = `+${nextLevel} 尚未開放。`;
    return;
  }
  const stones = enhancementStoneEntries();
  stoneRow.hidden = false;
  for (const entry of stones) {
    const stone = state.data.item.find((candidate) => candidate.item_id === entry.itemId);
    const option = document.createElement("option");
    option.value = entry.key;
    option.textContent = `${stone.item_name} × ${entry.quantity}`;
    stoneSelect.append(option);
  }
  if (!stones.some((entry) => entry.key === state.enhanceStoneKey)) state.enhanceStoneKey = stones[0]?.key ?? null;
  stoneSelect.value = state.enhanceStoneKey ?? "";
  $("#enhance-message").textContent = stones.length
    ? "失敗時裝備與強化石永久消失。"
    : "背包中沒有可用的祝福或詛咒強化石。";
  confirm.disabled = !state.enhanceStoneKey || state.gold < cost;
  confirm.textContent = `嘗試強化至 +${nextLevel}`;
}

function enhancementTypeLabel(type) {
  return { safe: "安全", bless: "祝福", curse: "詛咒", chaos: "混沌" }[type] ?? type;
}

function renderEnhancementHistory(enhancement = emptyEnhancement()) {
  const safeContainer = $("#enhance-safe-history");
  const overContainer = $("#enhance-over-history");
  safeContainer.replaceChildren();
  overContainer.replaceChildren();
  const currentLevel = Math.max(0, Number(enhancement.level) || 0);
  for (let level = 1; level <= Math.min(4, currentLevel); level++) {
    const entry = enhancement.history.find((row) => Number(row.level) === level);
    const cell = document.createElement("div");
    cell.textContent = entry?.attribute ? `${entry.attribute}+${formatEnhancementValue(entry.attribute, entry.value)}` : "—";
    safeContainer.append(cell);
  }
  for (let level = 5; level <= currentLevel; level++) {
    const entry = enhancement.history.find((row) => Number(row.level) === level);
    const row = document.createElement("div");
    row.className = "enhance-history-row";
    const heading = document.createElement("strong");
    heading.textContent = entry ? `[${enhancementTypeLabel(entry.type)}]+${level}` : `+${level}`;
    row.append(heading);
    const results = document.createElement("div");
    results.className = "enhance-history-results";
    if (entry?.results) {
      for (const [stat, amount] of Object.entries(entry.results)) {
        const value = Number(amount) || 0;
        const result = document.createElement("span");
        result.textContent = `${stat} ${value >= 0 ? "+" : ""}${formatEnhancementValue(stat, value)}`;
        result.style.color = indexedColor(value > 0 ? "left_enhance_positive_name" : value < 0 ? "left_enhance_negative_name" : "left_enhance_unchange_name");
        results.append(result);
      }
    } else {
      const empty = document.createElement("span");
      empty.textContent = "—";
      results.append(empty);
    }
    row.append(results);
    overContainer.append(row);
  }
}

// The current enhancement view keeps controls compact and dedicates the third column to persisted history.
function renderEnhancePanel() {
  const hero = state.party.find((member) => member.slot === state.enhanceCharacter);
  if (!hero) return;
  document.querySelectorAll("#enhance-characters button").forEach((button) => button.classList.toggle("active", button.dataset.character === hero.slot));
  $("#enhance-class").textContent = hero.className;
  $("#enhance-owned-gold").textContent = `持有 ${state.gold.toLocaleString()} 金幣`;
  const selectedSet = equipmentSetNumber(state.enhanceEquipmentSet);
  document.querySelectorAll("[data-enhance-set]").forEach((button) => button.classList.toggle("active", Number(button.dataset.enhanceSet) === selectedSet));
  const equipment = equipmentConfig(hero, selectedSet);
  for (const button of document.querySelectorAll("#enhance-equipment-grid [data-slot]")) {
    const equipped = equipment[button.dataset.slot];
    const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
    button.disabled = !item;
    button.classList.toggle("equipped", Boolean(item));
    button.classList.remove("mirror-equipment");
    button.classList.toggle("selected", button.dataset.slot === state.enhanceEquipmentSlot && Boolean(item));
    button.textContent = item ? equipmentButtonText(item, equipped) : equipmentSlotLabel(button.dataset.position.split(",")[0]);
    applyEnhancementVisual(button, equipped, item);
    assignEquipmentTooltip(button, item, `Set ${selectedSet}：點選後強化`, equipped);
  }

  const equipped = equipment[state.enhanceEquipmentSlot];
  const item = equipped ? state.data.equipment.find((candidate) => candidate.item_id === equipped.itemId) : null;
  const options = $("#enhance-attribute-options");
  const specialControls = $("#enhance-special-controls");
  const returnControls = $("#enhance-return-controls");
  const returnSelect = $("#enhance-return-stone");
  const returnMode = $("#enhance-return-mode");
  const returnConfirm = $("#enhance-return-confirm");
  const confirm = $("#enhance-confirm");
  options.replaceChildren();
  specialControls.hidden = true;
  returnControls.hidden = true;
  confirm.disabled = true;
  renderEnhancementHistory(item ? normalizeEnhancement(equipped) : emptyEnhancement());
  if (!item) {
    $("#enhance-item-name").textContent = "請選擇裝備";
    $("#enhance-cost-summary").textContent = "請先選擇裝備";
    $("#enhance-message").textContent = "";
    return;
  }

  const enhancement = normalizeEnhancement(equipped);
  const nextLevel = enhancement.level + 1;
  const maximum = maximumEnhanceLevel(item.item_level);
  const cost = equipmentEnhanceCost(item, equipped);
  $("#enhance-item-name").textContent = equipmentDisplayName(item, equipped);
  $("#enhance-cost-summary").textContent = `下一階 +${nextLevel}｜費用 ${cost.toLocaleString()} 金幣｜上限 +${maximum}`;
  confirm.textContent = `強化至 +${nextLevel}`;
  const returnStones = enhancementStoneEntries("return");
  if (returnStones.length) {
    returnControls.hidden = false;
    returnSelect.replaceChildren(...returnStones.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.key;
      option.textContent = `${catalogItem(entry.itemId).item_name} × ${entry.quantity}`;
      return option;
    }));
    if (!returnStones.some((entry) => entry.key === state.enhanceReturnStoneKey)) state.enhanceReturnStoneKey = returnStones[0]?.key ?? null;
    returnSelect.value = state.enhanceReturnStoneKey ?? "";
    returnMode.classList.toggle("selected", state.enhanceOperation === "return");
    returnConfirm.textContent = `倒回至 +${Math.max(4, enhancement.level - 1)}`;
    returnSelect.disabled = enhancement.level < 5;
    returnMode.disabled = enhancement.level < 5;
    returnConfirm.disabled = state.enhanceOperation !== "return" || enhancement.level < 5 || !state.enhanceReturnStoneKey || state.gold < equipmentRollbackCost(item, equipped);
  }
  if (nextLevel > maximum) {
    $("#enhance-message").textContent = `此裝備目前上限為 +${maximum}。`;
    return;
  }
  if (nextLevel <= 4) {
    for (const option of safeEnhanceOptions(item)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${option.stat} +${formatEnhancementValue(option.stat, option.value)}`;
      button.classList.toggle("selected", state.enhanceSelectedAttribute === option.stat);
      button.addEventListener("click", () => { state.enhanceSelectedAttribute = option.stat; state.enhanceOperation = "safe"; renderEnhancePanel(); });
      options.append(button);
    }
    $("#enhance-message").textContent = "安全強化成功率 100%。";
    confirm.disabled = state.enhanceOperation !== "safe" || !state.enhanceSelectedAttribute || state.gold < cost;
    return;
  }

  const setting = state.data.enhanceLevel.find((row) => row.enhance_level === nextLevel);
  if (!setting?.enabled) {
    $("#enhance-message").textContent = `+${nextLevel} 尚未在 Enhance_level.csv 開放。`;
    return;
  }
  specialControls.hidden = false;
  for (const type of ["bless", "curse", "chaos"]) {
    const select = $(`#enhance-stone-${type}`);
    const stones = enhancementStoneEntries(type);
    select.replaceChildren(...stones.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.key;
      option.textContent = `${catalogItem(entry.itemId).item_name} × ${entry.quantity}`;
      return option;
    }));
    if (!stones.some((entry) => entry.key === state.enhanceStoneKeys[type])) state.enhanceStoneKeys[type] = stones[0]?.key ?? null;
    select.value = state.enhanceStoneKeys[type] ?? "";
  }
  document.querySelectorAll("[data-enhance-type]").forEach((button) => button.classList.toggle("selected", state.enhanceOperation === button.dataset.enhanceType));
  const selectedStone = state.enhanceStoneKeys[state.enhanceSelectedType];
  $("#enhance-message").textContent = selectedStone ? "失敗時裝備與強化石永久消失。" : `沒有可用的${enhancementTypeLabel(state.enhanceSelectedType)}石。`;
  confirm.disabled = state.enhanceOperation !== state.enhanceSelectedType || !selectedStone || state.gold < cost;
}

function hasValidItemCooldown(item) {
  return item?.cooldown !== null && item?.cooldown !== undefined && Number.isFinite(Number(item.cooldown)) && Number(item.cooldown) >= 0;
}

function renderRecoveryPanel() {
  const missingCooldown = state.data.item.filter((item) => ["HPrecover", "MPrecover"].includes(item.effect) && !hasValidItemCooldown(item));
  $("#recovery-warning").textContent = missingCooldown.length
    ? `item.csv 尚未提供 cooldown 欄位：${missingCooldown.map((item) => item.item_name).join("、")}的自動與手動使用目前暫停。`
    : "";
  const container = $("#recovery-settings"); container.replaceChildren();
  for (const hero of state.roster) {
    const row = document.createElement("div"); row.className = "recovery-row";
    const identity = document.createElement("label"); identity.className = "recovery-identity";
    const className = document.createElement("strong"); className.textContent = hero.className;
    const name = document.createElement("input"); name.type = "text"; name.maxLength = 20;
    name.value = hero.customName ?? "";
    name.placeholder = `${hero.className}的名稱`;
    name.setAttribute("aria-label", `${hero.className}角色名稱，最多20個字`);
    name.addEventListener("input", () => {
      const limited = normalizeCharacterName(name.value);
      name.value = limited;
      hero.customName = limited;
      hero.name = limited || hero.className;
      render();
      if ($("#character-info-dialog")?.open) renderCharacterInfoPanel();
    });
    name.addEventListener("change", () => {
      name.value = setCharacterName(hero, name.value);
    });
    identity.append(className, name);
    const hp = createRecoveryControl(hero, "hp", "HP");
    const mp = createRecoveryControl(hero, "mp", "MP");
    const reset = document.createElement("button"); reset.type = "button";
    const remaining = Math.max(0, Math.ceil((hero.resetAvailableAt - Date.now()) / 1000));
    reset.disabled = remaining > 0;
    reset.textContent = remaining > 0 ? `冷卻 ${remaining} 秒` : "重置職業";
    reset.addEventListener("click", () => {
      if (!window.confirm(`確定重置${hero.name}？等級、屬性、技能與裝備會回到 classes.csv 初始狀態。`)) return;
      resetHero(hero.classId);
    });
    row.append(identity, hp, mp, reset); container.append(row);
  }
}

function createRecoveryControl(hero, key, label) {
  const wrapper = document.createElement("label"); wrapper.className = "recovery-auto-control";
  const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = hero.recoverySettings[`${key}Enabled`] !== false;
  enabled.setAttribute("aria-label", `${hero.className} 自動${label}`);
  enabled.addEventListener("change", () => { hero.recoverySettings[`${key}Enabled`] = enabled.checked; persistPlayerSave(); });
  const text = document.createElement("span"); text.textContent = `自動${label}`;
  const percent = document.createElement("input"); percent.type = "number"; percent.min = "1"; percent.max = "100"; percent.step = "1";
  percent.value = hero.recoverySettings[`${key}Percent`]; percent.setAttribute("aria-label", `${hero.className} ${label} 自動使用百分比`);
  percent.addEventListener("change", () => {
    hero.recoverySettings[`${key}Percent`] = clamp(Number(percent.value) || 20, 1, 100);
    percent.value = hero.recoverySettings[`${key}Percent`];
    persistPlayerSave();
  });
  const suffix = document.createElement("span"); suffix.textContent = "%";
  const effect = key === "hp" ? "HPrecover" : "MPrecover";
  const ownedIds = new Set(state.inventory.filter((entry) => !entry.isEquipment && Number(entry.quantity ?? 1) > 0).map((entry) => entry.itemId));
  const available = state.data.item.filter((item) => item.effect === effect && ownedIds.has(item.item_id));
  const itemSettingKey = `${key}ItemId`;
  if (!available.some((item) => item.item_id === hero.recoverySettings[itemSettingKey])) {
    hero.recoverySettings[itemSettingKey] = available[0]?.item_id ?? null;
  }
  const select = document.createElement("select");
  select.setAttribute("aria-label", `${hero.className} 自動${label}藥水`);
  if (!available.length) {
    const option = document.createElement("option"); option.value = ""; option.textContent = "沒有可用藥水"; select.append(option); select.disabled = true;
  } else {
    for (const item of available) {
      const quantity = state.inventory.filter((entry) => entry.itemId === item.item_id).reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0);
      const option = document.createElement("option"); option.value = item.item_id; option.textContent = `${item.item_name} × ${quantity}`; select.append(option);
    }
    select.value = hero.recoverySettings[itemSettingKey];
    select.addEventListener("change", () => { hero.recoverySettings[itemSettingKey] = select.value || null; persistPlayerSave(); });
  }
  wrapper.append(enabled, text, percent, suffix, select);
  return wrapper;
}

function resetHero(classId, now = Date.now()) {
  const hero = state.roster.find((member) => member.classId === classId);
  const cls = state.data.classes.find((row) => row.class_id === classId);
  if (!hero || !cls || now < hero.resetAvailableAt) return false;
  for (const equipmentSet of Object.values(hero.equipmentSets)) {
    for (const equipped of Object.values(equipmentSet)) returnEquippedItemToInventory(equipped);
  }
  hero.level = 1; hero.exp = 0;
  hero.attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, cls[key] ?? 0]));
  hero.levelPlan = defaultLevelPlan(hero.attributes);
  hero.growthStats = Object.fromEntries(DERIVED_STAT_KEYS.map((key) => [key, 0]));
  initializeEquipmentSets(hero);
  state.equipmentEditSets[hero.classId] = 1;
  hero.learnedSkillIds = new Set(); hero.skillEnabled = {}; hero.skillCooldowns = {}; hero.itemCooldowns = {};
  hero.skillSettings = {};
  hero.cooldown = 0; hero.casting = null; hero.buffs = [];
  assignInitialEquipment(hero, cls); recalculateHeroStats(hero, true); grantBuiltInSkills(hero); grantInitialItemForHero(hero);
  hero.resetAvailableAt = now + 60000;
  addLog(`${hero.name} 已重置為 classes.csv 初始狀態，並重新取得初始裝備與道具。`);
  updateMapLocks(); updateCharacterControls(); showEquipment(state.equipmentCharacter); render(); renderRecoveryPanel(); persistPlayerSave();
  return true;
}

function skillIdOrder(skill) {
  const match = String(skill.skill_id ?? "").match(/^csk(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function classSkills(hero) {
  return state.data.characterSkills.filter((skill) => skill.class_id === hero.classId)
    .sort((a, b) => skillIdOrder(a) - skillIdOrder(b) || String(a.skill_id).localeCompare(String(b.skill_id)));
}

function grantBuiltInSkills(hero) {
  for (const skill of state.data.characterSkills.filter((row) => row.class_id === hero.classId && row.is_book === false)) {
    hero.learnedSkillIds.add(skill.skill_id);
    if (!(skill.skill_id in hero.skillEnabled)) hero.skillEnabled[skill.skill_id] = Boolean(skill.enabled);
    hero.skillCooldowns[skill.skill_id] ??= 0;
    ensureSkillSetting(hero, skill);
  }
}

function learnSkill(hero, skillId) {
  const skill = state.data.characterSkills.find((row) => row.skill_id === skillId && row.class_id === hero.classId);
  if (!skill || hero.level < skill.level) return false;
  hero.learnedSkillIds.add(skillId);
  if (!(skillId in hero.skillEnabled)) hero.skillEnabled[skillId] = Boolean(skill.enabled);
  hero.skillCooldowns[skillId] ??= 0;
  ensureSkillSetting(hero, skill);
  return true;
}

function ensureSkillSetting(hero, skill) {
  const current = hero.skillSettings[skill.skill_id] ?? (hero.skillSettings[skill.skill_id] = {});
  const legacyTriggerValue = current.triggerValue;
  const defaultTrigger = skill.damage_type === "heal" ? 30 : (skill.trigger_value ?? 100);
  current.triggerValue = normalizedTriggerPercentage(current.triggerValue, defaultTrigger);
  current.triggerHpValue = normalizedTriggerPercentage(current.triggerHpValue, legacyTriggerValue ?? skill.trigger_value ?? 50);
  current.triggerMpValue = normalizedTriggerPercentage(current.triggerMpValue, legacyTriggerValue ?? skill.trigger_value ?? 50);
  current.minTargets = clamp(Math.trunc(Number(current.minTargets ?? skill.min_targets ?? 1) || 1), 1, 3);
  current.mpThreshold = Math.max(0, Number(current.mpThreshold) || 0);
  current.enemyCountThreshold = clamp(Math.trunc(Number(current.enemyCountThreshold ?? 1) || 1), 1, 3);
  return current;
}

function normalizedTriggerPercentage(value, fallback) {
  const parsed = Number(value);
  const fallbackParsed = Number(fallback);
  return clamp(Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackParsed) ? fallbackParsed : 50), 0, 100);
}

const PLAYER_TRIGGER_PATTERN = /^(ally|enemy)_(hp|mp)_(below|above)$/i;
const SELF_DUAL_TRIGGER_PATTERN = /^self_hp_(below|above)_mp_(below|above)$/i;

function effectivePlayerTriggerType(skill) {
  return String(skill.trigger_type ?? (skill.damage_type === "heal" ? "ally_hp_below" : "")).trim().toLowerCase();
}

function triggerComparisonMatches(ratio, comparison, threshold) {
  return comparison === "above" ? ratio >= threshold : ratio <= threshold;
}

function renderSkillPanel() {
  const hero = state.party.find((member) => member.slot === state.skillCharacter);
  const titleHelp = $("#skill-title-help");
  if (titleHelp) titleHelp.style.color = indexedColor("mid_skill_help");
  document.querySelectorAll("#skill-characters button").forEach((button) => button.classList.toggle("active", button.dataset.character === hero.slot));
  const list = $("#skill-list"); list.replaceChildren();
  for (const skill of classSkills(hero)) {
    const learned = hero.learnedSkillIds.has(skill.skill_id);
    list.append(createSkillRow(skill, learned, hero.skillEnabled[skill.skill_id] ?? Boolean(skill.enabled), hero));
  }
}

function createSkillRow(skill, learned, enabled, hero = null) {
  const row = document.createElement("label"); row.className = `skill-row${learned ? "" : " locked"}${hero ? "" : " normal"}`;
  const input = document.createElement("input"); input.type = "checkbox"; input.checked = learned && enabled; input.disabled = !hero || !learned || hero.level < skill.level;
  const copy = document.createElement("span"); copy.className = "skill-copy";
  const mainline = document.createElement("span"); mainline.className = "skill-mainline";
  const name = document.createElement("strong"); name.textContent = skill.name;
  const detail = document.createElement("small"); detail.className = "skill-detail";
  const priority = document.createElement("span"); priority.className = "skill-priority"; priority.textContent = `優先度 ${skill.use_priority}`;
  const mp = document.createElement("span"); mp.className = "skill-emphasis"; mp.textContent = `MP ${skill.cost}`;
  const cooldown = document.createElement("span"); cooldown.className = "skill-emphasis"; cooldown.textContent = `冷卻 ${skill.cooldown}s`;
  detail.append(priority, mp, cooldown);
  if (skill.cast_time) {
    const cast = document.createElement("span"); cast.className = "skill-emphasis"; cast.textContent = `施法 ${skill.cast_time}s`; detail.append(cast);
  }
  if (learned && String(skill.skill_intro ?? "").trim()) {
    const intro = document.createElement("span");
    intro.className = "skill-intro";
    intro.textContent = String(skill.skill_intro).trim();
    intro.style.color = indexedColor("skill_intro_color");
    detail.append(intro);
  }
  mainline.append(name);
  if (hero) {
    const setting = ensureSkillSetting(hero, skill);
    const mpControls = document.createElement("span"); mpControls.className = "skill-mp-controls";
    const mpLabel = document.createElement("label"); mpLabel.textContent = "施放MP >";
    const mpInput = document.createElement("input"); mpInput.type = "number"; mpInput.min = "0"; mpInput.step = "1"; mpInput.value = setting.mpThreshold;
    mpInput.setAttribute("aria-label", `${skill.name} 施放 MP 門檻`);
    mpInput.addEventListener("change", () => {
      setting.mpThreshold = Math.max(0, Number(mpInput.value) || 0);
      mpInput.value = setting.mpThreshold;
      persistPlayerSave();
    });
    mpLabel.append(mpInput); mpControls.append(mpLabel); mainline.append(mpControls);
  }
  if (hero && ["aoe", "enemy_aoe", "ALLaoe"].includes(skill.damage_target)) {
    const setting = ensureSkillSetting(hero, skill);
    const controls = document.createElement("span"); controls.className = "skill-trigger-controls skill-monster-count-controls";
    const separator = document.createElement("span"); separator.className = "skill-separator"; separator.textContent = "|";
    const countLabel = document.createElement("label"); countLabel.textContent = "敵方人數 ≥";
    const countInput = document.createElement("input"); countInput.type = "number"; countInput.min = "1"; countInput.max = "3"; countInput.step = "1"; countInput.value = setting.enemyCountThreshold;
    countInput.setAttribute("aria-label", `${skill.name} 敵方隊伍人數門檻`);
    countInput.addEventListener("change", () => {
      setting.enemyCountThreshold = clamp(Math.trunc(Number(countInput.value) || 1), 1, 3);
      countInput.value = setting.enemyCountThreshold;
      persistPlayerSave();
    });
    countLabel.append(countInput, "人"); controls.append(separator, countLabel); mainline.append(controls);
  }
  const playerTriggerType = effectivePlayerTriggerType(skill);
  const standardTrigger = playerTriggerType.match(PLAYER_TRIGGER_PATTERN);
  const selfDualTrigger = playerTriggerType.match(SELF_DUAL_TRIGGER_PATTERN);
  if (hero && standardTrigger) {
    const setting = ensureSkillSetting(hero, skill);
    const [, relation, resourceText, comparison] = standardTrigger;
    const resource = resourceText.toUpperCase();
    const relationLabel = relation === "enemy" ? "敵方" : "我方";
    const comparisonLabel = comparison === "above" ? "≥" : "≤";
    const controls = document.createElement("span"); controls.className = `skill-trigger-controls ${resource === "MP" ? "skill-mp-trigger-controls" : "skill-hp-controls"}`;
    const separator = document.createElement("span"); separator.className = "skill-separator"; separator.textContent = "|";
    controls.append(separator);
    const hpLabel = document.createElement("label"); hpLabel.textContent = `${relationLabel}${resource}${comparisonLabel}`;
    const hpInput = document.createElement("input"); hpInput.type = "number"; hpInput.min = "0"; hpInput.max = "100"; hpInput.step = "1"; hpInput.value = setting.triggerValue;
    hpInput.setAttribute("aria-label", `${skill.name} ${resource} 觸發百分比`);
    hpInput.addEventListener("change", () => { setting.triggerValue = normalizedTriggerPercentage(hpInput.value, setting.triggerValue); hpInput.value = setting.triggerValue; persistPlayerSave(); });
    hpLabel.append(hpInput, "%"); controls.append(hpLabel);
    const countSeparator = document.createElement("span"); countSeparator.className = "skill-separator"; countSeparator.textContent = "|";
    const countLabel = document.createElement("label"); countLabel.textContent = "人數≥";
    const countInput = document.createElement("input"); countInput.type = "number"; countInput.min = "1"; countInput.max = "3"; countInput.step = "1"; countInput.value = setting.minTargets;
    countInput.setAttribute("aria-label", `${skill.name} 最少觸發人數`);
    countInput.addEventListener("change", () => { setting.minTargets = clamp(Math.trunc(Number(countInput.value) || 1), 1, 3); countInput.value = setting.minTargets; persistPlayerSave(); });
    countLabel.append(countInput); controls.append(countSeparator, countLabel);
    mainline.append(controls);
  } else if (hero && selfDualTrigger) {
    const setting = ensureSkillSetting(hero, skill);
    const [, hpComparison, mpComparison] = selfDualTrigger;
    const controls = document.createElement("span"); controls.className = "skill-trigger-controls skill-self-trigger-controls";
    const separator = document.createElement("span"); separator.className = "skill-separator"; separator.textContent = "|";
    controls.append(separator);
    for (const [resource, comparison, settingKey] of [["HP", hpComparison, "triggerHpValue"], ["MP", mpComparison, "triggerMpValue"]]) {
      const label = document.createElement("label"); label.textContent = `自身${resource}${comparison === "above" ? "≥" : "≤"}`;
      const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "100"; input.step = "1"; input.value = setting[settingKey];
      input.setAttribute("aria-label", `${skill.name} 自身 ${resource} 觸發百分比`);
      input.addEventListener("change", () => { setting[settingKey] = normalizedTriggerPercentage(input.value, setting[settingKey]); input.value = setting[settingKey]; persistPlayerSave(); });
      label.append(input, "%"); controls.append(label);
    }
    mainline.append(controls);
  }
  copy.append(mainline, detail);
  const status = document.createElement("span"); status.className = "skill-state";
  if (!hero) status.textContent = "固定啟用";
  else if (!learned) status.textContent = `未學習（需求 Lv.${skill.level}）`;
  else status.textContent = enabled ? "已啟用" : "已停用";
  if (hero) input.addEventListener("change", () => { hero.skillEnabled[skill.skill_id] = input.checked; status.textContent = input.checked ? "已啟用" : "已停用"; });
  row.append(input, copy, status); return row;
}

function grantInitialItems() {
  for (const hero of state.roster) grantInitialItemForHero(hero);
}

function catalogItem(itemId) {
  return state.data.item.find((item) => item.item_id === itemId)
    ?? state.data.equipment.find((item) => item.item_id === itemId);
}

function grantInitialItemForHero(hero) {
  const cls = state.data.classes.find((row) => row.class_id === hero.classId);
  if (!cls?.initial_item || !cls.initial_item_value) return;
  const source = catalogItem(cls.initial_item);
  addInventoryItem(cls.initial_item, source?.item_name ?? cls.initial_item, cls.initial_item_value);
}

function setupRightPanel() {
  for (const button of document.querySelectorAll("[data-right-page]")) {
    button.addEventListener("click", () => {
      state.rightPage = button.dataset.rightPage;
      document.querySelectorAll("[data-right-page]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      $("#right-battle-page").hidden = state.rightPage !== "battle";
      $("#right-shop-page").hidden = state.rightPage !== "shop";
      $("#right-warehouse-page").hidden = state.rightPage !== "warehouse";
      if (state.rightPage === "shop") renderShop();
      if (state.rightPage === "warehouse") requestAnimationFrame(() => { recalculateBigStorageLayout(); renderWarehouse(); });
    });
  }
  for (const button of document.querySelectorAll("[data-log-channel]")) {
    button.addEventListener("click", () => {
      state.battleLogChannel = button.dataset.logChannel;
      document.querySelectorAll("[data-log-channel]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      document.querySelectorAll("[data-log-panel]").forEach((panel) => { panel.hidden = panel.dataset.logPanel !== state.battleLogChannel; });
    });
  }
}

function setupWarehouse() {
  for (const button of document.querySelectorAll("[data-warehouse-mode]")) {
    button.addEventListener("click", () => {
      state.warehouseMode = button.dataset.warehouseMode;
      document.querySelectorAll("[data-warehouse-mode]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      renderWarehouse();
    });
  }
  setupTransferQuantityDialog();
  setupCollectionDialog();
  setupPortableGridDelegation($("#big-storage-grid"), (visibleIndex) => useBigStorageCell(visibleIndex));
  setupCollectionEquipmentDelegation($("#collection-equipment-grid"));
  setupPortableGridDelegation($("#collection-inventory-grid"), (visibleIndex) => moveEquipmentToCollection("inventory", state.collectionInventoryPage * state.collectionInventoryCapacity + visibleIndex));
  setupPortableGridDelegation($("#collection-storage-grid"), (visibleIndex) => moveEquipmentToCollection("storage", state.collectionStoragePage * state.collectionStorageCapacity + visibleIndex));
  const recalculate = () => { if (state.rightPage === "warehouse") recalculateBigStorageLayout(); if ($("#collection-dialog")?.open) recalculateCollectionLayouts(); };
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(recalculate);
    observer.observe($("#right-warehouse-page"));
    observer.observe($("#collection-dialog"));
  } else window.addEventListener("resize", recalculate);
  renderWarehouse();
}

function portableEntryAt(entries, indexKey, index) { return entries.find((entry) => entry[indexKey] === index) ?? null; }

function compactBigStorage() {
  state.bigStorage = state.bigStorage.slice(0, BIG_STORAGE_MAX_SLOTS).map((entry, storageIndex) => { entry.storageIndex = storageIndex; return entry; });
  state.bigStoragePage = clamp(state.bigStoragePage, 0, Math.max(0, Math.ceil(BIG_STORAGE_MAX_SLOTS / Math.max(1, state.bigStoragePageCapacity)) - 1));
  return state.bigStorage;
}

function firstFreeBigStorageIndex() { return state.bigStorage.length < BIG_STORAGE_MAX_SLOTS ? state.bigStorage.length : -1; }

function floatingGridMetrics(grid, headerHeight = 0) {
  const styles = getComputedStyle(grid);
  const width = Math.max(INVENTORY_SLOT_SIZE, grid.clientWidth - parseFloat(styles.paddingLeft || 0) - parseFloat(styles.paddingRight || 0));
  const height = Math.max(INVENTORY_SLOT_SIZE, grid.clientHeight - parseFloat(styles.paddingTop || 0) - parseFloat(styles.paddingBottom || 0) - headerHeight);
  const columns = Math.max(1, Math.floor((width + INVENTORY_SLOT_GAP) / (INVENTORY_SLOT_SIZE + INVENTORY_SLOT_GAP)));
  const rows = Math.max(1, Math.floor((height + INVENTORY_SLOT_GAP) / (INVENTORY_SLOT_SIZE + INVENTORY_SLOT_GAP)));
  return { columns, rows, capacity: Math.max(1, columns * rows) };
}

function applyGridMetrics(grid, metrics) {
  grid.style.setProperty("--inventory-columns", metrics.columns);
  grid.style.setProperty("--inventory-rows", metrics.rows);
}

function rebuildPortableGrid(grid, capacity) {
  if (!grid || grid.children.length === capacity) return;
  grid.replaceChildren(...Array.from({ length: capacity }, (_, visibleIndex) => {
    const button = document.createElement("button"); button.type = "button"; button.disabled = true;
    button.dataset.visibleIndex = String(visibleIndex);
    return button;
  }));
}

function setupPortableGridDelegation(grid, handler) {
  if (!grid || grid.dataset.delegatedClick === "true") return;
  grid.dataset.delegatedClick = "true";
  grid.addEventListener("click", (event) => {
    const button = delegatedButtonFromEvent(event, grid, "button[data-visible-index]");
    if (!button || button.disabled || !grid.contains(button)) return;
    handler(Number(button.dataset.visibleIndex));
  });
}

function setupCollectionEquipmentDelegation(grid) {
  if (!grid || grid.dataset.delegatedClick === "true") return;
  grid.dataset.delegatedClick = "true";
  grid.addEventListener("click", (event) => {
    const button = delegatedButtonFromEvent(event, grid, "button[data-collection-slot]");
    if (!button || button.disabled || !grid.contains(button)) return;
    removeCollectionEquipment(button.dataset.collectionSlot);
  });
}

function delegatedButtonFromEvent(event, container, selector) {
  const pathMatch = typeof event.composedPath === "function"
    ? event.composedPath().find((node) => node?.matches?.(selector))
    : null;
  const targetMatch = event.target?.closest?.(selector);
  const button = pathMatch ?? targetMatch;
  return button && container.contains(button) ? button : null;
}

function renderPortableEntryCell(cell, entry, emptyLabel = "空白格") {
  const item = entry ? catalogItem(entry.itemId) : null;
  cell.textContent = entry ? inventoryButtonText(entry) : "";
  applyEnhancementVisual(cell, entry?.isEquipment ? entry : null, item);
  if (entry?.isEquipment) assignEquipmentTooltip(cell, item, "點擊移動", entry);
  else { assignEquipmentTooltip(cell, null, "", null); cell.title = entry ? `${itemTooltip(item)}\n數量 ${entry.quantity}` : ""; }
  cell.disabled = !entry;
  cell.setAttribute("aria-label", entry ? `移動 ${entry.name}` : emptyLabel);
}

function renderGenericPagination(container, totalSlots, capacity, currentPage, onSelect) {
  if (!container) return;
  const count = Math.max(1, Math.ceil(totalSlots / Math.max(1, capacity)));
  const page = clamp(currentPage, 0, count - 1);
  const start = Math.floor(page / INVENTORY_MAX_PAGE_BUTTONS) * INVENTORY_MAX_PAGE_BUTTONS;
  const end = Math.min(count, start + INVENTORY_MAX_PAGE_BUTTONS);
  container._selectPage = onSelect;
  if (container.dataset.delegatedClick !== "true") {
    container.dataset.delegatedClick = "true";
    container.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page-target]");
      if (!button || button.disabled || !container.contains(button)) return;
      container._selectPage?.(Number(button.dataset.pageTarget));
    });
  }
  const descriptors = [{ text: "‹", target: Math.max(0, start - 1), disabled: start === 0, active: false }];
  for (let index = start; index < end; index++) descriptors.push({ text: String(index + 1), target: index, disabled: false, active: index === page });
  descriptors.push({ text: "›", target: Math.min(count - 1, end), disabled: end >= count, active: false });
  const structureKey = descriptors.map(({ text, target }) => `${text}:${target}`).join("|");
  if (container.dataset.structureKey !== structureKey) {
    container.dataset.structureKey = structureKey;
    container.replaceChildren(...descriptors.map(() => { const button = document.createElement("button"); button.type = "button"; return button; }));
  }
  [...container.children].forEach((button, index) => {
    const descriptor = descriptors[index];
    button.textContent = descriptor.text;
    button.dataset.pageTarget = String(descriptor.target);
    button.disabled = descriptor.disabled;
    button.classList.toggle("active", descriptor.active);
  });
}

function recalculateBigStorageLayout() {
  const grid = $("#big-storage-grid");
  if (!grid || grid.clientWidth <= 0) return;
  const oldCapacity = Math.max(1, state.bigStoragePageCapacity); const anchor = state.bigStoragePage * oldCapacity;
  const metrics = {
    columns: Math.max(1, state.inventoryColumns),
    rows: Math.max(1, state.inventoryRows),
    capacity: Math.max(1, state.inventoryPageCapacity),
  };
  state.bigStorageColumns = metrics.columns; state.bigStorageRows = metrics.rows; state.bigStoragePageCapacity = metrics.capacity;
  state.bigStoragePage = clamp(Math.floor(anchor / metrics.capacity), 0, Math.ceil(BIG_STORAGE_MAX_SLOTS / metrics.capacity) - 1);
  applyGridMetrics(grid, metrics);
  rebuildPortableGrid(grid, metrics.capacity);
  renderBigStorageGrid();
}

function renderBigStorageGrid() {
  const grid = $("#big-storage-grid"); if (!grid) return;
  const start = state.bigStoragePage * state.bigStoragePageCapacity;
  [...grid.children].forEach((cell, visibleIndex) => renderPortableEntryCell(cell, portableEntryAt(state.bigStorage, "storageIndex", start + visibleIndex), "空白倉庫格"));
  renderGenericPagination($("#big-storage-pages"), BIG_STORAGE_MAX_SLOTS, state.bigStoragePageCapacity, state.bigStoragePage, (page) => { state.bigStoragePage = page; renderBigStorageGrid(); });
  $("#big-storage-count").textContent = `${state.bigStorage.length} / ${BIG_STORAGE_MAX_SLOTS}`;
}

function renderWarehouse() {
  const big = state.warehouseMode === "big";
  $("#big-storage-panel").hidden = !big;
  $("#collection-launch-panel").hidden = big;
  if (big) renderBigStorageGrid();
}

let transferQuantityResolver = null;
function setupTransferQuantityDialog() {
  const dialog = $("#transfer-quantity-dialog");
  const finish = (value) => { const resolve = transferQuantityResolver; transferQuantityResolver = null; if (dialog.open) dialog.close(); resolve?.(value); };
  $("#transfer-quantity-form").addEventListener("submit", (event) => { event.preventDefault(); const input = $("#transfer-quantity-input"); finish(clamp(Math.trunc(Number(input.value) || 0), 1, Number(input.max))); });
  $("#transfer-quantity-all").addEventListener("click", () => finish(Number($("#transfer-quantity-input").max)));
  $("#transfer-quantity-cancel").addEventListener("click", () => finish(null));
  $("#transfer-quantity-close").addEventListener("click", () => finish(null));
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
}

function requestTransferQuantity(action, itemName, maximum) {
  if (maximum <= 1) return Promise.resolve(1);
  const dialog = $("#transfer-quantity-dialog");
  $("#transfer-quantity-title").textContent = `${action} ${itemName}`;
  $("#transfer-quantity-owned").textContent = `目前可操作：${maximum}`;
  const input = $("#transfer-quantity-input"); input.max = String(maximum); input.value = String(maximum);
  if (dialog.open) dialog.close();
  dialog.showModal();
  return new Promise((resolve) => { transferQuantityResolver = resolve; });
}

function addPortableEntry(entries, indexKey, maximum, source, quantity) {
  const isEquipment = Boolean(source.isEquipment || state.data.equipment.some((item) => item.item_id === source.itemId));
  if (!isEquipment) {
    const stack = entries.find((entry) => !entry.isEquipment && entry.itemId === source.itemId);
    if (stack) { stack.quantity += quantity; return true; }
  }
  if (entries.length >= maximum) return false;
  const item = catalogItem(source.itemId);
  entries.push(isEquipment
    ? { ...normalizeEquipmentInstance(source), [indexKey]: entries.length, name: item.item_name, quantity: 1, isEquipment: true }
    : { key: source.key || source.itemId, itemId: source.itemId, [indexKey]: entries.length, name: item.item_name, quantity, locked: Boolean(source.locked), isEquipment: false });
  return true;
}

async function transferInventoryToBigStorage(inventoryIndex) {
  const arrayIndex = state.inventory.findIndex((entry) => entry.inventoryIndex === inventoryIndex); const entry = state.inventory[arrayIndex];
  if (!entry) return false;
  const quantity = entry.isEquipment ? 1 : await requestTransferQuantity("存放", entry.name, entry.quantity);
  if (!quantity) return false;
  if (!addPortableEntry(state.bigStorage, "storageIndex", BIG_STORAGE_MAX_SLOTS, entry, quantity)) { addLog("大倉庫已滿，無法存放物品。", { channel: "other" }); return false; }
  if (!entry.isEquipment && entry.quantity > quantity) entry.quantity -= quantity; else state.inventory.splice(arrayIndex, 1);
  compactInventory(); compactBigStorage(); render(); renderWarehouse(); if ($("#collection-dialog")?.open) renderCollectionDialog(); persistPlayerSave(); return true;
}

async function transferBigStorageToInventory(storageIndex) {
  const arrayIndex = state.bigStorage.findIndex((entry) => entry.storageIndex === storageIndex); const entry = state.bigStorage[arrayIndex];
  if (!entry) return false;
  const quantity = entry.isEquipment ? 1 : await requestTransferQuantity("提領", entry.name, entry.quantity);
  if (!quantity) return false;
  const existingStack = !entry.isEquipment && state.inventory.find((candidate) => !candidate.isEquipment && candidate.itemId === entry.itemId);
  if (!existingStack && firstFreeInventoryIndex() < 0) { addLog("背包已滿，無法提領物品。", { channel: "other" }); return false; }
  if (existingStack) existingStack.quantity += quantity;
  else if (entry.isEquipment) {
    const inventoryIndex = firstFreeInventoryIndex();
    state.inventory.push({ ...normalizeEquipmentInstance(entry), inventoryIndex, name: entry.name, quantity: 1, isEquipment: true });
  } else addInventoryItem(entry.itemId, entry.name, quantity);
  if (!entry.isEquipment && entry.quantity > quantity) entry.quantity -= quantity; else state.bigStorage.splice(arrayIndex, 1);
  compactBigStorage(); render(); renderWarehouse(); if ($("#collection-dialog")?.open) renderCollectionDialog(); persistPlayerSave(); return true;
}

function useBigStorageCell(visibleIndex) { return transferBigStorageToInventory(state.bigStoragePage * state.bigStoragePageCapacity + visibleIndex); }

const COLLECTION_GRID_LAYOUT = ["necklace_1", "earrings_1", "helmet_1", "earrings_2", null, null, "weapon_1", "body_1", "shield_1", null, "ring_1", "ring_2", "kneepads_1", "ring_3", "ring_4", "idol_1", "gloves_1", "shoe_1", "gloves_2", "core_1"];

function currentCollection() { return state.collections[state.collectionPage] ?? state.collections[0]; }

function setupCollectionDialog() {
  $("#collection-open").addEventListener("click", openCollectionDialog);
  $("#collection-close").addEventListener("click", () => $("#collection-dialog").close());
  $("#collection-rename").addEventListener("click", openCollectionRenameDialog);
  $("#collection-rename-close").addEventListener("click", closeCollectionRenameDialog);
  $("#collection-rename-cancel").addEventListener("click", closeCollectionRenameDialog);
  $("#collection-rename-form").addEventListener("submit", (event) => {
    event.preventDefault(); const collection = currentCollection();
    collection.name = normalizeCollectionName($("#collection-rename-input").value, collection.collectionId);
    closeCollectionRenameDialog(); renderCollectionDialog(); persistPlayerSave();
  });
  const equipmentGrid = $("#collection-equipment-grid");
  equipmentGrid.replaceChildren(...COLLECTION_GRID_LAYOUT.map((slot) => {
    if (!slot) { const blank = document.createElement("span"); blank.className = "equipment-blank"; return blank; }
    const button = document.createElement("button"); button.type = "button"; button.dataset.collectionSlot = slot;
    return button;
  }));
  const pages = $("#collection-pages");
  pages.replaceChildren(...Array.from({ length: COLLECTION_PAGE_COUNT }, (_, index) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = String(index + 1);
    button.addEventListener("click", () => { state.collectionPage = index; renderCollectionDialog(); }); return button;
  }));
}

function openCollectionDialog() {
  const dialog = $("#collection-dialog"); if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => { recalculateCollectionLayouts(); renderCollectionDialog(); });
}

function openCollectionRenameDialog() {
  const collection = currentCollection();
  $("#collection-rename-title").textContent = `重新命名收藏庫 ${collection.collectionId}`;
  $("#collection-rename-input").value = collection.name;
  $("#collection-rename-dialog").showModal(); $("#collection-rename-input").focus();
}

function closeCollectionRenameDialog() { if ($("#collection-rename-dialog").open) $("#collection-rename-dialog").close(); }

function collectionSlotForItem(item, equipment) {
  const compatible = EQUIPMENT_SLOTS.filter((slot) => slot.positions.includes(item?.EQ_position) || (item?.weapon_type === "martial_weapon" && slot.key === "shield_1"));
  return compatible.find((slot) => !equipment[slot.key])?.key ?? compatible[0]?.key ?? null;
}

function showCollectionMessage(text, error = false) {
  const message = $("#collection-message"); message.textContent = text; message.classList.toggle("error", error);
}

function moveEquipmentToCollection(sourceType, sourceIndex) {
  const sourceEntries = sourceType === "inventory" ? state.inventory : state.bigStorage;
  const indexKey = sourceType === "inventory" ? "inventoryIndex" : "storageIndex";
  const arrayIndex = sourceEntries.findIndex((entry) => entry[indexKey] === sourceIndex);
  const incoming = sourceEntries[arrayIndex];
  if (!incoming) return false;
  if (!incoming.isEquipment) { showCollectionMessage("收藏庫只能存放裝備。", true); return false; }
  const collection = currentCollection(); const item = catalogItem(incoming.itemId); const slot = collectionSlotForItem(item, collection.equipment);
  if (!slot) { showCollectionMessage(`${item.item_name} 沒有對應的收藏裝備欄位。`, true); return false; }
  const replaced = collection.equipment[slot];
  sourceEntries.splice(arrayIndex, 1);
  if (replaced) {
    const returnedItem = catalogItem(replaced.itemId);
    sourceEntries.push({ ...normalizeEquipmentInstance(replaced), [indexKey]: sourceEntries.length, name: returnedItem.item_name, quantity: 1, isEquipment: true });
  }
  collection.equipment[slot] = normalizeEquipmentInstance(incoming);
  if (sourceType === "inventory") compactInventory(); else compactBigStorage();
  ensureUniqueEquipmentUuids(); render(); renderWarehouse(); renderCollectionDialog(); persistPlayerSave();
  showCollectionMessage(`${item.item_name} 已放入 ${collection.name}${replaced ? "，原裝備已回到來源" : ""}。`);
  return true;
}

function removeCollectionEquipment(slot) {
  const collection = currentCollection(); const equipped = collection.equipment[slot]; if (!equipped) return false;
  const item = catalogItem(equipped.itemId);
  if (firstFreeBigStorageIndex() >= 0) addPortableEntry(state.bigStorage, "storageIndex", BIG_STORAGE_MAX_SLOTS, equipped, 1);
  else {
    const inventoryIndex = firstFreeInventoryIndex();
    if (inventoryIndex < 0) { showCollectionMessage("倉庫與背包空間不足，無法卸下此裝備。", true); return false; }
    state.inventory.push({ ...normalizeEquipmentInstance(equipped), inventoryIndex, name: item.item_name, quantity: 1, isEquipment: true });
  }
  delete collection.equipment[slot];
  compactBigStorage(); compactInventory(); ensureUniqueEquipmentUuids(); render(); renderWarehouse(); renderCollectionDialog(); persistPlayerSave();
  showCollectionMessage(`${item.item_name} 已從 ${collection.name} 卸下。`); return true;
}

function recalculateCollectionLayouts() {
  const inventoryGrid = $("#collection-inventory-grid"); const storageGrid = $("#collection-storage-grid");
  if (inventoryGrid?.clientWidth > 0 && inventoryGrid.clientHeight > 0) {
    const old = Math.max(1, state.collectionInventoryCapacity); const anchor = state.collectionInventoryPage * old; const metrics = floatingGridMetrics(inventoryGrid);
    state.collectionInventoryCapacity = metrics.capacity; state.collectionInventoryPage = clamp(Math.floor(anchor / metrics.capacity), 0, Math.max(0, inventoryPageCountFor(metrics.capacity) - 1));
    applyGridMetrics(inventoryGrid, metrics); rebuildPortableGrid(inventoryGrid, metrics.capacity);
  }
  if (storageGrid?.clientWidth > 0 && storageGrid.clientHeight > 0) {
    const old = Math.max(1, state.collectionStorageCapacity); const anchor = state.collectionStoragePage * old; const metrics = floatingGridMetrics(storageGrid);
    state.collectionStorageCapacity = metrics.capacity; state.collectionStoragePage = clamp(Math.floor(anchor / metrics.capacity), 0, Math.ceil(BIG_STORAGE_MAX_SLOTS / metrics.capacity) - 1);
    applyGridMetrics(storageGrid, metrics); rebuildPortableGrid(storageGrid, metrics.capacity);
  }
  renderCollectionDialog();
}

function inventoryPageCountFor(capacity) {
  const highest = state.inventory.reduce((maximum, entry) => Math.max(maximum, Number(entry.inventoryIndex) || 0), -1);
  return Math.max(1, Math.ceil(Math.min(INVENTORY_MAX_SLOTS, Math.max(capacity, highest + 1 + INVENTORY_RESERVE_SLOTS)) / capacity));
}

function renderCollectionEquipment() {
  const collection = currentCollection();
  document.querySelectorAll("#collection-equipment-grid [data-collection-slot]").forEach((button) => {
    const slot = button.dataset.collectionSlot; const equipped = collection.equipment[slot]; const item = equipped ? catalogItem(equipped.itemId) : null;
    button.textContent = item ? equipmentButtonText(item, equipped) : equipmentSlotLabel(EQUIPMENT_SLOTS.find((candidate) => candidate.key === slot)?.positions[0]);
    applyEnhancementVisual(button, equipped, item);
    assignEquipmentTooltip(button, item, item ? "點擊卸下" : "", equipped);
    button.disabled = !equipped;
  });
}

function renderCollectionDialog() {
  if (!state.collections.length) state.collections = normalizeCollections([]);
  const collection = currentCollection();
  $("#collection-name").textContent = collection.name;
  document.querySelectorAll("#collection-pages button").forEach((button, index) => button.classList.toggle("active", index === state.collectionPage));
  renderCollectionEquipment();
  const inventoryStart = state.collectionInventoryPage * state.collectionInventoryCapacity;
  [...$("#collection-inventory-grid").children].forEach((cell, visible) => renderPortableEntryCell(cell, inventoryEntryAt(inventoryStart + visible), "空白背包格"));
  renderGenericPagination($("#collection-inventory-pages"), inventoryPageCountFor(state.collectionInventoryCapacity) * state.collectionInventoryCapacity, state.collectionInventoryCapacity, state.collectionInventoryPage, (page) => { state.collectionInventoryPage = page; renderCollectionDialog(); });
  const storageStart = state.collectionStoragePage * state.collectionStorageCapacity;
  [...$("#collection-storage-grid").children].forEach((cell, visible) => renderPortableEntryCell(cell, portableEntryAt(state.bigStorage, "storageIndex", storageStart + visible), "空白倉庫格"));
  renderGenericPagination($("#collection-storage-pages"), BIG_STORAGE_MAX_SLOTS, state.collectionStorageCapacity, state.collectionStoragePage, (page) => { state.collectionStoragePage = page; renderCollectionDialog(); });
}

function setupShop() {
  for (const button of document.querySelectorAll("[data-shop-mode]")) {
    button.addEventListener("click", () => {
      state.shopMode = button.dataset.shopMode;
      document.querySelectorAll("[data-shop-mode]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      renderShop();
    });
  }
  renderShop();
}

function canBuyItem(item) {
  const configuredPrice = item?.buy_gold;
  return item?.buy_level !== null && item?.buy_level !== undefined && configuredPrice !== null && configuredPrice !== undefined && configuredPrice !== "";
}

function itemSellPrice(item) {
  const configuredPrice = item?.sell_gold;
  const price = Number(configuredPrice);
  return configuredPrice !== null && configuredPrice !== undefined && configuredPrice !== "" && Number.isFinite(price) && price >= 0
    ? price
    : null;
}

function isAutoSellEligibleEntry(entry) {
  return isAutoSellCandidateEntry(entry) && !entry.locked;
}

function isAutoSellCandidateEntry(entry) {
  if (!entry || itemSellPrice(catalogItem(entry.itemId)) === null) return false;
  return !entry.isEquipment || normalizeEnhancement(entry).level === 0;
}

function autoSellExistingInventory(itemId) {
  const item = catalogItem(itemId);
  const price = itemSellPrice(item);
  if (!item || price === null) return { quantity: 0, gold: 0 };
  let quantity = 0;
  for (let index = state.inventory.length - 1; index >= 0; index -= 1) {
    const entry = state.inventory[index];
    if (entry.itemId !== itemId || !isAutoSellEligibleEntry(entry)) continue;
    quantity += entry.isEquipment ? 1 : Math.max(1, Math.trunc(Number(entry.quantity) || 1));
    state.inventory.splice(index, 1);
  }
  if (quantity > 0) compactInventory();
  const gold = quantity * price;
  state.gold += gold;
  if (quantity > 0) addLog(`自動賣出 ${item.item_name} × ${quantity}，獲得 ${gold} 金幣。`);
  return { quantity, gold };
}

function setAutoSellRule(itemId, enabled) {
  const item = catalogItem(itemId);
  if (!item || itemSellPrice(item) === null) return false;
  if (enabled) {
    state.autoSellItemIds.add(itemId);
    autoSellExistingInventory(itemId);
  } else state.autoSellItemIds.delete(itemId);
  render();
  persistPlayerSave();
  return state.autoSellItemIds.has(itemId);
}

function autoSellCatalogEntries() {
  const itemIds = [];
  for (const entry of state.inventory) {
    if (isAutoSellCandidateEntry(entry) && !itemIds.includes(entry.itemId)) itemIds.push(entry.itemId);
  }
  for (const itemId of state.autoSellItemIds) if (!itemIds.includes(itemId) && itemSellPrice(catalogItem(itemId)) !== null) itemIds.push(itemId);
  return itemIds.map((itemId) => {
    const item = catalogItem(itemId);
    const quantity = state.inventory
      .filter((entry) => entry.itemId === itemId && isAutoSellCandidateEntry(entry))
      .reduce((sum, entry) => sum + (entry.isEquipment ? 1 : Math.max(1, Math.trunc(Number(entry.quantity) || 1))), 0);
    return { item, quantity };
  });
}

function isLearnedSkillBook(item) {
  if (item?.effect !== "learn_skill" || !item.skill_id) return false;
  const owner = state.roster.find((hero) => hero.classId === item.target);
  return Boolean(owner?.learnedSkillIds.has(item.skill_id));
}

function canPurchaseShopItem(item) {
  if (!canBuyItem(item) || isLearnedSkillBook(item)) return false;
  if (item.effect === "learn_skill") {
    const owner = state.roster.find((hero) => hero.classId === item.target);
    const skill = state.data.characterSkills.find((candidate) => candidate.skill_id === item.skill_id && candidate.class_id === item.target);
    return Boolean(owner && skill && owner.level >= Number(item.buy_level) && owner.level >= Number(skill.level));
  }
  const highestLevel = Math.max(...state.roster.map((hero) => hero.level));
  return highestLevel >= Number(item.buy_level);
}

function normalizedShopQuantity(value, maximum = 999) {
  const quantity = Math.trunc(Number(value));
  const limit = Math.min(Math.max(1, Math.trunc(Number(maximum) || 1)), 999);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > limit) return null;
  return quantity;
}

function buyInventoryItem(itemId, requestedQuantity = 1) {
  const item = state.data.item.find((candidate) => candidate.item_id === itemId);
  const price = Number(item?.buy_gold);
  const quantity = item?.effect === "learn_skill" || !BULK_SHOP_EFFECTS.has(item?.effect) ? 1 : normalizedShopQuantity(requestedQuantity);
  const totalPrice = quantity === null ? NaN : price * quantity;
  if (!item || !canPurchaseShopItem(item) || !Number.isFinite(price) || price < 0 || !Number.isFinite(totalPrice) || state.gold < totalPrice) return false;
  state.gold -= totalPrice;
  addInventoryItem(item.item_id, item.item_name, quantity);
  addLog(`商店購買 ${item.item_name} × ${quantity}，花費 ${totalPrice} 金幣。`);
  render();
  persistPlayerSave();
  return true;
}

function sellInventoryItem(identifier, requestedQuantity = 1) {
  const exactIndex = state.inventory.findIndex((entry) => entry.key === identifier || entry.itemUuid === identifier);
  const fallbackIndex = exactIndex >= 0 ? exactIndex : state.inventory.findIndex((entry) => entry.itemId === identifier);
  const inventoryItem = state.inventory[fallbackIndex];
  const itemData = catalogItem(inventoryItem?.itemId);
  const price = itemSellPrice(itemData);
  const available = inventoryItem?.isEquipment ? 1 : Math.max(1, Math.trunc(Number(inventoryItem?.quantity) || 1));
  const allowedQuantity = !inventoryItem?.isEquipment && BULK_SHOP_EFFECTS.has(itemData?.effect) ? requestedQuantity : 1;
  const quantity = normalizedShopQuantity(allowedQuantity, available);
  if (fallbackIndex < 0 || inventoryItem?.locked || price === null || quantity === null
    || (inventoryItem?.isEquipment && normalizeEnhancement(inventoryItem).level >= 1)) return false;
  if (available > quantity) inventoryItem.quantity = available - quantity;
  else removeInventoryEntryAt(fallbackIndex);
  state.gold += price * quantity;
  addLog(`商店收購 ${itemData.item_name} × ${quantity}，獲得 ${price * quantity} 金幣。`);
  render();
  persistPlayerSave();
  return true;
}

function equipmentRecycleGold(item, instance) {
  const itemLevel = Math.max(0, Number(item?.item_level) || 0);
  const enhanceLevel = normalizeEnhancement(instance).level;
  return Math.max(0, Math.round(Number(systemSettings().base_enhance_cost) * (1 + itemLevel / 10) * enhanceLevel));
}

function totalPartyLuck() {
  return Math.max(0, state.party.reduce((sum, hero) => sum + Number(hero ? combatStat(hero, "LUK") : 0), 0));
}

function rollRecoveredStoneCount(eventCount, luck, random = Math.random) {
  const guaranteedRerolls = Math.floor(Math.max(0, luck) / 100);
  const fractionalUnlockChance = Math.max(0, luck) % 100;
  let recovered = 0;
  const recoverRate = clamp(Number(systemSettings().recover_rate), 0, 100);
  for (let eventIndex = 0; eventIndex < Math.max(0, Math.trunc(eventCount)); eventIndex += 1) {
    let success = random() * 100 < recoverRate;
    for (let reroll = 0; !success && reroll < guaranteedRerolls; reroll += 1) success = random() * 100 < recoverRate;
    if (!success && fractionalUnlockChance > 0 && random() * 100 < fractionalUnlockChance) success = random() * 100 < recoverRate;
    if (success) recovered += 1;
  }
  return recovered;
}

function recycleInventoryEquipment(identifier, random = Math.random) {
  const inventoryIndex = state.inventory.findIndex((entry) => entry.key === identifier || entry.itemUuid === identifier);
  const instance = state.inventory[inventoryIndex];
  const item = instance?.isEquipment ? state.data.equipment.find((candidate) => candidate.item_id === instance.itemId) : null;
  const enhancement = instance ? normalizeEnhancement(instance) : null;
  if (inventoryIndex < 0 || !item || instance.locked || enhancement.level < 1) return false;

  const gold = equipmentRecycleGold(item, instance);
  const recovered = { bless: 0, curse: 0, chaos: 0 };
  if (enhancement.level >= 5) {
    const luck = totalPartyLuck();
    recovered.bless = rollRecoveredStoneCount(enhancement.blessCount, luck, random);
    recovered.curse = rollRecoveredStoneCount(enhancement.curseCount, luck, random);
    recovered.chaos = rollRecoveredStoneCount(enhancement.chaosCount, luck, random);
  }

  removeInventoryEntryAt(inventoryIndex);
  state.gold += gold;
  const stoneIds = { bless: "sp0101", curse: "sp0201", chaos: "sp0301" };
  const recoveredText = [];
  for (const [type, quantity] of Object.entries(recovered)) {
    if (quantity <= 0) continue;
    const stone = state.data.item.find((candidate) => candidate.item_id === stoneIds[type]);
    addInventoryItem(stone.item_id, stone.item_name, quantity);
    recoveredText.push(`${stone.item_name} x ${quantity}`);
  }
  const displayName = equipmentDisplayName(item, instance);
  addLog(`${displayName} 已經被回收，回收 ${gold.toLocaleString()} 金幣${recoveredText.length ? `，並成功提取 ${recoveredText.join("、")}` : ""}。`, {
    messageColor: indexedColor("right_equipment_recover", "#00FFFF"),
  });
  render();
  persistPlayerSave();
  return { gold, recovered, itemId: item.item_id };
}

function toggleInventoryLock(identifier) {
  const inventoryItem = state.inventory.find((entry) => entry.key === identifier || entry.itemUuid === identifier)
    ?? state.inventory.find((entry) => entry.itemId === identifier);
  if (!inventoryItem) return false;
  const locked = !inventoryItem.locked;
  const affectedItems = inventoryItem.isEquipment
    ? [inventoryItem]
    : state.inventory.filter((entry) => !entry.isEquipment && entry.itemId === inventoryItem.itemId);
  for (const entry of affectedItems) entry.locked = locked;
  if (!locked && state.autoSellItemIds.has(inventoryItem.itemId)) autoSellExistingInventory(inventoryItem.itemId);
  renderShop();
  persistPlayerSave();
  return locked;
}

function toggleEquipmentLock(identifier) {
  return toggleInventoryLock(identifier);
}

function renderShop() {
  const container = $("#shop-list");
  if (!container || !state.data) return;
  const highestLevel = Math.max(...state.roster.map((hero) => hero.level));
  const purchasable = state.data.item.filter(canPurchaseShopItem);
  const inventorySignature = state.inventory.map((entry) => [
    entry.key, entry.itemUuid, entry.itemId, entry.quantity,
    entry.enhancement?.level ?? 0, entry.locked ? 1 : 0,
  ].join(":")).join("|");
  const signature = state.shopMode === "buy"
    ? `buy:${highestLevel}:${purchasable.map((item) => `${item.item_id}:${item.buy_gold}`).join("|")}`
    : state.shopMode === "auto-sell"
      ? `auto-sell:${[...state.autoSellItemIds].sort().join("|")}:${inventorySignature}`
      : state.shopMode === "recycle"
        ? `recycle:${state.gold}:${inventorySignature}:${totalPartyLuck()}`
      : `sell:${inventorySignature}`;
  if (container.dataset.renderSignature === signature) {
    if (state.shopMode === "buy") {
      for (const button of container.querySelectorAll("[data-buy-item-id]")) {
        const item = state.data.item.find((candidate) => candidate.item_id === button.dataset.buyItemId);
        button.disabled = !item || state.gold < Number(item.buy_gold);
      }
    }
    return;
  }
  container.dataset.renderSignature = signature;
  container.replaceChildren();
  container.classList.toggle("auto-sell-grid", state.shopMode === "auto-sell");
  if (state.shopMode === "buy") {
    if (!purchasable.length) {
      const empty = document.createElement("p"); empty.className = "shop-empty"; empty.textContent = "目前沒有可購買的物品"; container.append(empty); return;
    }
    for (const item of purchasable) {
      const price = Number(item.buy_gold);
      const row = document.createElement("div"); row.className = "shop-row buy-shop-row"; row.title = itemTooltip(item);
      const copy = document.createElement("span"); copy.className = "shop-item-name"; copy.textContent = item.item_name;
      const priceLabel = document.createElement("span"); priceLabel.className = "shop-price"; priceLabel.textContent = `$ ${price.toLocaleString()}`;
      priceLabel.style.color = indexedColor("left_money_color");
      const actions = document.createElement("div"); actions.className = "shop-actions";
      let quantityInput = null;
      if (BULK_SHOP_EFFECTS.has(item.effect)) {
        quantityInput = document.createElement("input"); quantityInput.type = "number"; quantityInput.min = "1"; quantityInput.max = "999"; quantityInput.step = "1"; quantityInput.value = "1";
        quantityInput.setAttribute("aria-label", `購買 ${item.item_name} 數量`);
      }
      const button = document.createElement("button"); button.type = "button"; button.dataset.buyItemId = item.item_id; button.textContent = "購買"; button.disabled = state.gold < price;
      button.setAttribute("aria-label", `購買 ${item.item_name}，花費 ${price} 金幣`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const quantity = quantityInput ? quantityInput.value : 1;
        if (!buyInventoryItem(item.item_id, quantity)) addLog(`${item.item_name} 購買失敗，請確認數量、等級與金幣。`);
      });
      if (quantityInput) actions.append(quantityInput);
      actions.append(button);
      row.append(copy, priceLabel, actions);
      container.append(row);
    }
    return;
  }
  if (state.shopMode === "auto-sell") {
    const entries = autoSellCatalogEntries();
    if (!entries.length) {
      const empty = document.createElement("p"); empty.className = "shop-empty"; empty.textContent = "背包中沒有可設定自動賣出的物品或 +0 裝備"; container.append(empty); return;
    }
    for (const { item, quantity } of entries) {
      const price = itemSellPrice(item);
      const row = document.createElement("label"); row.className = "auto-sell-row";
      if (state.data.equipment.includes(item)) assignEquipmentTooltip(row, item, "", null);
      else row.title = itemTooltip(item);
      const copy = document.createElement("span"); copy.textContent = item.item_name;
      const detail = document.createElement("small"); detail.textContent = `持有 ${quantity}｜每個 ${price} 金幣`; copy.append(detail);
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = state.autoSellItemIds.has(item.item_id);
      input.setAttribute("aria-label", `自動賣出 ${item.item_name}`);
      input.addEventListener("change", () => setAutoSellRule(item.item_id, input.checked));
      row.append(copy, input); container.append(row);
    }
    return;
  }
  if (state.shopMode === "recycle") {
    const entries = state.inventory
      .filter((entry) => entry.isEquipment && normalizeEnhancement(entry).level >= 1)
      .map((instance) => ({
        instance,
        item: state.data.equipment.find((candidate) => candidate.item_id === instance.itemId),
        identifier: instance.itemUuid || instance.key,
      }))
      .filter(({ item }) => item);
    if (!entries.length) {
      const empty = document.createElement("p"); empty.className = "shop-empty"; empty.textContent = "背包中沒有可回收的 +1 以上裝備"; container.append(empty); return;
    }
    for (const { item, instance, identifier } of entries) {
      const gold = equipmentRecycleGold(item, instance);
      const row = document.createElement("div"); row.className = "shop-row recycle-shop-row";
      assignEquipmentTooltip(row, item, "", instance);
      const copy = document.createElement("span"); copy.textContent = equipmentDisplayName(item, instance);
      const detail = document.createElement("small"); detail.textContent = `回收 ${gold.toLocaleString()} 金幣${normalizeEnhancement(instance).level >= 5 ? "｜可能提取 Lv.1 強化石" : ""}`; copy.append(detail);
      const lock = document.createElement("button"); lock.type = "button"; lock.className = `equipment-lock${instance.locked ? " active" : ""}`;
      lock.textContent = "🔒"; lock.title = instance.locked ? "已鎖定，點擊解除後才能回收" : "未鎖定，點擊保護";
      lock.setAttribute("aria-label", `${instance.locked ? "解除鎖定" : "鎖定"} ${item.item_name}`);
      lock.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); toggleInventoryLock(identifier); });
      const button = document.createElement("button"); button.type = "button"; button.textContent = "回收"; button.disabled = Boolean(instance.locked);
      button.setAttribute("aria-label", `回收 ${equipmentDisplayName(item, instance)}，獲得 ${gold} 金幣`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (!recycleInventoryEquipment(identifier)) addLog(`${item.item_name} 回收失敗，請確認裝備仍在背包且未鎖定。`);
      });
      row.append(lock, copy, button); container.append(row);
    }
    return;
  }
  const stacks = new Map();
  const sellable = [];
  for (const entry of state.inventory) {
    const item = catalogItem(entry.itemId);
    if (!item || itemSellPrice(item) === null) continue;
    if (entry.isEquipment) {
      if (normalizeEnhancement(entry).level >= 1) continue;
      sellable.push({ item, quantity: 1, identifier: entry.itemUuid || entry.key, instance: entry });
    }
    else {
      const existing = stacks.get(entry.itemId);
      stacks.set(entry.itemId, {
        item,
        quantity: (existing?.quantity ?? 0) + Math.max(1, entry.quantity ?? 1),
        identifier: entry.itemId,
        instance: existing?.instance ?? entry,
      });
    }
  }
  sellable.unshift(...stacks.values());
  if (!sellable.length) {
    const empty = document.createElement("p"); empty.className = "shop-empty"; empty.textContent = "目前沒有可賣出的物品"; container.append(empty); return;
  }
  for (const { item, quantity, identifier, instance } of sellable) {
    const price = itemSellPrice(item);
    const row = document.createElement("div"); row.className = "shop-row sell-shop-row";
    if (state.data.equipment.includes(item)) assignEquipmentTooltip(row, item, "", instance);
    else row.title = itemTooltip(item);
    const copy = document.createElement("span"); copy.textContent = `${instance?.isEquipment ? equipmentDisplayName(item, instance) : item.item_name} × ${quantity}`;
    const priceLabel = document.createElement("span"); priceLabel.className = "shop-price"; priceLabel.textContent = `$ ${price.toLocaleString()}`;
    priceLabel.style.color = indexedColor("left_money_color");
    const button = document.createElement("button"); button.type = "button"; button.textContent = "賣出1個";
    button.disabled = Boolean(instance?.locked);
    button.setAttribute("aria-label", `賣出 ${item.item_name} 1 個，獲得 ${price} 金幣`);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (!sellInventoryItem(identifier)) addLog(`${item.item_name} 販賣失敗，請確認背包與售價。`);
    });
    const actions = document.createElement("div"); actions.className = "shop-actions"; actions.append(button);
    if (!instance?.isEquipment && BULK_SHOP_EFFECTS.has(item.effect)) {
      const quantityInput = document.createElement("input"); quantityInput.type = "number"; quantityInput.min = "1"; quantityInput.max = String(quantity); quantityInput.step = "1"; quantityInput.value = String(quantity);
      quantityInput.setAttribute("aria-label", `賣出 ${item.item_name} 數量`);
      const quantityButton = document.createElement("button"); quantityButton.type = "button"; quantityButton.textContent = "販賣"; quantityButton.disabled = Boolean(instance?.locked);
      quantityButton.addEventListener("click", (event) => {
        event.preventDefault();
        if (!sellInventoryItem(identifier, quantityInput.value)) addLog(`${item.item_name} 販賣失敗，請確認數量與鎖定狀態。`);
      });
      actions.append(quantityInput, quantityButton);
    }
    if (instance) {
      const lock = document.createElement("button"); lock.type = "button"; lock.className = `equipment-lock${instance.locked ? " active" : ""}`;
      lock.textContent = "🔒";
      lock.title = instance.locked ? "已鎖定，點擊解除" : "未鎖定，點擊保護";
      lock.setAttribute("aria-label", `${instance.locked ? "解除鎖定" : "鎖定"} ${item.item_name}`);
      lock.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); toggleInventoryLock(identifier); });
      row.append(lock);
    }
    row.append(copy, priceLabel, actions); container.append(row);
  }
}

function buildMapSelect() {
  const select = $("#map-select");
  select.replaceChildren();
  for (const map of state.data.map) {
    const option = document.createElement("option"); option.value = map.map_id; option.textContent = map.map_id === "town001" ? map.name : `${map.name}（Lv.${map.unlock_level}）`;
    select.append(option);
  }
  const currentLevel = Math.max(1, ...state.party.map((hero) => hero.level));
  state.mapMenuOpenGroups = new Set([mapLevelGroup(currentLevel).start]);
  $("#map-picker-button").addEventListener("click", () => {
    const menu = $("#map-picker-menu");
    menu.hidden = !menu.hidden;
    $("#map-picker-button").setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".map-picker")) return;
    $("#map-picker-menu").hidden = true;
    $("#map-picker-button").setAttribute("aria-expanded", "false");
  });
  updateMapLocks();
  select.addEventListener("change", () => chooseMap(select.value));
}

function mapLevelGroup(unlockLevel) {
  const level = Math.max(1, Math.trunc(Number(unlockLevel) || 1));
  const start = Math.floor((level - 1) / 10) * 10 + 1;
  return { start, end: start + 9 };
}

function isTownMap(mapOrId) { return String(typeof mapOrId === "object" ? mapOrId?.map_id : mapOrId ?? "").startsWith("town"); }

function renderMapMenu() {
  const menu = $("#map-picker-menu");
  if (!menu) return;
  const highestLevel = Math.max(1, ...state.party.map((hero) => hero.level));
  const towns = state.data.map.filter((map) => String(map.map_id).startsWith("town"));
  const grouped = new Map();
  state.data.map.forEach((map, order) => {
    if (String(map.map_id).startsWith("town")) return;
    const group = mapLevelGroup(map.unlock_level);
    if (!grouped.has(group.start)) grouped.set(group.start, { ...group, maps: [] });
    grouped.get(group.start).maps.push({ map, order });
  });
  const mapButton = (map) => {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.mapId = map.map_id;
    button.textContent = String(map.map_id).startsWith("town") ? map.name : `${map.name}（Lv.${map.unlock_level}）`;
    button.disabled = !isTownMap(map) && map.unlock_level > highestLevel;
    button.classList.toggle("active", state.map?.map_id === map.map_id);
    button.addEventListener("click", () => { chooseMap(map.map_id); menu.hidden = true; $("#map-picker-button").setAttribute("aria-expanded", "false"); });
    return button;
  };
  const fragments = towns.map(mapButton);
  for (const group of [...grouped.values()].sort((a, b) => a.start - b.start)) {
    const details = document.createElement("details"); details.dataset.groupStart = String(group.start); details.open = state.mapMenuOpenGroups.has(group.start);
    const summary = document.createElement("summary"); summary.textContent = `等級 ${group.start} - ${group.end}區域`;
    details.addEventListener("toggle", () => { if (details.open) state.mapMenuOpenGroups.add(group.start); else state.mapMenuOpenGroups.delete(group.start); });
    details.append(summary, ...group.maps.sort((a, b) => a.map.unlock_level - b.map.unlock_level || a.order - b.order).map(({ map }) => mapButton(map)));
    fragments.push(details);
  }
  menu.replaceChildren(...fragments);
  syncMapPicker();
}

function syncMapPicker() {
  const map = state.map;
  if (!map) return;
  if ($("#map-select")) $("#map-select").value = map.map_id;
  if ($("#map-picker-button")) $("#map-picker-button").textContent = String(map.map_id).startsWith("town") ? map.name : `${map.name}（Lv.${map.unlock_level}）`;
  document.querySelectorAll("#map-picker-menu [data-map-id]").forEach((button) => button.classList.toggle("active", button.dataset.mapId === map.map_id));
}

function updateMapLocks() {
  const highestLevel = Math.max(...state.party.map((hero) => hero.level));
  for (const option of $("#map-select").options) {
    const map = state.data.map.find((row) => row.map_id === option.value);
    option.disabled = Boolean(map && !isTownMap(map) && map.unlock_level > highestLevel);
  }
  renderMapMenu();
}

function mapMonsterNames(mapId) {
  return [...new Set(state.data.mapSpawn.filter((row) => row.map_id === mapId)
    .map((row) => state.data.monsters.find((monster) => monster.monster_id === row.monster_id)?.name ?? row.monster_id))];
}

function chooseMap(mapId, townAutoReturn = false) {
  const map = state.data.map.find((row) => row.map_id === mapId);
  if (!map) return;
  if (map.map_id === "town001") {
    enterTown(townAutoReturn);
    render();
    return;
  }
  state.map = map;
  state.townAutoReturn = false;
  state.previousMapId = mapId;
  $("#map-select").disabled = false;
  $("#map-select").value = mapId;
  syncMapPicker();
  state.enemies = []; state.spawnElapsed = state.map.spawn_cd;
  addLog(`進入 ${state.map.name}；這裡有：${mapMonsterNames(mapId).join("、")}`); spawnMonster(); render();
}

function weightedMonster() {
  const rows = state.data.mapSpawn.filter((row) => row.map_id === state.map.map_id);
  let roll = Math.random() * rows.reduce((sum, row) => sum + row.spawn_rate, 0);
  for (const row of rows) { roll -= row.spawn_rate; if (roll < 0) return state.data.monsters.find((m) => m.monster_id === row.monster_id); }
  return state.data.monsters.find((m) => m.monster_id === rows.at(-1).monster_id);
}

function spawnMonster() {
  if (!state.map || state.map.map_id === "town001" || state.enemies.length >= state.map.max_monsters) return;
  const source = weightedMonster();
  const configuredSkills = monsterConfiguredSkills(source.monster_id);
  state.enemies.push({ ...source, id: `${source.monster_id}-${crypto.randomUUID()}`, maxHp: source.HP, hp: source.HP, cooldown: 0,
    skillCooldowns: Object.fromEntries(configuredSkills.map(({ use }) => [use.skill_id, use.initial_delay])), casting: null, buffs: [] });
  state.spawnElapsed = 0; addLog(`${source.name} 出現在隊伍後方。`, { channel: "monster" });
}

function loop(now) {
  const dt = Math.min(.25, (now - state.lastTime) / 1000); state.lastTime = now;
  if (!state.paused) update(dt);
  render(); requestAnimationFrame(loop);
}

function update(dt) {
  state.elapsed += dt; state.spawnElapsed += dt;
  for (const hero of state.roster) updateItemCooldowns(hero, dt);
  if (state.map?.map_id === "town001") {
    updateTownRecovery(dt);
    if (state.townAutoReturn && allRosterRestored()) returnFromTown();
    return;
  }
  if (!livingParty().length) { enterTown(); return; }
  if (!state.enemies.length) spawnMonster();
  else if (state.spawnElapsed >= state.map.spawn_cd) spawnMonster();
  for (const actor of livingParty()) {
    applyRegeneration(actor, dt);
    if (actor.hp <= 0) continue;
    maybeAutoUseRecovery(actor);
    updateHeroAction(actor, dt);
  }
  for (const enemy of [...state.enemies]) {
    if (enemy.hp <= 0) continue;
    enemy.hp = clamp(roundSigned(enemy.hp + combatStat(enemy, "HPR") * dt), 0, enemy.maxHp);
    if (enemy.hp <= 0) { defeatMonster(enemy); continue; }
    updateMonsterAction(enemy, dt);
  }
}

function monsterConfiguredSkills(monsterId) {
  return state.data.monsterSkills
    .filter((use) => use.monster_id === monsterId)
    .map((use) => ({ use, skill: state.data.skill.find((skill) => skill.skill_id === use.skill_id) }))
    .filter(({ skill }) => skill)
    .sort((a, b) => a.use.use_priority - b.use.use_priority || a.use.skill_order - b.use.skill_order);
}

function monsterActionInterval(enemy) {
  const attacksPerSecond = Math.max(.05, enemy.attack_speed * (1 + combatStat(enemy, "ASPD") / 100));
  return 1 / attacksPerSecond;
}

function monsterTriggerTargets(side) {
  if (side === "ally") return state.enemies.filter((target) => target.hp > 0);
  if (side === "enemy") return livingParty();
  return [];
}

function resourceRatio(unit, stat) {
  const currentKey = stat.toLowerCase();
  const maximumKey = `max${stat[0]}${stat.slice(1).toLowerCase()}`;
  const maximum = Number(unit[maximumKey]);
  if (!(maximum > 0)) return null;
  return Number(unit[currentKey]) / maximum * 100;
}

function monsterSkillTriggerSatisfied(use) {
  if (use.trigger_condition === "always") return true;
  const match = String(use.trigger_condition ?? "").match(/^(ally|enemy)_(HP|MP)_(below|above)_(\d+(?:\.\d+)?)$/i);
  if (!match) return false;
  const [, side, stat, comparison, thresholdText] = match;
  const threshold = Number(thresholdText);
  return monsterTriggerTargets(side.toLowerCase()).some((target) => {
    const ratio = resourceRatio(target, stat.toUpperCase());
    return ratio !== null && triggerComparisonMatches(ratio, comparison.toLowerCase(), threshold);
  });
}

function updateMonsterAction(enemy, dt) {
  enemy.cooldown -= dt;
  for (const skillId of Object.keys(enemy.skillCooldowns ?? {})) enemy.skillCooldowns[skillId] = Math.max(0, enemy.skillCooldowns[skillId] - dt);
  if (updateTimedSkillStatuses(enemy, dt)) return;
  if (enemy.casting) {
    enemy.casting.remaining -= dt;
    if (enemy.casting.remaining <= 0) {
      const { skill, skillColor } = enemy.casting; enemy.casting = null;
      executeMonsterSkill(enemy, skill, skillColor); enemy.cooldown = Math.max(enemy.cooldown, monsterActionInterval(enemy));
    }
    return;
  }
  if (enemy.cooldown > 0) return;
  const configured = monsterConfiguredSkills(enemy.monster_id)
    .find(({ use }) => monsterSkillTriggerSatisfied(use) && (enemy.skillCooldowns[use.skill_id] ?? 0) <= 0);
  if (configured) { startMonsterSkill(enemy, configured); return; }
  const target = frontParty();
  if (target) monsterAttack(enemy, target);
  enemy.cooldown += monsterActionInterval(enemy);
}

function startMonsterSkill(enemy, configured) {
  const { use, skill } = configured;
  const skillColor = csvColor(use.skill_color, "#ededed");
  enemy.skillCooldowns[use.skill_id] = use.cooldown;
  if (skill.cast_time > 0) {
    enemy.casting = { skill, skillColor, remaining: skill.cast_time };
    addLog(`${enemy.name} 開始施放 ${skill.name}。`, { channel: "monster", skillName: skill.name, skillColor });
  } else {
    executeMonsterSkill(enemy, skill, skillColor);
    enemy.cooldown += monsterActionInterval(enemy);
  }
}

function randomLivingTarget(targets) {
  const living = targets.filter((target) => target.hp > 0);
  return living.length ? [living[randomInt(0, living.length - 1)]] : [];
}

function selectCombatTargets(targets, targetType) {
  const living = targets.filter((target) => target.hp > 0);
  if (["aoe", "enemy_aoe"].includes(targetType)) return living;
  if (targetType === "random") return randomLivingTarget(living);
  if (["front", "middle", "last"].includes(targetType)) {
    const index = { front: 0, middle: 1, last: 2 }[targetType];
    return living[index] ? [living[index]] : randomLivingTarget(living);
  }
  if (["HPlower", "HPhigher"].includes(targetType)) return selectResourceRatioTarget(living, "HP", targetType === "HPhigher");
  if (["MPlower", "MPhigher"].includes(targetType)) return selectResourceRatioTarget(living, "MP", targetType === "MPhigher");
  return [];
}

function selectResourceRatioTarget(formation, resource, higher = false) {
  const candidates = formation.map((target, order) => ({ target, order, ratio: resourceRatio(target, resource) })).filter((entry) => entry.ratio !== null);
  candidates.sort((left, right) => (higher ? right.ratio - left.ratio : left.ratio - right.ratio) || left.order - right.order);
  return candidates.length ? [candidates[0].target] : [];
}

function resolveSkillTargetSet(caster, targetType, allies, opponents, mainTargets = []) {
  const livingAllies = allies.filter((target) => target.hp > 0);
  const livingOpponents = opponents.filter((target) => target.hp > 0);
  if (targetType === "DMGchoose") return [...mainTargets];
  if (targetType === "self") return caster?.hp > 0 ? [caster] : [];
  if (targetType === "ally_aoe") return livingAllies;
  if (["aoe", "enemy_aoe"].includes(targetType)) return livingOpponents;
  if (targetType === "ally_hpless") return selectResourceRatioTarget(livingAllies, "HP", false);
  if (targetType === "ALLaoe") return [...livingAllies, ...livingOpponents];
  if (targetType === "ALLrandom") return randomLivingTarget([...livingAllies, ...livingOpponents]);
  return selectCombatTargets(livingOpponents, targetType);
}

function monsterOpponentFormation() {
  return [...state.party].reverse();
}

function monsterSkillTargets(skill) {
  return resolveSkillTargetSet(null, skill.damage_target, state.enemies, monsterOpponentFormation());
}

function configuredSkillEffects(skill) {
  return [1, 2].map((index) => ({
    index,
    stat: skill[`effect${index}`],
    target: skill[`effect${index}_target`],
    value: skill[`effect${index}_value`],
    seconds: skill[`effect${index}_sec`],
  })).filter((effect) => effect.stat);
}

function parseConfiguredEffectValue(rawValue) {
  const text = String(rawValue ?? "").trim();
  const percentage = text.endsWith("%");
  const numericText = percentage ? text.slice(0, -1).trim() : text;
  const value = Number(numericText);
  return { percentage, value: Number.isFinite(value) ? value : 0, raw: text };
}

function parseDotEffectValue(rawValue, skill = {}, effect = {}) {
  const raw = String(rawValue ?? "").trim();
  const percentage = raw.endsWith("%");
  const numericText = percentage ? raw.slice(0, -1).trim() : raw;
  const numericValue = Number(numericText);
  const parsed = { raw, percentage, value: numericValue };
  if (raw && numericText && Number.isFinite(numericValue) && numericValue >= 0) return { ...parsed, valid: true };
  const warningKey = `invalid-dot:${skill.skill_id ?? skill.name ?? "unknown"}:${effect.index ?? "?"}:${parsed.raw}`;
  if (!runtimeWarningKeys.has(warningKey)) {
    runtimeWarningKeys.add(warningKey);
    console.warn(`[WARN] skill ${skill.skill_id ?? skill.name ?? "unknown"} effect${effect.index ?? "?"} has invalid DOT value: ${parsed.raw || "(blank)"}.`);
  }
  return { ...parsed, valid: false };
}

function baseAttributeValue(target, stat) {
  return Number(target?.[stat]) || 0;
}

function configuredEffectAmount(caster, skill, effect, target, context = {}) {
  const parsed = parseConfiguredEffectValue(effect.value);
  const referenceBonus = Number(context.effectReferenceBonus?.(effect, target) ?? 0) || 0;
  if (!parsed.percentage) return roundSigned(parsed.value + referenceBonus);
  if (effect.stat === "HP") return roundSigned((Math.max(0, Number(target.maxHp) || 0) * parsed.value / 100) + referenceBonus);
  if (effect.stat === "MP") return roundSigned((Math.max(0, Number(target.maxMp) || 0) * parsed.value / 100) + referenceBonus);
  const base = baseAttributeValue(target, effect.stat);
  return roundSigned(base * (parsed.value / 100 - 1) + referenceBonus);
}

function statusCasterEntityKey(caster) {
  if (!caster) return "unknown";
  if (caster.monster_id) return `monster:${caster.id ?? caster.monster_id}`;
  return `hero:${caster.classId ?? caster.id ?? caster.name}`;
}

function addTimedSkillEffect(target, caster, skill, effect, value, skillColor = null) {
  const seconds = Math.max(0, Number(effect.seconds) || 0);
  if (!(seconds > 0) || !value) return false;
  target.buffs ??= [];
  const casterEntityKey = statusCasterEntityKey(caster);
  const effectKey = `${casterEntityKey}:${skill.skill_id}:${effect.index}`;
  const existing = target.buffs.find((buff) => buff.effectKey === effectKey);
  const next = {
    effectKey, casterEntityKey, casterName: caster.name, sourceName: caster.name,
    skillId: skill.skill_id, skillName: skill.name, name: skill.name,
    skillColor: csvColor(skillColor || skill.skill_color, "#ededed"),
    effectIndex: effect.index, stat: effect.stat, value, effectAmount: value,
    duration: seconds, remaining: seconds,
  };
  if (existing) Object.assign(existing, next);
  else target.buffs.push(next);
  return true;
}

function addTimedDotEffect(target, caster, skill, effect, damagePerSecond, skillColor = null) {
  const seconds = Number(effect.seconds);
  const dps = Number(damagePerSecond);
  if (!(seconds > 0) || !(dps > 0) || !Number.isFinite(seconds) || !Number.isFinite(dps)) return false;
  target.buffs ??= [];
  const casterEntityKey = statusCasterEntityKey(caster);
  const effectKey = `${casterEntityKey}:${skill.skill_id}:${effect.index}`;
  const existing = target.buffs.find((buff) => buff.effectKey === effectKey);
  const next = {
    effectKey, casterEntityKey, casterName: caster.name, sourceName: caster.name,
    skillId: skill.skill_id, skillName: skill.name, name: skill.name,
    skillColor: csvColor(skillColor || skill.skill_color, "#ededed"),
    effectIndex: effect.index, stat: "DOT", statusKind: "DOT",
    value: -dps, effectAmount: -dps, snapshotDotDamagePerSecond: dps,
    dotRemainingDamage: dps * seconds, duration: seconds, remaining: seconds,
  };
  if (existing) Object.assign(existing, next);
  else target.buffs.push(next);
  return true;
}

function mainDamageForTarget(context, target) {
  return Math.max(0, Number(context.mainDamageByTarget?.get?.(target)) || 0);
}

function logAppliedDot(caster, skill, target, damagePerSecond, seconds, context = {}) {
  const dotText = `每秒受到 ${formatExactNumber(damagePerSecond)} 點持續傷害，持續 ${formatExactNumber(seconds)} 秒。`;
  addLog(`${caster.name} 的 ${skill.name} 使 ${target.name} ${dotText}`, {
    channel: context.channel, skillName: skill.name, skillColor: context.skillColor, dotText,
  });
}

function resolveDotCausedDeath(target, status) {
  if (!target || target.hp > 0 || !status) return false;
  if (state.roster.includes(target)) return handleHeroDeath(target, { kind: "dot", buff: status });
  const skillName = status.skillName || status.name || "持續傷害";
  const sourceName = status.sourceName || status.casterName || "未知來源";
  addLog(`${target.name} 被 ${sourceName} 的 ${skillName} 擊殺。`, {
    channel: state.enemies.includes(target) ? "monster" : "other",
    skillName, skillColor: status.skillColor,
  });
  if (state.enemies.includes(target)) defeatMonster(target);
  else target.buffs = [];
  return true;
}

function updateTimedSkillStatuses(unit, dt) {
  if (!unit || dt <= 0) return false;
  const next = [];
  let lethalDot = null;
  for (const status of unit.buffs ?? []) {
    const remaining = Math.max(0, Number(status.remaining) || 0);
    const activeSeconds = Math.min(dt, remaining);
    const updated = { ...status };
    if (status.statusKind === "DOT" && unit.hp > 0 && activeSeconds > 0) {
      const dps = Math.max(0, Number(status.snapshotDotDamagePerSecond) || 0);
      const storedRemaining = Number(status.dotRemainingDamage);
      const remainingDamage = Number.isFinite(storedRemaining) ? Math.max(0, storedRemaining) : dps * remaining;
      const damage = activeSeconds >= remaining - 1e-9 ? remainingDamage : Math.min(remainingDamage, dps * activeSeconds);
      unit.hp = Math.max(0, (Number(unit.hp) || 0) - damage);
      updated.dotRemainingDamage = Math.max(0, remainingDamage - damage);
      if (unit.hp <= 0) lethalDot = updated;
    }
    updated.remaining = remaining - dt;
    if (updated.remaining > 1e-9) next.push(updated);
    if (lethalDot) break;
  }
  unit.buffs = next;
  return lethalDot ? resolveDotCausedDeath(unit, lethalDot) : false;
}

function applyRecoveryAmount(target, resource, calculatedRecovery) {
  const currentKey = resource === "HP" ? "hp" : "mp";
  const maximumKey = resource === "HP" ? "maxHp" : "maxMp";
  const maximum = Math.max(0, Number(target?.[maximumKey]) || 0);
  const before = clamp(Number(target?.[currentKey]) || 0, 0, maximum);
  const calculated = Math.max(0, Number(calculatedRecovery) || 0);
  const actual = roundSigned(Math.min(calculated, Math.max(0, maximum - before)));
  const overflow = roundSigned(Math.max(0, calculated - actual));
  target[currentKey] = roundSigned(before + actual);
  return { resource, calculatedRecovery: roundSigned(calculated), actualRecovery: actual, overflowRecovery: overflow };
}

function recoveryResultText(result) {
  const overflowLabel = result.resource === "HP" ? "過量治療" : "過量回復";
  const overflow = result.overflowRecovery > 0 ? ` (${overflowLabel}+${formatExactNumber(result.overflowRecovery)})` : "";
  return `${result.resource} +${formatExactNumber(result.actualRecovery)}${overflow}`;
}

function logSkillRecovery(caster, skill, target, result, context = {}, critical = false) {
  const recoveryText = recoveryResultText(result);
  addLog(`${caster.name} 的 ${skill.name} 使 ${target.name} ${recoveryText}${critical ? "（暴擊）" : ""}。`, {
    channel: context.channel,
    skillName: skill.name,
    skillColor: context.skillColor,
    critical,
    recoveryText,
  });
}

function executeMonsterSkill(enemy, skill, skillColor) {
  const allies = state.enemies.filter((target) => target.hp > 0);
  const opponents = monsterOpponentFormation();
  const mainTargets = resolveSkillTargetSet(enemy, skill.damage_target, allies, opponents);
  let mainDamageTotal = 0;
  const mainDamageByTarget = new Map(mainTargets.map((target) => [target, 0]));
  if (["physical", "magic", "hybrid"].includes(skill.damage_type)) {
    for (const target of mainTargets) {
      const result = executeSkillDamageComponent(enemy, target, skill, { channel: "monster", skillColor, baseDamage: skill.base_damage });
      if (result.hit) {
        const actualDamage = Number(result.damageDealt) || 0;
        mainDamageTotal += actualDamage;
        mainDamageByTarget.set(target, actualDamage);
      }
    }
  }
  if (skill.damage_type === "heal") {
    for (const target of mainTargets.length ? mainTargets : [enemy]) {
      const result = calculateHeal(enemy, skill.base_damage, skill.multiplier / 100);
      const recovery = applyRecoveryAmount(target, "HP", result.amount);
      logSkillRecovery(enemy, skill, target, recovery, { channel: "monster", skillColor }, result.critical.isCritical);
    }
  }
  applyConfiguredSkillEffects(enemy, skill, { channel: "monster", skillColor, allies, opponents, mainTargets, mainDamageTotal, mainDamageByTarget, baseDamage: skill.base_damage });
}

function monsterEffectTargets(enemy, targetType) {
  return resolveSkillTargetSet(enemy, targetType, state.enemies, monsterOpponentFormation());
}

function skillEffectTargetLabel(targetType, targets) {
  if (targetType === "self") return "自己";
  if (targetType === "ally_aoe") return "友方全體人員";
  if (["aoe", "enemy_aoe"].includes(targetType)) return "敵方全體成員";
  if (targetType === "ALLaoe") return "戰場全體成員";
  return targets.map((target) => target.name).join("、");
}

function logAppliedSkillEffect(casterName, skill, effect, value, targets, skillColor, channel) {
  if (!targets.length) return;
  const targetLabel = skillEffectTargetLabel(effect.target, targets);
  addLog(`${casterName} 的 ${skill.name} 對 ${targetLabel} 造成 ${effect.stat} ${value >= 0 ? "+" : ""}${formatEnhancementValue(effect.stat, value)} 效果，持續 ${formatExactNumber(effect.seconds)} 秒。`,
    { channel, skillName: skill.name, skillColor });
}

function executeSkillDamageComponent(caster, target, skill, context = {}) {
  if (!target || target.hp <= 0 || !["physical", "magic", "hybrid"].includes(skill.damage_type)) return { hit: false };
  const avoidance = rollConfiguredAttackAvoidance(caster, target, skill.damage_type);
  if (avoidance.dodged) {
    addLog(`${caster.name} 的 ${skill.name} 被 ${target.name} ${avoidance.reason}。`, { channel: context.channel, skillName: skill.name, skillColor: context.skillColor });
    return { hit: false, dodged: true, target };
  }
  const result = calculateAttackDamage(caster, target, skill.damage_type, context.baseDamage ?? skill.base_damage, skill.multiplier / 100, Math.random, configuredArmorRate());
  const hpBefore = Math.max(0, Number(target.hp) || 0);
  target.hp = round(target.hp - result.damage);
  // Leech is based on HP that was actually removed; overkill damage cannot be absorbed.
  const damageDealt = roundSigned(Math.min(hpBefore, Math.max(0, Number(result.damage) || 0)));
  addLog(`${caster.name} 使用 ${skill.name}，對 ${target.name} 造成 ${result.damage} 點傷害${result.critical.isCritical ? "（暴擊）" : ""}。`,
    { channel: context.channel, skillName: skill.name, skillColor: context.skillColor, critical: result.critical.isCritical, damage: result.damage });
  if (target.hp <= 0) resolveSkillCausedDeath(target, caster, skill, result, context.channel);
  return { hit: true, target, ...result, damageDealt };
}

function resolveSkillCausedDeath(target, caster, skill, result = {}, channel = "other") {
  if (state.roster.includes(target)) return handleHeroDeath(target, { kind: "direct", sourceName: caster.name, skillName: skill.name, damage: result.damage ?? 0, critical: result.critical?.isCritical });
  if (state.enemies.includes(target)) { defeatMonster(target); return true; }
  addLog(`${target.name} 被 ${caster.name} 的 ${skill.name} 擊倒。`, { channel, skillName: skill.name });
  return true;
}

function applyDirectResourceEffect(caster, skill, effect, target, value, context) {
  const resource = effect.stat;
  const currentKey = resource.toLowerCase();
  const maximumKey = resource === "HP" ? "maxHp" : "maxMp";
  const maximum = Math.max(0, Number(target[maximumKey]) || 0);
  const before = Math.max(0, Number(target[currentKey]) || 0);
  if (value >= 0) {
    const recovery = applyRecoveryAmount(target, resource, value);
    logSkillRecovery(caster, skill, target, recovery, context);
    return recovery;
  }
  target[currentKey] = clamp(roundSigned(before + value), 0, maximum);
  const actual = roundSigned(target[currentKey] - before);
  addLog(`${caster.name} 的 ${skill.name} 使 ${target.name} ${resource} ${actual >= 0 ? "+" : ""}${formatExactNumber(actual)}。`,
    { channel: context.channel, skillName: skill.name, skillColor: context.skillColor });
  if (resource === "HP" && before > 0 && target.hp <= 0) resolveSkillCausedDeath(target, caster, skill, { damage: Math.abs(actual), critical: { isCritical: false } }, context.channel);
  return { resource, calculatedRecovery: value, actualRecovery: actual, overflowRecovery: 0 };
}

function applyConfiguredSkillEffects(caster, skill, context) {
  for (const effect of configuredSkillEffects(skill)) {
    if (effect.stat === "DMG") {
      const targets = resolveSkillTargetSet(caster, effect.target, context.allies, context.opponents, context.mainTargets);
      for (const target of targets) executeSkillDamageComponent(caster, target, skill, context);
      continue;
    }
    if (["HPleech", "MPleech"].includes(effect.stat)) {
      const parsed = parseConfiguredEffectValue(effect.value);
      const amount = parsed.percentage
        ? Math.max(0, Number(context.mainDamageTotal) || 0) * Math.max(0, parsed.value) / 100
        : Math.max(0, parsed.value);
      const resource = effect.stat === "HPleech" ? "HP" : "MP";
      applyDirectResourceEffect(caster, skill, { ...effect, stat: resource }, caster, roundSigned(amount), context);
      continue;
    }
    if (effect.stat === "DOT") {
      const parsed = parseDotEffectValue(effect.value, skill, effect);
      const seconds = Number(effect.seconds);
      if (!parsed.valid || !(seconds > 0) || !Number.isFinite(seconds)) continue;
      const targets = resolveSkillTargetSet(caster, effect.target, context.allies, context.opponents, context.mainTargets);
      for (const target of targets.filter((candidate) => candidate.hp > 0)) {
        const damagePerSecond = parsed.percentage ? mainDamageForTarget(context, target) * parsed.value / 100 : parsed.value;
        if (addTimedDotEffect(target, caster, skill, effect, damagePerSecond, context.skillColor)) {
          logAppliedDot(caster, skill, target, damagePerSecond, seconds, context);
        }
      }
      continue;
    }
    const targets = resolveSkillTargetSet(caster, effect.target, context.allies, context.opponents, context.mainTargets);
    if (["HP", "MP"].includes(effect.stat)) {
      for (const target of targets.filter((candidate) => candidate.hp > 0)) {
        const value = configuredEffectAmount(caster, skill, effect, target, context);
        applyDirectResourceEffect(caster, skill, effect, target, value, context);
      }
      continue;
    }
    const livingTargets = targets.filter((candidate) => candidate.hp > 0);
    for (const target of livingTargets) {
      const value = configuredEffectAmount(caster, skill, effect, target, context);
      if (addTimedSkillEffect(target, caster, skill, effect, value, context.skillColor)) logAppliedSkillEffect(caster.name, skill, effect, value, [target], context.skillColor, context.channel);
    }
  }
}

function updateItemCooldowns(hero, dt) {
  for (const itemId of Object.keys(hero.itemCooldowns ?? {})) hero.itemCooldowns[itemId] = Math.max(0, hero.itemCooldowns[itemId] - dt);
}

function maybeAutoUseRecovery(hero) {
  const settings = hero.recoverySettings ?? { hpEnabled: true, hpPercent: 20, hpItemId: null, mpEnabled: true, mpPercent: 20, mpItemId: null };
  if (settings.hpEnabled && hero.hp < hero.maxHp && hero.hp / hero.maxHp * 100 <= settings.hpPercent) tryAutoRecoveryEffect(hero, "HPrecover", settings.hpItemId);
  if (settings.mpEnabled && hero.mp < hero.maxMp && hero.maxMp > 0 && hero.mp / hero.maxMp * 100 <= settings.mpPercent) tryAutoRecoveryEffect(hero, "MPrecover", settings.mpItemId);
}

function tryAutoRecoveryEffect(hero, effect, selectedItemId = null) {
  const item = state.data.item.find((candidate) => (!selectedItemId || candidate.item_id === selectedItemId)
    && candidate.effect === effect
    && hasValidItemCooldown(candidate)
    && state.inventory.some((entry) => entry.itemId === candidate.item_id));
  if (!item || (hero.itemCooldowns[item.item_id] ?? 0) > 0) return false;
  return useRecoveryItem(hero, item, true).used;
}

function livingParty() { return state.party.filter((p) => p.hp > 0); }
function frontParty() { return [...state.party].reverse().find((p) => p.hp > 0); }

function enterTown(automatic = true) {
  const town = state.data.map.find((map) => map.map_id === "town001");
  if (!town) return;
  if (state.map?.map_id !== "town001") state.previousMapId = state.map?.map_id ?? state.previousMapId;
  state.map = town;
  state.townAutoReturn = Boolean(automatic);
  state.enemies = [];
  state.spawnElapsed = 0;
  const select = typeof document === "undefined" ? null : $("#map-select");
  if (select) { select.value = town.map_id; select.disabled = false; }
  syncMapPicker();
  addLog(automatic
    ? `隊伍全滅，返回 ${town.name}。五名角色開始復活與恢復。`
    : `隊伍前往 ${town.name}。將留在村莊，直到玩家自行選擇其他地圖。`);
}

function updateTownRecovery(dt) {
  if (dt <= 0) return;
  const townRate = clamp(Number(systemSettings().town_recover) || 0, 0, 100) / 100;
  for (const hero of state.roster) {
    if (updateTimedSkillStatuses(hero, dt)) continue;
    const hpRecovery = hero.maxHp * townRate + combatStat(hero, "HPR");
    const mpRecovery = hero.maxMp * townRate + combatStat(hero, "MPR");
    hero.hp = clamp(roundSigned(hero.hp + hpRecovery * dt), 0, hero.maxHp);
    hero.mp = clamp(roundSigned(hero.mp + mpRecovery * dt), 0, hero.maxMp);
  }
}

function allRosterRestored() {
  return state.roster.length > 0 && state.roster.every((hero) => hero.hp >= hero.maxHp && hero.mp >= hero.maxMp);
}

function returnFromTown() {
  const destination = state.data.map.find((map) => map.map_id === state.previousMapId && map.map_id !== "town001")
    ?? state.data.map.find((map) => map.map_id !== "town001" && map.max_monsters > 0);
  if (!destination) return;
  state.map = destination;
  state.townAutoReturn = false;
  state.enemies = [];
  state.spawnElapsed = destination.spawn_cd;
  const select = typeof document === "undefined" ? null : $("#map-select");
  if (select) { select.disabled = false; select.value = destination.map_id; }
  syncMapPicker();
  addLog(`五名角色的 HP、MP 已全滿，自動返回 ${destination.name}。`);
  spawnMonster();
}

function applyRegeneration(actor, dt) {
  if (actor.hp <= 0 || dt <= 0) return;
  const wasAlive = actor.hp > 0;
  const harmfulHpr = [...(actor.buffs ?? [])].reverse().find((buff) => buff.stat === "HPR" && Number(buff.value) < 0);
  const currentHpr = combatStat(actor, "HPR");
  const equipmentHpr = equipmentStatContribution(actor, "HPR");
  const equipmentCausedHprDrain = currentHpr < 0 && equipmentHpr < 0 && currentHpr - equipmentHpr >= 0;
  actor.hp = clamp(roundSigned(actor.hp + currentHpr * dt), 0, actor.maxHp);
  actor.mp = clamp(roundSigned(actor.mp + combatStat(actor, "MPR") * dt), 0, actor.maxMp);
  if (wasAlive && actor.hp <= 0) handleHeroDeath(actor, equipmentCausedHprDrain
    ? { kind: "equipment-hpr" }
    : { kind: "continuous", buff: harmfulHpr });
}

function updateHeroAction(actor, dt) {
  actor.cooldown -= dt;
  for (const skillId of Object.keys(actor.skillCooldowns)) actor.skillCooldowns[skillId] = Math.max(0, actor.skillCooldowns[skillId] - dt);
  if (updateTimedSkillStatuses(actor, dt)) return;
  if (actor.casting) {
    actor.casting.remaining -= dt;
    if (actor.casting.remaining <= 0) {
      const skill = actor.casting.skill; actor.casting = null;
      executeHeroSkill(actor, skill); actor.cooldown = Math.max(actor.cooldown, heroActionInterval(actor));
    }
    return;
  }
  if (actor.cooldown > 0 || !state.enemies[0]) return;
  const skill = selectHeroSkill(actor);
  if (skill) startHeroSkill(actor, skill);
  else actor.cooldown += .1;
}

function heroActionInterval(actor) {
  const actionsPerSecond = Math.max(.05, 1 + combatStat(actor, "ASPD") / 100);
  return 1 / actionsPerSecond;
}

function selectHeroSkill(actor) {
  return [...classSkills(actor)].sort((a, b) => a.use_priority - b.use_priority || skillIdOrder(a) - skillIdOrder(b)).find((skill) => actor.learnedSkillIds.has(skill.skill_id)
    && actor.skillEnabled[skill.skill_id] !== false
    && actor.level >= skill.level
    && actor.mp >= skill.cost
    && actor.mp > ensureSkillSetting(actor, skill).mpThreshold
    && (actor.skillCooldowns[skill.skill_id] ?? 0) <= 0
    && skillTriggerMet(actor, skill));
}

function skillTriggerMet(actor, skill) {
  const setting = ensureSkillSetting(actor, skill);
  if (["aoe", "enemy_aoe", "ALLaoe"].includes(skill.damage_target) && state.enemies.filter((enemy) => enemy.hp > 0).length < setting.enemyCountThreshold) return false;
  const triggerType = effectivePlayerTriggerType(skill);
  const selfDualTrigger = triggerType.match(SELF_DUAL_TRIGGER_PATTERN);
  if (selfDualTrigger) {
    const hpRatio = resourceRatio(actor, "HP");
    const mpRatio = resourceRatio(actor, "MP");
    if (hpRatio === null || mpRatio === null) return false;
    return triggerComparisonMatches(hpRatio, selfDualTrigger[1], setting.triggerHpValue)
      && triggerComparisonMatches(mpRatio, selfDualTrigger[2], setting.triggerMpValue);
  }
  const standardTrigger = triggerType.match(PLAYER_TRIGGER_PATTERN);
  if (standardTrigger) {
    const [, relation, resourceText, comparison] = standardTrigger;
    const candidates = relation === "enemy" ? state.enemies.filter((enemy) => enemy.hp > 0) : livingParty();
    const count = candidates.filter((unit) => {
      const ratio = resourceRatio(unit, resourceText.toUpperCase());
      return ratio !== null && triggerComparisonMatches(ratio, comparison, setting.triggerValue);
    }).length;
    return count >= setting.minTargets;
  }
  return !triggerType;
}

function startHeroSkill(actor, skill) {
  actor.mp = round(actor.mp - skill.cost);
  actor.skillCooldowns[skill.skill_id] = skill.cooldown;
  if (skill.cast_time > 0) {
    actor.casting = { skill, remaining: skill.cast_time };
    addLog(`${actor.name} 開始施放 ${skill.name}。`, { channel: "player", skillName: skill.name, skillColor: playerSkillLogColor(skill) });
  } else {
    executeHeroSkill(actor, skill); actor.cooldown += heroActionInterval(actor);
  }
}

function executeHeroSkill(actor, skill) {
  if (["physical", "magic", "hybrid"].includes(skill.damage_type)) executeDamageSkill(actor, skill);
  else if (skill.damage_type === "heal") executeHealSkill(actor, skill);
  else if (skill.damage_type === "buff") executeBuffSkill(actor, skill);
}

function skillTargets(actor, skill) {
  return resolveSkillTargetSet(actor, skill.damage_target, livingParty(), state.enemies);
}

function skillReferenceValue(actor, attribute) {
  if (!attribute || attribute === "EXP") return 0;
  const allowed = state.data?.attributeIndex?.some((row) => row.Attribute === attribute && row.Attribute !== "EXP");
  if (!allowed) return 0;
  return Number(combatStat(actor, attribute)) || 0;
}

function skillReferenceBonus(actor, skill) {
  if (!skill.effect_Attribute || skill.effect_multi === null || skill.effect_multi === undefined) return 0;
  return skillReferenceValue(actor, skill.effect_Attribute) * Number(skill.effect_multi);
}

function adjustedSkillBaseDamage(actor, skill) {
  return Number(skill.base_damage || 0) + skillReferenceBonus(actor, skill);
}

function executeDamageSkill(actor, skill) {
  const mainTargets = skillTargets(actor, skill);
  const context = { channel: "player", skillColor: playerSkillLogColor(skill), allies: livingParty(), opponents: state.enemies.filter((target) => target.hp > 0), mainTargets,
    baseDamage: adjustedSkillBaseDamage(actor, skill), effectReferenceBonus: () => skillReferenceBonus(actor, skill) };
  context.mainDamageTotal = 0;
  context.mainDamageByTarget = new Map(mainTargets.map((target) => [target, 0]));
  for (const target of mainTargets) {
    const result = executeSkillDamageComponent(actor, target, skill, context);
    if (result.hit) {
      const actualDamage = Number(result.damageDealt) || 0;
      context.mainDamageTotal += actualDamage;
      context.mainDamageByTarget.set(target, actualDamage);
    }
  }
  applyConfiguredSkillEffects(actor, skill, context);
}

function executeHealSkill(actor, skill) {
  const mainTargets = skillTargets(actor, skill);
  for (const target of mainTargets) {
    const result = calculateHeal(actor, skill.base_damage, skill.multiplier / 100);
    const skillColor = playerSkillLogColor(skill);
    const recovery = applyRecoveryAmount(target, "HP", result.amount);
    logSkillRecovery(actor, skill, target, recovery, { channel: "player", skillColor }, result.critical.isCritical);
  }
  applyConfiguredSkillEffects(actor, skill, { channel: "player", skillColor: playerSkillLogColor(skill), allies: livingParty(), opponents: state.enemies.filter((target) => target.hp > 0), mainTargets,
    baseDamage: adjustedSkillBaseDamage(actor, skill), effectReferenceBonus: () => skillReferenceBonus(actor, skill) });
}

function executeBuffSkill(actor, skill) {
  const mainTargets = skillTargets(actor, skill);
  applyConfiguredSkillEffects(actor, skill, { channel: "player", skillColor: playerSkillLogColor(skill), allies: livingParty(), opponents: state.enemies.filter((target) => target.hp > 0), mainTargets,
    baseDamage: adjustedSkillBaseDamage(actor, skill), effectReferenceBonus: () => skillReferenceBonus(actor, skill) });
}

function heroEffectTargets(actor, targetType) {
  return resolveSkillTargetSet(actor, targetType, livingParty(), state.enemies);
}

function applyHeroSkillEffects(actor, skill) {
  const mainTargets = skillTargets(actor, skill);
  applyConfiguredSkillEffects(actor, skill, { channel: "player", skillColor: playerSkillLogColor(skill), allies: livingParty(), opponents: state.enemies.filter((target) => target.hp > 0), mainTargets,
    baseDamage: adjustedSkillBaseDamage(actor, skill), effectReferenceBonus: () => skillReferenceBonus(actor, skill) });
}

function playerAttack(actor, enemy) {
  const isMagic = actor.attackType === "magic";
  const damageType = isMagic ? "magic" : "physical";
  const avoidance = rollConfiguredAttackAvoidance(actor, enemy, damageType);
  if (avoidance.dodged) { addLog(`${actor.name} 的攻擊被 ${enemy.name} ${avoidance.reason}。`, { channel: "player" }); return; }
  const result = calculateAttackDamage(actor, enemy, damageType, 0, 1, Math.random, configuredArmorRate());
  enemy.hp = round(enemy.hp - result.damage); addLog(`${actor.name} 對 ${enemy.name} 造成 ${result.damage} 點傷害${result.critical.isCritical ? "（暴擊）" : ""}。`,
    { channel: "player", critical: result.critical.isCritical, damage: result.damage });
  if (enemy.hp <= 0) defeatMonster(enemy);
}

function monsterAttack(enemy, target) {
  const damageType = enemy.attack_type === "magic" ? "magic" : enemy.attack_type === "hybrid" ? "hybrid" : "physical";
  const avoidance = rollConfiguredAttackAvoidance(enemy, target, damageType);
  if (avoidance.dodged) { addLog(`${enemy.name} 的攻擊被 ${target.name} ${avoidance.reason}。`, { channel: "monster" }); return; }
  const basicSkill = damageType === "hybrid"
    ? state.data.skill.find((skill) => skill.damage_type === "hybrid" && skill.name === "普通攻擊")
    : state.data.skill.find((skill) => skill.skill_id === (damageType === "magic" ? "sk002" : "sk001"));
  const result = calculateAttackDamage(enemy, target, damageType, basicSkill?.base_damage ?? 0, basicSkill?.multiplier ? basicSkill.multiplier / 100 : 1, Math.random, configuredArmorRate());
  target.hp = round(target.hp - result.damage); addLog(`${enemy.name} 攻擊前排 ${target.name}，造成 ${result.damage} 傷害${result.critical.isCritical ? "（暴擊）" : ""}。`,
    { channel: "monster", critical: result.critical.isCritical, damage: result.damage });
  if (target.hp <= 0) handleHeroDeath(target, { kind: "direct", sourceName: enemy.name, skillName: "攻擊", damage: result.damage, critical: result.critical.isCritical });
}

function clearHeroStatuses(hero) {
  hero.buffs = [];
  hero.casting = null;
  recalculateHeroStats(hero);
  hero.hp = 0;
}

function calculateDeathExpLoss(currentExp, penaltyPercent) {
  const experience = Math.max(0, Number(currentExp) || 0);
  const penalty = clamp(Number(penaltyPercent) || 0, 0, 100);
  return Math.floor(experience * penalty / 100);
}

function applyDeathExperiencePenalty(hero) {
  const loss = calculateDeathExpLoss(hero?.exp, systemSettings().Death_EXP_Penalty);
  if (!hero || loss <= 0) return 0;
  hero.exp = Math.max(0, hero.exp - loss);
  return loss;
}

function handleHeroDeath(hero, context = {}) {
  if (!hero || hero.hp > 0) return false;
  const buff = context.buff;
  const expLoss = applyDeathExperiencePenalty(hero);
  clearHeroStatuses(hero);
  if (context.kind === "direct" && context.sourceName) {
    addLog(`${context.sourceName}使用${context.skillName || "攻擊"}造成${formatExactNumber(context.damage)}點傷害，殺死了${hero.name}。`, {
      channel: "player", skillName: context.skillName, critical: context.critical, damage: context.damage,
    });
  } else if (context.kind === "equipment-hpr") {
    addLog(`${hero.name} 想要穿著鐵處女變強，沒想到他就這樣離開了大家。`, { channel: "player" });
  } else if (context.kind === "dot" && buff?.sourceName && (buff.skillName || buff.name)) {
    addLog(`${hero.name} 被 ${buff.sourceName} 的 ${buff.skillName || buff.name} 擊殺。`, {
      channel: "player", skillName: buff.skillName || buff.name, skillColor: buff.skillColor,
    });
  } else if (context.kind === "continuous" && buff?.sourceName && (buff.skillName || buff.name)) {
    addLog(`${buff.sourceName} 對${hero.name} 使用 ${buff.skillName || buff.name} 造成了持續性傷害以致死亡。`, {
      channel: "player", skillName: buff.skillName || buff.name,
    });
  } else {
    addLog(`${hero.name}受到神秘力量導致 HP 持續降低的影響而安靜的倒下了。`, { channel: "player" });
  }
  if (expLoss > 0) {
    const deathPenaltyText = `經驗值 ${expLoss}`;
    addLog(`${hero.name} 死亡了，損失${deathPenaltyText}`, { channel: "player", deathPenaltyText });
  }
  return true;
}

function defeatMonster(enemy) {
  const index = state.enemies.findIndex((e) => e.id === enemy.id); if (index < 0) return;
  enemy.buffs = []; enemy.casting = null;
  state.enemies.splice(index, 1);
  const gold = multipliedGoldReward(randomInt(enemy.gold_min, enemy.gold_max));
  state.gold += gold;
  const sharedExp = Math.ceil(enemy.level * 10 / 3);
  for (const hero of livingParty()) {
    const overLevel = hero.level - enemy.level;
    const rate = overLevel <= 3 ? 1 : clamp(1 - (overLevel - 3) * .1, 0, 1);
    const penalizedExp = Math.ceil(sharedExp * rate);
    gainExperience(hero, multipliedExperienceReward(penalizedExp));
  }
  rollDrops(enemy); addLog(`${enemy.name} 被擊倒，獲得 ${gold} 金幣。`, { channel: "monster" });
  if (!state.enemies.length) spawnMonster();
}

function requiredExpFor(level) {
  return state.data.playerLevel.find((row) => row.level === level)?.required_exp ?? null;
}

function gainExperience(hero, amount) {
  if (hero.level >= 100 || amount <= 0) return;
  hero.exp += amount;
  let leveled = false;
  while (hero.level < 100) {
    const required = requiredExpFor(hero.level);
    if (!required || hero.exp < required) break;
    hero.exp -= required;
    hero.level += 1;
    applyLevelGrowth(hero);
    leveled = true;
    addLog(`${hero.name} 升到 Lv.${hero.level}。`);
  }
  if (hero.level >= 100) hero.exp = 0;
  if (leveled) { updateMapLocks(); updateCharacterControls(); }
}

function applyLevelGrowth(hero) {
  const oldMaxHp = hero.maxHp;
  const oldMaxMp = hero.maxMp;
  for (const key of ATTRIBUTE_KEYS) hero.attributes[key] += hero.levelPlan[key];
  const attr = effectiveAttributes(hero);
  const rolled = [];
  for (const rule of state.data.characterAttribute) {
    if (!rule.Enhance_Attribute || rule.Enhance_min === null || rule.Enhance_max === null) continue;
    const amount = rollAttributeGrowth(attr[rule.Attribute] ?? 0, attr.LUK ?? 0, rule.Enhance_min, rule.Enhance_max);
    hero.growthStats[rule.Enhance_Attribute] = round((hero.growthStats[rule.Enhance_Attribute] ?? 0) + amount);
    rolled.push(`${rule.Enhance_Attribute} Roll +${amount}`);
  }
  recalculateHeroStats(hero);
  hero.hp = round(Math.min(hero.maxHp, hero.hp + (hero.maxHp - oldMaxHp)));
  hero.mp = round(Math.min(hero.maxMp, hero.mp + (hero.maxMp - oldMaxMp)));
  addLog(`${hero.name} 成長：HP +${round(hero.maxHp - oldMaxHp)}、MP +${round(hero.maxMp - oldMaxMp)}${rolled.length ? `（${rolled.join("、")}）` : ""}。`);
}

function rollAttributeGrowth(points, luck, min, max) {
  let total = 0;
  for (let point = 0; point < Math.floor(points); point++) total += luckyGrowthRoll(luck, min, max);
  return round(total);
}

function luckyGrowthRoll(luck, min, max) {
  const rolls = luckyRollCount(luck);
  let best = min;
  for (let rollIndex = 0; rollIndex < rolls; rollIndex++) best = Math.max(best, randomInt(Math.round(min * 10), Math.round(max * 10)) / 10);
  return best;
}

function rollDrops(enemy) {
  const avgLevel = state.party.reduce((s, p) => s + p.level, 0) / state.party.length;
  const totalLuck = state.party.reduce((sum, hero) => sum + Number(combatStat(hero, "LUK")), 0);
  const levelDiff = Math.round((avgLevel - enemy.level) * 10) / 10;
  const rollLootTable = (lootId, rawMultiplier, label) => {
    if (!lootId) return;
    const multiplier = Number(rawMultiplier);
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      const warningKey = `loot:${enemy.monster_id}:${label}`;
      if (!runtimeWarningKeys.has(warningKey)) {
        runtimeWarningKeys.add(warningKey);
        console.warn(`[WARN] monster ${enemy.monster_id} has ${label}_id but invalid ${label}_multiplier.`);
      }
      return;
    }
    for (const drop of state.data.lootDrops.filter((row) => row.loot_id === lootId)) {
      const rate = calculatedItemDropRate(drop.base_drop_rate * multiplier, totalLuck, levelDiff);
      if (Math.random() * 100 < rate) receiveDrop(drop, randomInt(drop.quantity_min, drop.quantity_max), enemy.name);
    }
  };
  rollLootTable(enemy.loot_id, enemy.loot_multiplier, "loot");
  rollLootTable(enemy.loot2_id, enemy.loot2_multiplier, "loot2");
  const specialDrops = state.data.specialLoot.filter((row) => row.monster_id === enemy.monster_id);
  for (const drop of specialDrops) {
    const rate = calculatedItemDropRate(drop.base_drop_rate, totalLuck, levelDiff);
    if (Math.random() * 100 < rate) receiveDrop(drop, randomInt(drop.quantity_min, drop.quantity_max), enemy.name);
  }
}

function receiveDrop(drop, quantity, source) {
  const itemName = catalogItem(drop.item_id)?.item_name ?? drop.item_name ?? drop.item_id;
  const result = addInventoryItem(drop.item_id, itemName, quantity, { autoSell: true });
  const text = result.autoSold
    ? `自動賣出 ${itemName} × ${quantity}，獲得 ${result.gold} 金幣`
    : `${itemName} × ${quantity}`;
  if (result.autoSold) addLog(`${source} 掉落 ${itemName} × ${quantity}，已自動賣出並獲得 ${result.gold} 金幣。`, { channel: "other" });
  state.drops.unshift({ text, source }); state.drops = state.drops.slice(0, 40);
}

function addInventoryItem(itemId, name, quantity, options = {}) {
  quantity = Math.max(0, Math.trunc(Number(quantity) || 0));
  const canStack = state.data.item.some((item) => item.item_id === itemId);
  const isEquipment = state.data.equipment.some((item) => item.item_id === itemId);
  const price = itemSellPrice(catalogItem(itemId));
  const protectedStack = canStack && state.inventory.some((item) => item.itemId === itemId && item.locked);
  if (quantity > 0 && options.autoSell && state.autoSellItemIds.has(itemId) && price !== null && !protectedStack) {
    const gold = price * quantity;
    state.gold += gold;
    return { autoSold: true, quantity, gold };
  }
  if (canStack) {
    const stack = state.inventory.find((item) => item.itemId === itemId);
    if (stack) stack.quantity += quantity;
    else {
      const inventoryIndex = firstFreeInventoryIndex();
      if (inventoryIndex < 0) return { autoSold: false, quantity: 0, gold: 0, full: true };
      state.inventory.push({ key: itemId, itemId, name, quantity, inventoryIndex, isEquipment: false });
    }
    renderInventoryPagination();
    return { autoSold: false, quantity, gold: 0 };
  }
  let added = 0;
  for (let index = 0; index < quantity; index++) {
    const inventoryIndex = firstFreeInventoryIndex();
    if (inventoryIndex < 0) break;
    state.inventory.push({ ...normalizeEquipmentInstance({ itemId }), inventoryIndex, name, quantity: 1, isEquipment });
    added++;
  }
  renderInventoryPagination();
  return { autoSold: false, quantity: added, gold: 0, full: added < quantity };
}

async function useInventoryCell(visibleIndex) {
  const inventoryIndex = state.inventoryPage * state.inventoryPageCapacity + visibleIndex;
  if (state.rightPage === "warehouse" && state.warehouseMode === "big") { await transferInventoryToBigStorage(inventoryIndex); return; }
  const result = useInventoryItem(inventoryIndex);
  if (result.message) addLog(result.message);
  if (result.equipmentChanged) showEquipment(state.equipmentCharacter);
  render();
  if ($("#skill-dialog")?.open) renderSkillPanel();
}

function useInventoryItem(inventoryIndex) {
  const arrayIndex = state.inventory.findIndex((entry) => entry.inventoryIndex === inventoryIndex);
  const inventoryItem = arrayIndex >= 0 ? state.inventory[arrayIndex] : null;
  if (!inventoryItem) return { used: false, message: "" };
  if (inventoryItem.isEquipment) {
    const hero = state.party.find((member) => member.slot === state.equipmentCharacter);
    const item = state.data.equipment.find((row) => row.item_id === inventoryItem.itemId);
    if (!hero || !item) return { used: false, message: `${inventoryItem.name} 的裝備資料不存在。` };
    if (item.allowed_class !== "all" && !String(item.allowed_class ?? "").split("|").includes(hero.classId)) {
      return { used: false, message: `${hero.name} 無法裝備 ${item.item_name}。` };
    }
    if (hero.level < (item.item_level ?? 1)) return { used: false, message: `${hero.name} 需要 Lv.${item.item_level} 才能裝備 ${item.item_name}。` };
    const editSet = editedEquipmentSet(hero);
    const equipment = equipmentConfig(hero, editSet);
    const slotKey = findEquipmentSlot(hero, item, editSet);
    if (!slotKey) return { used: false, message: `${item.item_name} 沒有對應的裝備欄位。` };
    const replaced = equipment[slotKey];
    const conflictSlot = findWeaponShieldConflict(hero, item, editSet);
    const conflict = conflictSlot ? equipment[conflictSlot] : null;
    const returnedNames = [];
    state.inventory.splice(arrayIndex, 1);
    let returnIndex = inventoryIndex;
    if (replaced) {
      returnedNames.push(state.data.equipment.find((row) => row.item_id === replaced.itemId)?.item_name ?? replaced.itemId);
      returnEquippedItemToInventory(replaced, returnIndex++);
    }
    if (conflict) {
      returnedNames.push(state.data.equipment.find((row) => row.item_id === conflict.itemId)?.item_name ?? conflict.itemId);
      returnEquippedItemToInventory(conflict, returnIndex++);
      delete equipment[conflictSlot];
    }
    compactInventory();
    equipment[slotKey] = normalizeEquipmentInstance(inventoryItem);
    recalculateHeroStats(hero);
    return { used: true, equipmentChanged: true, hero, item, message: `${hero.name} 的 Set ${editSet} 裝備 ${item.item_name}${returnedNames.length ? `，${returnedNames.join("、")}已放回道具欄` : ""}。` };
  }
  const item = state.data.item.find((row) => row.item_id === inventoryItem.itemId);
  if (["HPrecover", "MPrecover"].includes(item?.effect)) {
    const hero = state.party.find((member) => member.slot === state.equipmentCharacter);
    return useRecoveryItem(hero, item, false);
  }
  if (item?.effect !== "learn_skill") return { used: false, message: `${inventoryItem.name} 的使用功能尚未開放。` };
  const hero = state.roster.find((member) => member.classId === item.target);
  const skill = state.data.characterSkills.find((row) => row.skill_id === item.skill_id && row.class_id === item.target);
  if (!hero || !skill) return { used: false, message: `${inventoryItem.name} 沒有可學習的適用角色。` };
  if (hero.level < skill.level) return { used: false, message: `${hero.name} 需要 Lv.${skill.level} 才能學習 ${skill.name}。` };
  if (hero.learnedSkillIds.has(skill.skill_id)) return { used: false, message: `${hero.name} 已經學會 ${skill.name}。` };
  if (!learnSkill(hero, skill.skill_id)) return { used: false, message: `${skill.name} 學習失敗。` };
  if (inventoryItem.quantity > 1) inventoryItem.quantity -= 1; else removeInventoryEntryAt(arrayIndex);
  return { used: true, hero, skill, message: `${hero.name} 使用技能書，學會 ${skill.name}。` };
}

function useRecoveryItem(hero, item, automatic = false) {
  if (!hero || hero.hp <= 0) return { used: false, message: "倒下的角色無法使用恢復道具。" };
  const cooldown = Number(item.cooldown);
  if (!hasValidItemCooldown(item)) return { used: false, message: `${item.item_name} 缺少 item.csv cooldown 秒數，暫時無法使用。` };
  if ((hero.itemCooldowns[item.item_id] ?? 0) > 0) return { used: false, message: `${hero.name} 的 ${item.item_name} 尚在冷卻中。` };
  const isHp = item.effect === "HPrecover";
  const current = isHp ? hero.hp : hero.mp;
  const maximum = isHp ? hero.maxHp : hero.maxMp;
  if (current >= maximum) return { used: false, message: `${hero.name} 的 ${isHp ? "HP" : "MP"} 已滿。` };
  const inventoryIndex = state.inventory.findIndex((entry) => entry.itemId === item.item_id);
  if (inventoryIndex < 0) return { used: false, message: `背包中沒有 ${item.item_name}。` };
  const amount = randomInt(Number(item.effect_value_min) || 0, Number(item.effect_value_max) || 0);
  const restored = round(Math.min(amount, maximum - current));
  if (isHp) hero.hp = round(hero.hp + restored); else hero.mp = round(hero.mp + restored);
  const entry = state.inventory[inventoryIndex];
  if ((entry.quantity ?? 1) > 1) entry.quantity -= 1; else removeInventoryEntryAt(inventoryIndex);
  hero.itemCooldowns[item.item_id] = cooldown;
  const message = `${hero.name}${automatic ? "自動" : ""}使用 ${item.item_name}，恢復 ${restored} ${isHp ? "HP" : "MP"}。`;
  if (automatic) addLog(message, { channel: "player" });
  return { used: true, hero, item, message: automatic ? "" : message };
}

function returnEquippedItemToInventory(equipped, preferredIndex = null) {
  const item = state.data.equipment.find((row) => row.item_id === equipped.itemId);
  if (!item) return -1;
  const inventoryIndex = firstFreeInventoryIndex(preferredIndex);
  if (inventoryIndex < 0) return -1;
  const entry = { ...normalizeEquipmentInstance(equipped), inventoryIndex, name: item.item_name, quantity: 1, isEquipment: true };
  state.inventory.push(entry);
  renderInventoryPagination();
  return inventoryIndex;
}

function findWeaponShieldConflict(hero, item, setNumber = hero?.activeEquipmentSet) {
  const equipment = equipmentConfig(hero, setNumber);
  if (item.weapon_type === "two_hand_weapon" && equipment.shield_1) return "shield_1";
  if (item.EQ_position !== "shield" || !equipment.weapon_1) return null;
  const weapon = state.data.equipment.find((row) => row.item_id === equipment.weapon_1.itemId);
  return weapon?.weapon_type === "two_hand_weapon" ? "weapon_1" : null;
}

function unequipItem(characterSlot, equipmentSlot) {
  const hero = state.party.find((member) => member.slot === characterSlot);
  const returnedIndex = firstFreeInventoryIndex();
  if (returnedIndex < 0) { addLog("背包已滿，無法卸下裝備。"); return false; }
  const editSet = hero ? editedEquipmentSet(hero) : 1;
  const item = takeOffEquipment(hero, equipmentSlot, editSet, returnedIndex);
  if (!item) return false;
  selectInventoryPage(Math.floor(returnedIndex / state.inventoryPageCapacity));
  addLog(`${hero.name} 從 Set ${editSet} 卸下 ${item.item_name}，已放入道具欄。`);
  showEquipment(characterSlot);
  render();
  return true;
}

function takeOffEquipment(hero, equipmentSlot, setNumber = hero?.activeEquipmentSet, preferredIndex = null) {
  const equipment = equipmentConfig(hero, setNumber);
  const equipped = equipment[equipmentSlot];
  if (!hero || !equipped) return null;
  const item = state.data.equipment.find((row) => row.item_id === equipped.itemId);
  if (returnEquippedItemToInventory(equipped, preferredIndex) < 0) return null;
  delete equipment[equipmentSlot];
  recalculateHeroStats(hero);
  return item ?? { item_name: equipped.itemId };
}

const validLogColor = csvColor;

function escapeLogText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function coloredLogHtml(text, meta = {}) {
  const source = String(text);
  const tokens = [];
  const addToken = (token, color, className, priority = 1) => {
    if (!token || !source.includes(String(token))) return;
    tokens.push({ token: String(token), color: validLogColor(color), className, priority });
  };
  for (const hero of state.roster ?? []) {
    for (const name of new Set([hero.name, hero.customName, hero.className].filter(Boolean))) addToken(name, gameColor("player_name"), "log-player", 4);
  }
  for (const monster of state.data?.monsters ?? []) {
    addToken(monster.name, monster.category === "boss" ? gameColor("monster_boss") : gameColor("monster_normal"), `log-monster log-monster-${monster.category}`, 3);
  }
  addToken(meta.skillName, csvColor(meta.skillColor, "#ededed"), "log-skill", 6);
  addToken("閃避", gameColor("dodge"), "log-dodge", 8);
  addToken("暴擊", gameColor("critical_hit"), "log-critical", 9);
  if (meta.critical && meta.damage !== null && meta.damage !== undefined) addToken(formatExactNumber(meta.damage), gameColor("critical_hit"), "log-critical-damage", 7);
  addToken(meta.recoveryText, indexedColor("right_heal_color", "#00FF00"), "log-recovery", 10);
  addToken(meta.dotText, indexedColor("right_DOT_color", "#FF007F"), "log-dot", 10);
  addToken(meta.deathPenaltyText, indexedColor("Death_Penalty_color"), "log-death-penalty", 10);

  const candidates = [];
  for (const token of tokens) {
    let start = 0;
    while ((start = source.indexOf(token.token, start)) >= 0) {
      candidates.push({ ...token, start, end: start + token.token.length });
      start += token.token.length;
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.priority - a.priority || b.token.length - a.token.length);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((range) => candidate.start < range.end && candidate.end > range.start)) continue;
    selected.push(candidate);
  }
  selected.sort((a, b) => a.start - b.start);
  let cursor = 0;
  let html = "";
  for (const token of selected) {
    html += escapeLogText(source.slice(cursor, token.start));
    html += `<span class="${token.className}" style="color:${token.color}">${escapeLogText(source.slice(token.start, token.end))}</span>`;
    cursor = token.end;
  }
  return html + escapeLogText(source.slice(cursor));
}

function normalizeLogNumbers(text) {
  return String(text).replace(/(-?\d+\.\d{2,})/g, (value) => formatExactNumber(Number(value)));
}

function appendLogEntry(log, text, meta) {
  if (!log) return;
  const li = document.createElement("li");
  const message = coloredLogHtml(text, meta);
  const coloredMessage = meta.messageColor ? `<span style="color:${validLogColor(meta.messageColor)}">${message}</span>` : message;
  li.innerHTML = `<time>${formatTime(state.elapsed)}</time>${coloredMessage}`;
  log.prepend(li);
  while (log.children.length > 500) log.lastElementChild.remove();
  log.scrollTop = 0;
}

function addLog(text, meta = {}) {
  const normalizedText = normalizeLogNumbers(text);
  const channel = ["player", "monster", "other"].includes(meta.channel) ? meta.channel : "other";
  appendLogEntry($("#battle-log"), normalizedText, meta);
  appendLogEntry($(`#battle-log-${channel}`), normalizedText, meta);
}
function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }

function render() {
  applyCsvColorTheme();
  renderPartyUnits($("#party")); renderUnits($("#enemies"), state.enemies, true);
  if ($("#character-info-dialog")?.open) renderCharacterInfoPanel();
  const inTown = state.map?.map_id === "town001";
  $("#team-name").textContent = state.teamName;
  $("#gold").textContent = state.gold.toLocaleString(); $("#status").textContent = state.paused ? "已暫停" : inTown ? "村莊恢復中" : !livingParty().length ? "隊伍全滅" : "戰鬥中";
  $("#spawn-timer").textContent = inTown ? "全員休息中" : state.enemies.length >= state.map?.max_monsters ? "敵群已滿" : `增援 ${Math.max(0, (state.map?.spawn_cd ?? 0) - state.spawnElapsed).toFixed(1)}s`;
  $("#drop-log").innerHTML = state.drops.length ? state.drops.map((d) => `<li><strong>${d.text}</strong><br><small>${d.source}</small></li>`).join("") : '<li class="empty">尚無掉落</li>';
  renderInventory(); renderShop(); if (state.rightPage === "warehouse") renderWarehouse(); if ($("#collection-dialog")?.open) renderCollectionDialog();
  if ($("#status-dialog")?.open) renderStatusDialog();
  renderRewardButton();
}

function statusEffectText(status) {
  const amount = Number(status.effectAmount ?? status.value) || 0;
  const effectText = status.statusKind === "DOT"
    ? `每秒 HP -${formatExactNumber(status.snapshotDotDamagePerSecond)}`
    : `${status.stat} ${amount >= 0 ? "+" : ""}${formatEnhancementValue(status.stat, amount)}`;
  return `${status.casterName ?? status.sourceName ?? "未知來源"} | ${status.skillName ?? status.name ?? status.skillId ?? "未知技能"} | ${effectText} (${Math.max(0, Math.ceil(Number(status.remaining) || 0))}s)`;
}

function statusSkillColor(status) {
  if (/^#[0-9a-f]{6}$/i.test(String(status?.skillColor ?? ""))) return status.skillColor;
  const skillId = status?.skillId;
  if (!skillId) return "#ededed";
  if (String(status?.casterEntityKey ?? "").startsWith("monster:")) {
    return csvColor(state.data.monsterSkills.find((row) => row.skill_id === skillId)?.skill_color, "#ededed");
  }
  return csvColor(state.data.characterSkills.find((row) => row.skill_id === skillId)?.skill_color, "#ededed");
}

function statusGroups(unit) {
  const active = (unit?.buffs ?? []).filter((status) => Number(status.remaining) > 0 && Number(status.effectAmount ?? status.value) !== 0);
  return {
    buff: active.filter((status) => Number(status.effectAmount ?? status.value) > 0),
    debuff: active.filter((status) => Number(status.effectAmount ?? status.value) < 0),
  };
}

function openStatusDialog() {
  renderStatusDialog();
  const dialog = $("#status-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderStatusSummary(card, unit) {
  const groups = statusGroups(unit);
  for (const kind of ["buff", "debuff"]) {
    const container = card.querySelector(`[data-status-kind="${kind}"]`);
    if (!container) continue;
    const statuses = groups[kind];
    const visible = statuses.length > 5 ? statuses.slice(0, 4) : statuses;
    const chips = visible.map((status) => {
      const chip = document.createElement("span");
      chip.className = `status-chip ${kind}`;
      chip.textContent = String(Math.max(0, Math.ceil(Number(status.remaining) || 0)));
      chip.title = statusEffectText(status);
      chip.setAttribute("aria-label", statusEffectText(status));
      return chip;
    });
    if (statuses.length > 5) {
      const overflow = document.createElement("span");
      overflow.className = `status-chip ${kind} overflow`;
      overflow.textContent = `+${statuses.length - 4}`;
      overflow.title = `另有 ${statuses.length - 4} 個${kind === "buff" ? " Buff" : " Debuff"}`;
      chips.push(overflow);
    }
    container.replaceChildren(...chips);
  }
}

function renderStatusDetailRow(status) {
  const amount = Number(status.effectAmount ?? status.value) || 0;
  const row = document.createElement("p"); row.className = "status-detail";
  const caster = document.createElement("span"); caster.textContent = status.casterName ?? status.sourceName ?? "未知來源";
  const skill = document.createElement("span"); skill.textContent = status.skillName ?? status.name ?? status.skillId ?? "未知技能"; skill.style.color = statusSkillColor(status);
  const effect = document.createElement("span"); effect.textContent = status.statusKind === "DOT"
    ? `每秒 HP -${formatExactNumber(status.snapshotDotDamagePerSecond)}`
    : `${status.stat} ${amount >= 0 ? "+" : ""}${formatEnhancementValue(status.stat, amount)}`;
  effect.style.color = indexedColor(amount >= 0 ? "buff_color" : "debuff_color", amount >= 0 ? "#00FFFF" : "#FF0000");
  const seconds = document.createElement("span"); seconds.textContent = `(${Math.max(0, Math.ceil(Number(status.remaining) || 0))}s)`;
  seconds.style.color = indexedColor("buff_sec_color", "#FFFF00");
  row.append(caster, skill, effect, seconds);
  return row;
}

function renderStatusEntity(container, unit, fallbackName) {
  const section = document.createElement("section"); section.className = "status-entity";
  const heading = document.createElement("h4"); heading.textContent = unit?.name ?? fallbackName;
  section.append(heading);
  const groups = statusGroups(unit);
  for (const statuses of [groups.buff, groups.debuff]) {
    const group = document.createElement("div"); group.className = "status-effect-group";
    for (const status of statuses) group.append(renderStatusDetailRow(status));
    section.append(group);
  }
  if (!groups.buff.length && !groups.debuff.length) {
    const empty = document.createElement("span"); empty.className = "status-empty"; empty.textContent = "無狀態"; section.querySelector(".status-effect-group").append(empty);
  }
  container.append(section);
}

function renderStatusDialog() {
  const grid = $("#status-dialog-grid"); if (!grid) return;
  grid.replaceChildren();
  for (let index = 0; index < 3; index++) renderStatusEntity(grid, state.party[index], `玩家位置 ${index + 1}`);
  for (let index = 0; index < 3; index++) renderStatusEntity(grid, state.enemies[index], `敵方位置 ${index + 1}（空）`);
}

function setupStatusPanel() {
  $("#status-dialog-open").addEventListener("click", openStatusDialog);
  $("#status-dialog-close").addEventListener("click", () => $("#status-dialog").close());
}

function renderPartyUnits(container) {
  for (const [index, unit] of state.party.entries()) {
    let card = container.children[index];
    if (!card) {
      card = $("#unit-template").content.firstElementChild.cloneNode(true);
      const select = card.querySelector(".party-slot-select");
      select.addEventListener("change", () => changePartyMember(select.dataset.slot, select.value));
      card.querySelector(".portrait").remove();
      container.append(card);
    }
    card.dataset.partySlot = unit.slot;
    const select = card.querySelector(".party-slot-select");
    select.dataset.slot = unit.slot;
    select.setAttribute("aria-label", `${unit.slot} 位置職業`);
    const available = state.roster.filter((hero) => hero === unit || !hero.slot);
    const signature = available.map((hero) => `${hero.classId}:${hero.level}`).join("|");
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...available.map((hero) => {
        const option = document.createElement("option");
        option.value = hero.classId;
        option.textContent = `${hero.className} Lv.${hero.level}`;
        return option;
      }));
      select.dataset.signature = signature;
    }
    select.value = unit.classId;
    card.classList.toggle("front", unit === frontParty());
    card.classList.toggle("dead", unit.hp <= 0);
    card.querySelector("strong").textContent = unit.name;
    card.querySelector(".unit-level").textContent = `Lv.${unit.level}`;
    setBar(card, ".hp", unit.hp, unit.maxHp, "HP");
    setBar(card, ".mp", unit.mp, unit.maxMp, "MP");
    if (unit.level >= 100) setMaxLevelBar(card);
    else setBar(card, ".exp", unit.exp, requiredExpFor(unit.level) ?? 1, "EXP", true);
    renderStatusSummary(card, unit);
  }
  while (container.children.length > state.party.length) container.lastElementChild.remove();
}

function renderInventory() {
  const cells = [...$("#inventory-grid").children];
  const start = state.inventoryPage * state.inventoryPageCapacity;
  cells.forEach((cell, index) => {
    const item = inventoryEntryAt(start + index);
    const renderSignature = item
      ? JSON.stringify([
        item.key, item.itemUuid, item.itemId, item.name, item.quantity, item.locked,
        item.isEquipment ? normalizeEnhancement(item) : null,
      ])
      : "";
    if (cell.dataset.renderSignature === renderSignature) return;
    cell.dataset.renderSignature = renderSignature;
    cell.textContent = inventoryButtonText(item);
    const source = item ? catalogItem(item.itemId) : null;
    applyEnhancementVisual(cell, item?.isEquipment ? item : null, source);
    if (item?.isEquipment) assignEquipmentTooltip(cell, source, "點擊裝備", item);
    else {
      assignEquipmentTooltip(cell, null, "", null);
      cell.title = item ? `${itemTooltip(source)}\n數量 ${item.quantity}` : "";
    }
    cell.disabled = !item;
    cell.setAttribute("aria-label", item ? `使用 ${item.name}` : "空白道具格");
  });
  renderInventoryPagination();
}

function renderUnits(container, units, enemies) {
  const desired = enemies ? 3 : units.length; container.replaceChildren();
  for (let i = 0; i < desired; i++) {
    const unit = units[i]; const card = $("#unit-template").content.firstElementChild.cloneNode(true);
    if (!unit) { card.classList.add("dead"); card.querySelector(".slot").textContent = ["D", "E", "F"][i]; card.querySelector(".glyph").textContent = "—"; card.querySelector("strong").textContent = "等待生成"; card.querySelector(".unit-level").textContent = "空位"; setBar(card, ".hp", 0, 1, "HP"); card.querySelector(".mp").hidden = card.querySelector(".exp").hidden = true; renderStatusSummary(card, null); container.append(card); continue; }
    const front = enemies ? i === 0 : unit === frontParty(); card.classList.toggle("front", front); card.classList.toggle("dead", unit.hp <= 0);
    card.querySelector(".slot").textContent = enemies ? ["D", "E", "F"][i] : unit.slot; card.querySelector(".glyph").textContent = enemies ? (unit.category === "boss" ? "♛" : "◆") : unit.slot;
    card.querySelector("strong").textContent = unit.name; card.querySelector(".unit-level").textContent = `Lv.${unit.level}`; setBar(card, ".hp", unit.hp, unit.maxHp, "HP", unit.maxHp >= 1000);
    if (enemies) card.querySelector(".mp").hidden = card.querySelector(".exp").hidden = true;
    else {
      setBar(card, ".mp", unit.mp, unit.maxMp, "MP");
      if (unit.level >= 100) setMaxLevelBar(card);
      else setBar(card, ".exp", unit.exp, requiredExpFor(unit.level) ?? 1, "EXP", true);
    }
    renderStatusSummary(card, unit);
    container.append(card);
  }
}

function formatExactNumber(value) { return roundStat(value).toLocaleString("en-US", { maximumFractionDigits: 1 }); }
function formatCompactNumber(value) {
  const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  const unit = units.find(([size]) => value >= size);
  if (!unit) return formatExactNumber(value);
  const scaled = value / unit[0];
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(digits))}${unit[1]}`;
}
function setBar(card, selector, value, max, label, compactMax = false) {
  const bar = card.querySelector(selector);
  bar.querySelector("i").style.width = `${clamp(value / Math.max(1, max) * 100, 0, 100)}%`;
  bar.querySelector(".bar-label").textContent = label;
  const isResource = label === "HP" || label === "MP";
  const displayMax = isResource ? Math.floor(Number(max) || 0) : max;
  const isFullResource = isResource && Number(value) >= Number(max) - 0.000001;
  bar.querySelector(".bar-current").textContent = isFullResource ? Math.floor(Number(value) || 0).toLocaleString("en-US") : formatExactNumber(value);
  bar.querySelector(".bar-max").textContent = `/ ${compactMax || displayMax >= 1000 ? formatCompactNumber(displayMax) : formatExactNumber(displayMax)}`;
}
function setMaxLevelBar(card) {
  const bar = card.querySelector(".exp");
  bar.querySelector("i").style.width = "100%";
  bar.querySelector(".bar-label").textContent = "EXP";
  bar.querySelector(".bar-current").textContent = "MAX";
  bar.querySelector(".bar-max").textContent = "";
}
function togglePause() { if (state.saveTransition || !state.currentSlot) return; state.paused = !state.paused; updatePauseButton(); }

init();
