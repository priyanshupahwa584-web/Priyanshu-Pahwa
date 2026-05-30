import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { config, driveStorageConfigured } from '../config.js';
import { getDriveClient } from './googleClient.js';
import { ensureDriveFolderPath, uploadFileToDrive } from './googleDrive.js';
import { readMasterFacilityRows } from './facilityAnalyticsService.js';
import { createDriveStorageError, runDriveStorageDiagnostics } from './driveDiagnostics.js';
import { sheetHeaders, tabs } from './sheetSchema.js';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const folderMime = 'application/vnd.google-apps.folder';
const cacheTtlMs = 30 * 1000;
const fileCache = new Map();
const writeLocks = new Map();

function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(safeDate);
}

function today() {
  return localDate();
}

function toCell(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fromCell(cell) {
  if (!cell || cell.value === null || typeof cell.value === 'undefined') return '';
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === 'object') return cell.text || JSON.stringify(cell.value);
  return String(cell.value);
}

function driveError(message, statusCode = 503) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireDriveStorage() {
  if (driveStorageConfigured()) return;
  throw createDriveStorageError(null);
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function driveOptions(extra = {}) {
  return { supportsAllDrives: true, ...extra };
}

function isTodayDate(date) {
  return date === today();
}

function recordDate(tabName, record = {}) {
  if (tabName === tabs.printLogs) return localDate(record.timestamp || record.createdAt || new Date());
  if (tabName === tabs.audit || tabName === tabs.uploads || tabName === tabs.exports || tabName === tabs.fulfilmentReports) {
    return localDate(record.createdAt || record.timestamp || record.reportDate || new Date());
  }
  if (tabName === tabs.metroLabeling) return localDate(record.createdAt || record.updatedAt || new Date());
  return today();
}

function dateRangeFromQuery(query = {}) {
  const from = String(query.dateFrom || query.from || query.reportDate || query.date || '').slice(0, 10);
  const to = String(query.dateTo || query.to || query.reportDate || query.date || '').slice(0, 10);
  return { from, to };
}

function dateInRange(date, { from, to }) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function fileNameFor(tabName, date = today()) {
  if (tabName === tabs.metroLabeling) return `metro_labels_${date}.xlsx`;
  if (tabName === tabs.printLogs) return `metro_print_history_${date}.xlsx`;
  if (tabName === tabs.uploads) return `metro_uploads_${date}.xlsx`;
  if (tabName === tabs.audit) return `audit_logs_${date}.xlsx`;
  if (tabName === tabs.userActivity) return 'user_activity.xlsx';
  if (tabName === tabs.users) return 'users.xlsx';
  if (tabName === tabs.sessions) return 'user_sessions.xlsx';
  if (tabName === tabs.exports) return 'export_logs.xlsx';
  if (tabName === tabs.fulfilmentReports) return 'fulfilment_reports.xlsx';
  throw new Error(`Unsupported Drive Excel store tab: ${tabName}`);
}

function folderPathFor(tabName, date = today()) {
  if ([tabs.metroLabeling, tabs.printLogs, tabs.uploads].includes(tabName)) return ['Metro', date];
  if (tabName === tabs.audit) return ['Audit'];
  if ([tabs.users, tabs.sessions, tabs.userActivity].includes(tabName)) return ['Users'];
  if ([tabs.exports, tabs.fulfilmentReports].includes(tabName)) return ['Reports'];
  throw new Error(`Unsupported Drive Excel store tab: ${tabName}`);
}

function dailyTab(tabName) {
  return [tabs.metroLabeling, tabs.printLogs, tabs.uploads, tabs.audit].includes(tabName);
}

function cacheKey(fileId) {
  return `file:${fileId}`;
}

function cacheGet(fileId, date) {
  if (!isTodayDate(date)) return null;
  const cached = fileCache.get(cacheKey(fileId));
  if (!cached || Date.now() - cached.at > cacheTtlMs) return null;
  return cached.rows.map((row) => ({ ...row }));
}

function cacheSet(fileId, date, rows) {
  if (!isTodayDate(date)) return;
  fileCache.set(cacheKey(fileId), { at: Date.now(), rows: rows.map((row) => ({ ...row })) });
}

function cacheDelete(fileId) {
  fileCache.delete(cacheKey(fileId));
}

async function withFileLock(fileId, task) {
  const previous = writeLocks.get(fileId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current);
  writeLocks.set(fileId, next);
  await previous.catch(() => null);
  try {
    return await task();
  } finally {
    release();
    if (writeLocks.get(fileId) === next) writeLocks.delete(fileId);
  }
}

async function findChild(parentId, name, mimeType = '') {
  const drive = getDriveClient();
  const parts = [
    `name = '${escapeDriveQuery(name)}'`,
    `'${escapeDriveQuery(parentId)}' in parents`,
    'trashed = false'
  ];
  if (mimeType) parts.push(`mimeType = '${escapeDriveQuery(mimeType)}'`);
  const response = await drive.files.list(driveOptions({
    q: parts.join(' and '),
    fields: 'files(id,name,mimeType,size,webViewLink,capabilities(canAddChildren,canEdit))',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    pageSize: 1
  }));
  return response.data.files?.[0] || null;
}

async function createWorkbookBuffer(tabName, rows = []) {
  const headers = sheetHeaders[tabName];
  if (!headers) throw new Error(`Unsupported store tab: ${tabName}`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Broadreach Operations Platform';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Data');
  sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(14, header.length + 4) }));
  rows.forEach((row) => {
    sheet.addRow(Object.fromEntries(headers.map((header) => [header, toCell(row[header])])));
  });
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

