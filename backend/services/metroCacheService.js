import { appendRows, readRows, replaceRows, updateRowById } from './driveExcelStore.js';
import { buildXlsx, mimeFor } from './exportService.js';
import { uploadBufferToDrive } from './googleDrive.js';
import { tabs } from './sheetSchema.js';
import { audit } from './auditService.js';
import { id, nowIso } from '../utils/ids.js';

const metroCacheTtlMs = 5 * 60 * 1000;
let metroCache = {
  date: '',
  rows: [],
  expiresAt: 0,
  loadedAt: 0,
  hit: false,
  batchStatus: 'Open',
  closedAt: '',
  closedBy: ''
};

let driveQueue = [];
let failedDriveWrites = [];
let activeDriveWrite = null;
let lastDriveWriteMs = 0;
let lastDriveWriteError = '';
let lastCloseSummary = null;
let queueSequence = 0;
let coldStartDetected = true;

function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(safeDate);
}

export function todayMetroDate() {
  return localDate();
}

function cloneRows(rows = []) {
  return rows.map((row) => ({ ...row }));
}

function normalizeRow(row = {}) {
  return {
    ...row,
    driver: row.driver || row.customerName || '',
    routingSequence: row.routingSequence || row.route || '',
    deliveryAddress: row.deliveryAddress || row.address || '',
    fullAddress: row.fullAddress || [row.deliveryAddress || row.address, row.city, row.postalCode].filter(Boolean).join(', ')
  };
}

function setCacheRows(rows, { status = metroCache.batchStatus, closedAt = metroCache.closedAt, closedBy = metroCache.closedBy } = {}) {
  metroCache = {
    date: todayMetroDate(),
    rows: cloneRows(rows).map(normalizeRow),
    expiresAt: Date.now() + metroCacheTtlMs,
    loadedAt: Date.now(),
    hit: false,
    batchStatus: status,
    closedAt,
    closedBy
  };
}

export function invalidateMetroCache() {
  metroCache = {
    ...metroCache,
    rows: [],
    expiresAt: 0,
    loadedAt: 0,
    hit: false,
    batchStatus: 'Open',
    closedAt: '',
    closedBy: ''
  };
}

export function clearMetroScreenCacheOnly() {
  setCacheRows([], { status: 'Cleared' });
}

export async function readTodayMetroRows({ force = false, includeClosed = false } = {}) {
  const date = todayMetroDate();
  const cacheFresh = metroCache.date === date && metroCache.expiresAt > Date.now();
  if (!force && cacheFresh) {
    metroCache.hit = true;
    if (metroCache.batchStatus === 'Closed' && !includeClosed) return [];
    return cloneRows(metroCache.rows);
  }
  const rows = (await readRows(tabs.metroLabeling)).map(normalizeRow);
  setCacheRows(rows, { status: 'Open', closedAt: '', closedBy: '' });
  if (coldStartDetected) coldStartDetected = false;
  return cloneRows(rows);
}

export function getMetroCacheSnapshot() {
  return {
    date: metroCache.date || todayMetroDate(),
    rows: metroCache.batchStatus === 'Closed' ? [] : cloneRows(metroCache.rows),
    loadedAt: metroCache.loadedAt,
    expiresAt: metroCache.expiresAt,
    hit: metroCache.hit,
    batchStatus: metroCache.batchStatus,
    closedAt: metroCache.closedAt,
    closedBy: metroCache.closedBy
  };
}

export async function findTodayMetroLabel({ id = '', trackingNumber = '' }) {
  const rows = await readTodayMetroRows();
  const tracking = String(trackingNumber || '').trim().toLowerCase();
  return rows.find((row) => (
    (id && row.id === id)
    || (tracking && [row.trackingNumber, row.barcodeValue].some((value) => String(value || '').trim().toLowerCase() === tracking))
  )) || null;
}

