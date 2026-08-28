"use strict";

(function exposeRuntimePlatform(global) {
  const API_HEALTH_URL = "./api/health";
  const API_CSV_MANIFEST_URL = "./api/csv-manifest";
  const STATIC_CSV_MANIFEST_URL = "./source/manifest.json";

  let mode = null;

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return response.json();
  }

  async function initialize() {
    if (mode) return mode;
    try {
      const health = await fetchJson(API_HEALTH_URL);
      mode = health?.ok ? "local-api" : "static-web";
    } catch {
      mode = "static-web";
    }
    return mode;
  }

  async function loadGameData() {
    const activeMode = await initialize();
    if (!global.DreamerCsvLoader) throw new Error("csvLoader.js 尚未載入");
    const manifestUrl = activeMode === "local-api" ? API_CSV_MANIFEST_URL : STATIC_CSV_MANIFEST_URL;
    return global.DreamerCsvLoader.loadAll(manifestUrl);
  }

  global.DreamerRuntime = {
    initialize,
    loadGameData,
    get mode() { return mode; },
    get dataSource() { return mode === "local-api" ? `${API_CSV_MANIFEST_URL} + ./source/*.csv` : `${STATIC_CSV_MANIFEST_URL} + ./source/*.csv`; },
  };
})(window);