async function readWorkbookRows(buffer, tabName, fileMeta, date) {
  const headers = sheetHeaders[tabName];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Data') || workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const currentHeaders = headers.map((_, index) => String(headerRow.getCell(index + 1).value || '').trim());
  if (headers.some((header, index) => currentHeaders[index] !== header)) {
    return [];
  }
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { _rowNumber: rowNumber, _storageFileId: fileMeta.id, _storageDate: date };
    headers.forEach((header, index) => {
      record[header] = fromCell(row.getCell(index + 1));
    });
    if (headers.some((header) => record[header] !== '')) rows.push(record);
  });
  return rows;
}

async function downloadFileBuffer(fileId) {
  const drive = getDriveClient();
  const response = await drive.files.get(driveOptions({ fileId, alt: 'media' }), { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

async function uploadWorkbookBuffer(fileId, buffer) {
  const drive = getDriveClient();
  await drive.files.update(driveOptions({
    fileId,
    media: {
      mimeType: xlsxMime,
      body: Readable.from(buffer)
    },
    fields: 'id,name,size,modifiedTime'
  }));
}

async function ensureStoreFile(tabName, date = today()) {
  requireDriveStorage();
  const folder = await ensureDriveFolderPath(folderPathFor(tabName, date));
  const fileName = fileNameFor(tabName, date);
  const existing = await findChild(folder.id, fileName, xlsxMime);
  if (existing) return { ...existing, date, folder };
  const buffer = await createWorkbookBuffer(tabName);
  const drive = getDriveClient();
  const created = await drive.files.create(driveOptions({
    requestBody: {
      name: fileName,
      mimeType: xlsxMime,
      parents: [folder.id]
    },
    media: {
      mimeType: xlsxMime,
      body: Readable.from(buffer)
    },
    fields: 'id,name,mimeType,size,webViewLink'
  }));
  return { ...created.data, date, folder };
}

async function readStoreFile(tabName, date = today(), { create = true } = {}) {
  requireDriveStorage();
  const file = create
    ? await ensureStoreFile(tabName, date)
    : await findExistingStoreFile(tabName, date);
  if (!file) return [];
  const cached = cacheGet(file.id, date);
  if (cached) return cached;
  const rows = await readWorkbookRows(await downloadFileBuffer(file.id), tabName, file, date);
  cacheSet(file.id, date, rows);
  return rows;
}

async function findExistingStoreFile(tabName, date) {
  const folderPath = folderPathFor(tabName, date);
  let parentId = config.google.driveFolderId;
  for (const folderName of folderPath) {
    const folder = await findChild(parentId, folderName, folderMime);
    if (!folder) return null;
    parentId = folder.id;
  }
  const file = await findChild(parentId, fileNameFor(tabName, date), xlsxMime);
  return file ? { ...file, date, folder: { id: parentId } } : null;
}

async function listExistingMetroDates() {
  requireDriveStorage();
  const metro = await findChild(config.google.driveFolderId, 'Metro', folderMime);
  if (!metro) return [];
  const drive = getDriveClient();
  const response = await drive.files.list(driveOptions({
    q: `'${escapeDriveQuery(metro.id)}' in parents and mimeType = '${folderMime}' and trashed = false`,
    fields: 'files(id,name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    pageSize: 1000
  }));
  return (response.data.files || [])
    .map((file) => String(file.name || ''))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

async function listExistingAuditDates() {
  requireDriveStorage();
  const audit = await findChild(config.google.driveFolderId, 'Audit', folderMime);
  if (!audit) return [];
  const drive = getDriveClient();
  const response = await drive.files.list(driveOptions({
    q: `'${escapeDriveQuery(audit.id)}' in parents and mimeType = '${xlsxMime}' and name contains 'audit_logs_' and trashed = false`,
    fields: 'files(id,name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    pageSize: 1000
  }));
  return (response.data.files || [])
    .map((file) => String(file.name || '').match(/^audit_logs_(\d{4}-\d{2}-\d{2})\.xlsx$/)?.[1])
    .filter(Boolean)
    .sort();
}

async function datesForDailyRead(tabName, query = {}) {
  const range = dateRangeFromQuery(query);
  if (!range.from && !range.to) return [today()];
  const availableDates = tabName === tabs.audit ? await listExistingAuditDates() : await listExistingMetroDates();
  return availableDates.filter((date) => dateInRange(date, range));
}

async function readOperationsRows() {
  const { records, sourceSheet } = await readMasterFacilityRows();
  return records.map((row) => ({
    id: row.id,
    date: row.date,
    facility: row.facility,
    pieces: row.count,
    throughput: '',
    productivity: '',
    cycleTime: '',
    status: 'Source',
    notes: `${sourceSheet} row ${row.sourceRow}, column ${row.column}`,
    createdAt: '',
    updatedAt: '',
    createdBy: 'Facility Operations'
  }));
}

function readOnlyOperationsError() {
  return driveError('Facility Operations uses the Google Sheets Sort sheet as a read-only source. Platform writes are stored in Google Drive Excel files only.', 405);
}

export async function readRows(tabName, query = {}) {
  if (tabName === tabs.operations) return readOperationsRows();
  if (dailyTab(tabName)) {
    const dates = await datesForDailyRead(tabName, query);
    const groups = await Promise.all(dates.map((date) => readStoreFile(tabName, date, { create: isTodayDate(date) })));
    return groups.flat();
  }
  return readStoreFile(tabName, today());
}

export async function appendRows(tabName, records) {
  if (!records.length) return [];
  if (tabName === tabs.operations) throw readOnlyOperationsError();
  const groups = new Map();
  records.forEach((record) => {
    const date = dailyTab(tabName) ? recordDate(tabName, record) : today();
    groups.set(date, [...(groups.get(date) || []), record]);
  });
  for (const [date, group] of groups.entries()) {
    const file = await ensureStoreFile(tabName, date);
    await withFileLock(file.id, async () => {
      const rows = await readStoreFile(tabName, date);
      const nextRows = [...rows, ...group];
      const buffer = await createWorkbookBuffer(tabName, nextRows);
      await uploadWorkbookBuffer(file.id, buffer);
      cacheDelete(file.id);
    });
  }
  if (tabName === tabs.audit) await appendRows(tabs.userActivity, records);
  return records;
}

export async function replaceRows(tabName, records) {
  if (tabName === tabs.operations) throw readOnlyOperationsError();
  const date = dailyTab(tabName) && records[0] ? recordDate(tabName, records[0]) : today();
  const file = await ensureStoreFile(tabName, date);
  await withFileLock(file.id, async () => {
    const buffer = await createWorkbookBuffer(tabName, records);
    await uploadWorkbookBuffer(file.id, buffer);
    cacheDelete(file.id);
  });
  return records;
}

async function updateRowInDate(tabName, date, rowId, patch, create = false) {
  const file = create ? await ensureStoreFile(tabName, date) : await findExistingStoreFile(tabName, date);
  if (!file) return null;
  return withFileLock(file.id, async () => {
    const rows = await readStoreFile(tabName, date, { create });
    const index = rows.findIndex((row) => row.id === rowId);
    if (index === -1) return null;
    const next = { ...rows[index], ...patch, id: rowId };
    delete next._rowNumber;
    delete next._storageFileId;
    delete next._storageDate;
    const cleanRows = rows.map((row, rowIndex) => {
      const clean = rowIndex === index ? next : { ...row };
      delete clean._rowNumber;
      delete clean._storageFileId;
      delete clean._storageDate;
      return clean;
    });
    const buffer = await createWorkbookBuffer(tabName, cleanRows);
    await uploadWorkbookBuffer(file.id, buffer);
    cacheDelete(file.id);
    return next;
  });
}

export async function updateRowById(tabName, rowId, patch) {
  if (tabName === tabs.operations) throw readOnlyOperationsError();
  const currentDate = today();
  const todayUpdate = await updateRowInDate(tabName, currentDate, rowId, patch, true);
  if (todayUpdate || !dailyTab(tabName)) return todayUpdate;
  const dates = tabName === tabs.audit ? await listExistingAuditDates() : await listExistingMetroDates();
  for (const date of dates.reverse()) {
    if (date === currentDate) continue;
    const updated = await updateRowInDate(tabName, date, rowId, patch, false);
    if (updated) return updated;
  }
  return null;
}

export async function deleteRowById(tabName, rowId) {
  if (tabName === tabs.operations) throw readOnlyOperationsError();
  const rows = await readRows(tabName);
  const existing = rows.find((row) => row.id === rowId);
  if (!existing) return false;
  const nextRows = rows.filter((row) => row.id !== rowId);
  await replaceRows(tabName, nextRows);
  return true;
}

export async function ensureCoreFiles() {
  requireDriveStorage();
  await ensureDriveFolderPath(['Metro']);
  await ensureDriveFolderPath(['Users']);
  await ensureDriveFolderPath(['Audit']);
  await ensureDriveFolderPath(['Reports']);
  await ensureDriveFolderPath(['Backups']);
  await Promise.all([
    ensureStoreFile(tabs.metroLabeling, today()),
    ensureStoreFile(tabs.printLogs, today()),
    ensureStoreFile(tabs.uploads, today()),
    ensureStoreFile(tabs.audit, today()),
    ensureStoreFile(tabs.users, today()),
    ensureStoreFile(tabs.sessions, today()),
    ensureStoreFile(tabs.userActivity, today()),
    ensureStoreFile(tabs.exports, today()),
    ensureStoreFile(tabs.fulfilmentReports, today())
  ]);
}

export async function uploadMetroOriginal(file) {
  const date = today();
  return uploadFileToDrive({
    filePath: file.path,
    fileName: file.originalname,
    mimeType: file.mimetype,
    folderPath: ['Metro', date]
  });
}

export async function checkDriveExcelStorage() {
  const result = await runDriveStorageDiagnostics({ writeProbe: true });
  result.todayMetroFolder = result.driveStorageWritable ? today() : '';
  result.driveStorageError = result.driveErrorMessage;
  return result;
}
