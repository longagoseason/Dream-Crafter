"use strict";

(function exposeRuntimePlatform(global) {
  const API_HEALTH_URL = "./api/health";
  const API_GAME_DATA_URL = "./api/game-data";
  const STATIC_GAME_DATA_URL = "./source/game-data.json";

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
    const url = activeMode === "local-api" ? API_GAME_DATA_URL : STATIC_GAME_DATA_URL;
    return fetchJson(url);
  }

  global.DreamerRuntime = {
    initialize,
    loadGameData,
    get mode() { return mode; },
    get dataSource() { return mode === "local-api" ? API_GAME_DATA_URL : STATIC_GAME_DATA_URL; },
  };
})(window);