export async function updateTodayMetroLabel(rowId, patch = {}) {
  const rows = await readTodayMetroRows({ includeClosed: true });
  let updated = null;
  const nextRows = rows.map((row) => {
    if (row.id !== rowId) return row;
    updated = normalizeRow({ ...row, ...patch });
    return updated;
  });
  if (!updated) return null;
  setCacheRows(nextRows, {
    status: metroCache.batchStatus,
    closedAt: metroCache.closedAt,
    closedBy: metroCache.closedBy
  });
  return { ...updated };
}

function driveWriteQueueLength() {
  return driveQueue.length + (activeDriveWrite ? 1 : 0);
}

function processDriveQueue() {
  if (activeDriveWrite || !driveQueue.length) return;
  activeDriveWrite = driveQueue.shift();
  const started = Date.now();
  Promise.resolve()
    .then(() => activeDriveWrite.task())
    .then(() => {
      lastDriveWriteMs = Date.now() - started;
      lastDriveWriteError = '';
    })
    .catch((error) => {
      lastDriveWriteMs = Date.now() - started;
      lastDriveWriteError = error?.message || 'Drive write failed.';
      failedDriveWrites.push({
        ...activeDriveWrite,
        attempts: activeDriveWrite.attempts + 1,
        lastError: lastDriveWriteError
      });
      console.error('Metro background Drive write failed:', lastDriveWriteError);
    })
    .finally(() => {
      activeDriveWrite = null;
      processDriveQueue();
    });
}

export function enqueueDriveWrite(name, task) {
  const item = {
    id: `drive_write_${Date.now()}_${queueSequence += 1}`,
    name,
    task,
    attempts: 0,
    queuedAt: nowIso(),
    lastError: ''
  };
  driveQueue.push(item);
  processDriveQueue();
  return item.id;
}

export function retryFailedDriveWrites() {
  const retrying = failedDriveWrites.splice(0).map((item) => ({
    ...item,
    queuedAt: nowIso(),
    lastError: ''
  }));
  driveQueue.push(...retrying);
  processDriveQueue();
  return retrying.length;
}

