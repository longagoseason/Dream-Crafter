"use strict";

(function exposeCsvLoader(global) {
  const SOURCE_ROOT = "./source/";
  const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
  let sessionDataPromise = null;
  let loadedFiles = [];

  class CsvLoadError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = "CsvLoadError";
      this.details = details;
    }
  }

  async function fetchText(path) {
    let response;
    try {
      response = await fetch(path, { cache: "no-store" });
    } catch (error) {
      console.error("CSV load failed", { path, status: "NETWORK_ERROR", error });
      throw new CsvLoadError(`CSV load failed: ${path} (network error)`, { path, status: null, cause: error });
    }
    if (!response.ok) {
      console.error("CSV load failed", { path, status: response.status });
      throw new CsvLoadError(`CSV load failed: ${path} (HTTP ${response.status})`, { path, status: response.status });
    }
    return response.text();
  }

  async function fetchJson(path) {
    const text = await fetchText(path);
    try { return JSON.parse(text); }
    catch (error) {
      console.error("CSV manifest load failed", { path, error });
      throw new CsvLoadError(`CSV manifest is not valid JSON: ${path}`, { path, cause: error });
    }
  }

  function parseCsv(text, fileName) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const input = String(text).replace(/^\uFEFF/, "");
    for (let index = 0; index < input.length; index++) {
      const character = input[index];
      if (quoted) {
        if (character === '"' && input[index + 1] === '"') { field += '"'; index++; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ",") { row.push(field); field = ""; }
      else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
      else field += character;
    }
    if (quoted) throw new CsvLoadError(`CSV parse failed: ${fileName} (unclosed quote)`, { path: fileName });
    if (field !== "" || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
    return rows;
  }

  function parseFile(text, entry, manifest) {
    const rawRows = parseCsv(text, entry.file);
    if (!rawRows.length) throw new CsvLoadError(`CSV load failed: ${entry.file} is empty`, { path: entry.file });
    const lastHeader = rawRows[0].reduce((last, value, index) => String(value).trim() ? index : last, -1);
    const headers = rawRows[0].slice(0, lastHeader + 1).map((value) => String(value).trim());
    if (!headers.length) throw new CsvLoadError(`CSV validation failed: ${entry.file} has no headers`, { path: entry.file });
    const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
    if (duplicateHeaders.length) throw new CsvLoadError(`CSV validation failed: ${entry.file} duplicate header ${duplicateHeaders[0]}`, { path: entry.file });
    for (const header of entry.expectedHeaders ?? []) {
      if (!headers.includes(header)) throw new CsvLoadError(`CSV validation failed: ${entry.file} missing column ${header}`, { path: entry.file, column: header });
    }

    const numberFields = new Set(manifest.numberFields ?? []);
    const booleanFields = new Set(manifest.booleanFields ?? []);
    const enhancementStats = new Set(manifest.enhancementStats ?? []);
    const enhancementMatrix = ["Enhance_SaveEnchant.csv", "Enhance_OverEnchant.csv", "Enhance_ChaosEnchant.csv"].includes(entry.logicalFile);
    const records = [];
    for (let rowIndex = 1; rowIndex < rawRows.length; rowIndex++) {
      const values = rawRows[rowIndex];
      if (values.every((value) => String(value).trim() === "")) continue;
      const record = {};
      const positionIndex = headers.indexOf("position");
      const matrixRowName = positionIndex >= 0 ? String(values[positionIndex] ?? "").trim() : "";
      const rangeRow = matrixRowName === "stability_range" || ["bless_min", "bless_max", "curse_min", "curse_max", "chaos_min", "chaos_max"].includes(matrixRowName);
      for (let columnIndex = 0; columnIndex < headers.length; columnIndex++) {
        const header = headers[columnIndex];
        if (!header) continue;
        const raw = String(values[columnIndex] ?? "").trim();
        if (["effect1_value", "effect2_value"].includes(header)) {
          if (raw === "") record[header] = null;
          else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(raw)) record[header] = raw;
          else throw new CsvLoadError(`CSV validation failed: ${entry.file} row ${rowIndex + 1}, ${header} must be a number or percentage`, { path: entry.file, row: rowIndex + 1, column: header });
        } else if (enhancementMatrix && enhancementStats.has(header) && !rangeRow) {
          if (/^(true|false)$/i.test(raw)) record[header] = raw.toLowerCase() === "true";
          else throw new CsvLoadError(`CSV validation failed: ${entry.file} row ${rowIndex + 1}, ${header} must be TRUE or FALSE`, { path: entry.file, row: rowIndex + 1, column: header });
        } else if (numberFields.has(header) || (enhancementMatrix && enhancementStats.has(header))) {
          if (raw === "") record[header] = null;
          else {
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new CsvLoadError(`CSV validation failed: ${entry.file} row ${rowIndex + 1}, ${header} is not a legal number`, { path: entry.file, row: rowIndex + 1, column: header });
            record[header] = value;
          }
        } else if (booleanFields.has(header)) {
          if (raw === "") record[header] = null;
          else if (/^(true|false)$/i.test(raw)) record[header] = raw.toLowerCase() === "true";
          else throw new CsvLoadError(`CSV validation failed: ${entry.file} row ${rowIndex + 1}, ${header} must be TRUE or FALSE`, { path: entry.file, row: rowIndex + 1, column: header });
        } else record[header] = raw || null;
      }
      for (const required of entry.required ?? []) {
        if (record[required] === null || record[required] === undefined || record[required] === "") {
          throw new CsvLoadError(`CSV validation failed: ${entry.file} row ${rowIndex + 1}, ${required} is empty`, { path: entry.file, row: rowIndex + 1, column: required });
        }
      }
      for (const [fieldName, value] of Object.entries(record)) {
        const colorField = (entry.logicalFile === "Game_color_index.csv" && fieldName === "color_name")
          || /(?:^|_)(?:color|shading)$|^flash_name$/i.test(fieldName);
        if (colorField && !COLOR_PATTERN.test(String(value ?? ""))) {
          throw new CsvLoadError(`CSV validation failed: ${entry.file} row ${rowIndex + 1}, ${fieldName} must use #RRGGBB`, { path: entry.file, row: rowIndex + 1, column: fieldName });
        }
      }
      records.push(record);
    }

    if (entry.id?.length) {
      const seen = new Set();
      records.forEach((record, index) => {
        const id = entry.id.map((fieldName) => record[fieldName]).join("|");
        if (seen.has(id)) throw new CsvLoadError(`CSV validation failed: ${entry.file} duplicate ID ${id} at row ${index + 2}`, { path: entry.file, row: index + 2, column: entry.id.join(" + ") });
        seen.add(id);
      });
    }
    return records;
  }

  async function loadSessionData(manifestPath) {
    const manifest = await fetchJson(manifestPath);
    if (!Array.isArray(manifest.csvFiles) || !manifest.csvFiles.length) {
      throw new CsvLoadError(`CSV manifest has no required files: ${manifestPath}`, { path: manifestPath });
    }
    const invalidEntry = manifest.csvFiles.find((entry) => !entry?.file || !entry?.table || /[\\/]/.test(entry.file));
    if (invalidEntry) throw new CsvLoadError(`CSV manifest contains an invalid file entry`, { path: manifestPath });

    const results = await Promise.all(manifest.csvFiles.map(async (entry) => {
      const path = `${SOURCE_ROOT}${entry.file}`;
      const text = await fetchText(path);
      return { entry, path, records: parseFile(text, entry, manifest) };
    }));
    const tables = {};
    for (const result of results) {
      if (tables[result.entry.table]) throw new CsvLoadError(`CSV validation failed: duplicate table ${result.entry.table}`, { path: result.path });
      tables[result.entry.table] = result.records;
    }
    loadedFiles = results.map(({ entry, path, records }) => ({ file: entry.file, table: entry.table, path, rows: records.length }));
    console.info(`CSV session load complete: ${loadedFiles.length} files`, loadedFiles);
    return tables;
  }

  function loadAll(manifestPath) {
    if (!sessionDataPromise) sessionDataPromise = loadSessionData(manifestPath);
    return sessionDataPromise;
  }

  global.DreamerCsvLoader = {
    loadAll,
    parseCsv,
    CsvLoadError,
    get loadedFiles() { return loadedFiles.map((entry) => ({ ...entry })); },
  };
})(window);
