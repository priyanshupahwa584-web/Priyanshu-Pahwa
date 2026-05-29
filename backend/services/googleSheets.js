import { config, platformStorageConfigError, platformStorageConfigured } from '../config.js';
import { getSheetsClient } from './googleClient.js';
import { platformTabNames, sheetHeaders } from './sheetSchema.js';

let spreadsheetMetaCache = null;

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function toCell(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fromRows(headers, rows) {
  return rows.map((row, index) => ({
    _rowNumber: index + 2,
    ...Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex] ?? '']))
  }));
}

function platformDataSpreadsheetId() {
  if (!platformStorageConfigured()) {
    const error = new Error(platformStorageConfigError() || 'Platform data storage is not configured.');
    error.statusCode = 503;
    error.code = 'platform_storage_missing';
    throw error;
  }
  return config.google.platformDataSheetId;
}

async function spreadsheetMeta(force = false) {
  if (spreadsheetMetaCache && !force) return spreadsheetMetaCache;
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: platformDataSpreadsheetId(),
    fields: 'sheets(properties(sheetId,title))'
  });
  spreadsheetMetaCache = response.data.sheets || [];
  return spreadsheetMetaCache;
}

async function sheetProperty(tabName) {
  return (await spreadsheetMeta()).find((sheet) => sheet.properties?.title === tabName)?.properties;
}

export async function ensureTab(tabName) {
  const headers = sheetHeaders[tabName];
  if (!headers) throw new Error(`Unsupported sheet tab: ${tabName}`);
  const sheets = getSheetsClient();
  let property = await sheetProperty(tabName);
  if (!property) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: platformDataSpreadsheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
    });
    spreadsheetMetaCache = null;
    property = await sheetProperty(tabName);
  }
  const headerRange = `${tabName}!A1:${columnName(headers.length - 1)}1`;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: platformDataSpreadsheetId(),
    range: headerRange
  }).catch(() => ({ data: { values: [] } }));
  const currentHeaders = existing.data.values?.[0] || [];
  if (headers.some((header, index) => currentHeaders[index] !== header)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: platformDataSpreadsheetId(),
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
  }
  return property;
}

export async function readRows(tabName) {
  await ensureTab(tabName);
  const headers = sheetHeaders[tabName];
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: platformDataSpreadsheetId(),
    range: `${tabName}!A2:${columnName(headers.length - 1)}`
  });
  return fromRows(headers, response.data.values || []);
}

export async function appendRows(tabName, records) {
  if (!records.length) return [];
  await ensureTab(tabName);
  const headers = sheetHeaders[tabName];
  const values = records.map((record) => headers.map((header) => toCell(record[header])));
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: platformDataSpreadsheetId(),
    range: `${tabName}!A:${columnName(headers.length - 1)}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });
  return records;
}

export async function replaceRows(tabName, records) {
  await ensureTab(tabName);
  const headers = sheetHeaders[tabName];
  const sheets = getSheetsClient();
  const property = await sheetProperty(tabName);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: platformDataSpreadsheetId(),
    range: `${tabName}!A2:${columnName(headers.length - 1)}`
  });
  if (property?.gridProperties?.rowCount > 2) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: platformDataSpreadsheetId(),
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId: property.sheetId, dimension: 'ROWS', startIndex: 2, endIndex: property.gridProperties.rowCount }
          }
        }]
      }
    }).catch(() => null);
  }
  return appendRows(tabName, records);
}

export async function updateRowById(tabName, rowId, patch) {
  const rows = await readRows(tabName);
  const existing = rows.find((row) => row.id === rowId);
  if (!existing) return null;
  const headers = sheetHeaders[tabName];
  const next = { ...existing, ...patch, id: rowId };
  delete next._rowNumber;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: platformDataSpreadsheetId(),
    range: `${tabName}!A${existing._rowNumber}:${columnName(headers.length - 1)}${existing._rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers.map((header) => toCell(next[header]))] }
  });
  return next;
}

export async function deleteRowById(tabName, rowId) {
  const rows = await readRows(tabName);
  const existing = rows.find((row) => row.id === rowId);
  if (!existing) return false;
  const property = await sheetProperty(tabName);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: platformDataSpreadsheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: property.sheetId,
            dimension: 'ROWS',
            startIndex: existing._rowNumber - 1,
            endIndex: existing._rowNumber
          }
        }
      }]
    }
  });
  return true;
}

export async function ensurePlatformStorage() {
  await Promise.all(platformTabNames.map((tabName) => ensureTab(tabName)));
}

export const ensureCoreTabs = ensurePlatformStorage;