export async function flushDriveWriteQueue() {
  while (driveQueue.length || activeDriveWrite) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function getDriveWriteQueueStatus() {
  const pending = driveWriteQueueLength();
  const failed = failedDriveWrites.length;
  return {
    syncStatus: failed ? 'Sync failed' : pending ? 'Pending sync' : 'Synced',
    driveWriteQueueLength: pending,
    failedDriveWriteCount: failed,
    lastDriveWriteMs,
    lastDriveWriteError
  };
}

export function getPerformanceStatus() {
  return {
    renderUptime: Math.round(process.uptime()),
    metroCacheHit: Boolean(metroCache.hit),
    driveWriteQueueLength: driveWriteQueueLength(),
    lastDriveWriteMs,
    coldStartDetected
  };
}

export async function recordMetroPrint({ label, body, req, status, errorMessage = '' }) {
  const timestamp = nowIso();
  const action = body.action === 'reprint' || ['Printed', 'Reprinted'].includes(label.status) ? 'reprint' : 'print';
  const reprintCount = action === 'reprint' ? Number(label.reprintCount || 0) + 1 : Number(label.reprintCount || 0);
  const patch = {
    status,
    printedAt: status === 'Error' ? label.printedAt || '' : timestamp,
    printedBy: status === 'Error' ? label.printedBy || '' : req.user.username,
    printerName: body.printerName || label.printerName || '',
    reprintCount,
    errorMessage,
    updatedAt: timestamp
  };
  const updated = await updateTodayMetroLabel(label.id, patch);
  const printRecord = {
    id: id('print'),
    trackingNumber: label.trackingNumber,
    action,
    userId: req.user.username,
    status,
    printerName: body.printerName || '',
    timestamp,
    errorMessage
  };
  enqueueDriveWrite('metro_print_result', async () => {
    await updateRowById(tabs.metroLabeling, label.id, patch);
    await appendRows(tabs.printLogs, [printRecord]);
  });
  enqueueDriveWrite('metro_print_audit', () => audit({
    actor: req.user.username,
    action: status === 'Error' ? 'label_print_failed' : `label_${action}ed`,
    entity: 'MetroLabeling',
    entityId: label.id,
    ip: req.ip,
    device: req.get('user-agent') || '',
    metadata: { trackingNumber: label.trackingNumber, printerName: body.printerName || '', status, errorMessage }
  }));
  return {
    row: updated || { ...label, ...patch },
    printRecord,
    ...getDriveWriteQueueStatus()
  };
}

export async function markMetroPendingPrint(label) {
  const patch = {
    status: 'Pending Print',
    errorMessage: '',
    updatedAt: nowIso()
  };
  const updated = await updateTodayMetroLabel(label.id, patch);
  enqueueDriveWrite('metro_pending_print', () => updateRowById(tabs.metroLabeling, label.id, patch));
  return updated || { ...label, ...patch };
}

export function markMetroBatchClosed({ closedBy }) {
  metroCache = {
    ...metroCache,
    rows: [],
    expiresAt: Date.now() + metroCacheTtlMs,
    batchStatus: 'Closed',
    closedAt: nowIso(),
    closedBy
  };
  return getMetroCacheSnapshot();
}

export async function saveFinalMetroFiles(rows, printRows) {
  await replaceRows(tabs.metroLabeling, rows);
  await replaceRows(tabs.printLogs, printRows);
}

function latestUploadForRows(rows = [], uploadRows = []) {
  const uploadedFileIds = new Set(rows.map((row) => row.uploadedFileId).filter(Boolean));
  return uploadRows
    .filter((row) => uploadedFileIds.has(row.driveFileId))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

export async function buildMetroCloseSummary(rows = []) {
  const uploadRows = await readRows(tabs.uploads).catch(() => []);
  const latestUpload = latestUploadForRows(rows, uploadRows);
  const printedRows = rows.filter((row) => ['Printed', 'Reprinted'].includes(String(row.status || '')));
  const errorRows = rows.filter((row) => String(row.status || '') === 'Error');
  const pendingRows = rows.filter((row) => !['Printed', 'Reprinted', 'Error'].includes(String(row.status || '')));
  const reprints = rows.reduce((total, row) => total + Number(row.reprintCount || 0), 0);
  return {
    date: todayMetroDate(),
    totalLabels: rows.length,
    printed: printedRows.length,
    pending: pendingRows.length,
    errors: errorRows.length,
    reprints,
    uploadedFileName: latestUpload?.fileName || '',
    uploadedFileId: latestUpload?.driveFileId || '',
    generatedAt: nowIso()
  };
}

export async function saveMetroCloseSummary(summary, { closedBy = '' } = {}) {
  const rows = [{
    date: summary.date,
    totalLabels: summary.totalLabels,
    printed: summary.printed,
    pending: summary.pending,
    errors: summary.errors,
    reprints: summary.reprints,
    uploadedFileName: summary.uploadedFileName,
    uploadedFileId: summary.uploadedFileId,
    closedBy,
    closedAt: summary.closedAt || nowIso()
  }];
  const fileName = `metro_close_summary_${summary.date}.xlsx`;
  const buffer = await buildXlsx(rows, {
    report: 'Metro Close Summary',
    closedBy,
    closedAt: rows[0].closedAt,
    rowCount: summary.totalLabels
  });
  const driveFile = await uploadBufferToDrive({
    buffer,
    fileName,
    mimeType: mimeFor('xlsx'),
    folderPath: ['Metro', summary.date]
  });
  lastCloseSummary = { summary: { ...summary, closedBy, closedAt: rows[0].closedAt }, rows, buffer, fileName, driveFile };
  return { driveFile, fileName, buffer };
}

export function getLastCloseSummary() {
  return lastCloseSummary;
}
