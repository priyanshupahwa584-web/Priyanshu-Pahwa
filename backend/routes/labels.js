import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { buildExport, mimeFor } from '../services/exportService.js';
import { uploadBufferToDrive } from '../services/googleDrive.js';
import { appendRows, readRows, updateRowById, uploadMetroOriginal } from '../services/driveExcelStore.js';
import { parseMetroLabelFile } from '../services/labelImportService.js';
import {
  enqueueDriveWrite,
  buildMetroCloseSummary,
  buildMetroCompleteSummary,
  findTodayMetroLabel,
  flushDriveWriteQueue,
  getDriveWriteQueueStatus,
  getLastCloseSummary,
  getMetroCacheSnapshot,
  invalidateMetroCache,
  listCompletedMetroFiles,
  markMetroBatchClosed,
  markMetroFileCompleted,
  readTodayMetroRows,
  recordMetroPrint,
  reloadCompletedMetroFile,
  retryFailedDriveWrites,
  saveFinalMetroFiles,
  saveMetroCloseSummary,
  saveMetroCompletedFile
} from '../services/metroCacheService.js';
import { tabs } from '../services/sheetSchema.js';
import { buildPdfLabel, buildZplLabel, normalizeLabelPayload } from '../utils/label.js';
import { id, nowIso } from '../utils/ids.js';
import { labelPrintSchema } from '../utils/validation.js';

export const labelsRouter = express.Router();

function safeName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext).replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);
  return `${base}-${Date.now()}${ext}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadDir),
    filename: (_req, file, callback) => callback(null, safeName(file.originalname))
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xlsm', '.json'].includes(ext)) return callback(new Error('Only CSV, XLSX, XLSM, and JSON files are allowed.'));
    callback(null, true);
  }
});

function requireLabelUploader(req, res, next) {
  if (['Admin', 'Manager', 'Supervisor'].includes(req.user?.role)) return next();
  return res.status(403).json({ message: 'Only Admin, Manager, or Supervisor can upload label files.' });
}

function requireBatchCloser(req, res, next) {
  if (['Admin', 'Manager', 'Supervisor'].includes(req.user?.role)) return next();
  return res.status(403).json({ message: 'Only Admin, Manager, or Supervisor can close Metro batches.' });
}

function requireFileCompleter(req, res, next) {
  if (['Admin', 'Manager', 'Supervisor'].includes(req.user?.role) || req.user?.permissions?.includes('metro-complete-file')) return next();
  return res.status(403).json({ message: 'Complete Metro File access required.' });
}

function filterLabels(rows, query = {}) {
  const search = String(query.search || '').trim().toLowerCase();
  const status = String(query.status || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (status && String(row.status || '').toLowerCase() !== status) return false;
    if (!search) return true;
    const haystack = `${row.trackingNumber} ${row.barcodeValue} ${row.customerName} ${row.service} ${row.route} ${row.address} ${row.city} ${row.postalCode}`.toLowerCase();
    return haystack.includes(search);
  });
}

function sanitizePatchValue(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function labelPatch(body = {}) {
  const allowed = ['driver', 'routingSequence', 'deliveryAddress', 'city', 'postalCode', 'status', 'errorMessage'];
  const patch = {};
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      patch[field] = sanitizePatchValue(body[field], field === 'errorMessage' ? 1000 : 500);
    }
  });
  if (patch.city) {
    patch.city = patch.city.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
  }
  if (patch.deliveryAddress) patch.address = patch.deliveryAddress;
  if (patch.routingSequence) patch.route = patch.routingSequence;
  if (patch.driver) patch.customerName = patch.driver;
  if (patch.deliveryAddress || patch.city || patch.postalCode) {
    patch.fullAddress = [patch.deliveryAddress ?? body.currentDeliveryAddress, patch.city ?? body.currentCity, patch.postalCode ?? body.currentPostalCode]
      .filter(Boolean)
      .join(', ');
  }
  patch.updatedAt = nowIso();
  return patch;
}

async function findLabel({ id: rowId, trackingNumber }) {
  return findTodayMetroLabel({ id: rowId, trackingNumber });
}

function exactTrackingMatch(row, value) {
  const tracking = String(value || '').trim().toLowerCase();
  if (!tracking) return false;
  return [row.trackingNumber, row.barcodeValue].some((candidate) => String(candidate || '').trim().toLowerCase() === tracking);
}

async function markPrintResult(label, body, req, status, errorMessage = '') {
  return recordMetroPrint({ label, body, req, status, errorMessage });
}

async function buildPrintPayload(label, type) {
  const normalized = normalizeLabelPayload(label);
  const zpl = buildZplLabel(normalized);
  if (type === 'pdf') {
    const pdf = await buildPdfLabel(normalized);
    return { label: normalized, zpl, pdfBase64: pdf.toString('base64') };
  }
  return { label: normalized, zpl };
}

labelsRouter.get('/', authRequired, requireAccess('metro-labeling'), async (req, res, next) => {
  try {
    const rows = filterLabels(await readTodayMetroRows({ force: req.query.force === '1' }), req.query).reverse();
    const snapshot = getMetroCacheSnapshot();
    res.json({
      rows,
      count: rows.length,
      batchStatus: snapshot.batchStatus,
      closedAt: snapshot.closedAt,
      closedBy: snapshot.closedBy,
      ...getDriveWriteQueueStatus()
    });
  } catch (error) {
    next(error);
  }
});

async function sendPrintLogs(_req, res, next) {
  try {
    res.json({ rows: (await readRows(tabs.printLogs)).reverse().slice(0, 200) });
  } catch (error) {
    next(error);
  }
}

labelsRouter.get('/logs', authRequired, requireAccess('metro-labeling'), sendPrintLogs);
labelsRouter.get('/history', authRequired, requireAccess('metro-labeling'), sendPrintLogs);

labelsRouter.post('/scan', authRequired, requireAccess('metro-labeling'), async (req, res, next) => {
  try {
    const trackingNumber = String(req.body?.trackingNumber || '').trim();
    if (!trackingNumber) return res.status(400).json({ message: 'Scan Tracking / Barcode is required.' });
    const rows = await readTodayMetroRows();
    const row = rows.find((item) => exactTrackingMatch(item, trackingNumber));
    enqueueDriveWrite('metro_scan_audit', () => audit({
      actor: req.user.username,
      action: row ? 'metro_label_scanned' : 'metro_label_scan_not_found',
      entity: 'MetroLabeling',
      entityId: row?.id || '',
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { trackingNumber, status: row?.status || 'Not found' }
    }));
    if (!row) return res.status(404).json({ message: 'Tracking not found.' });
    res.json({ row, scannedBy: req.user.username, scannedAt: nowIso(), ...getDriveWriteQueueStatus() });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/upload', authRequired, requireAccess('metro-labeling'), requireLabelUploader, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a CSV, XLSX, XLSM, or JSON label file first.' });
    const driveFile = await uploadMetroOriginal(req.file);
    const parsed = await parseMetroLabelFile(req.file.path, req.file.originalname, driveFile.id, req.user.username);
    if (!parsed.rows.length && parsed.errors.length) {
      await appendRows(tabs.uploads, [{
        id: id('upload'),
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        driveFileId: driveFile.id,
        size: req.file.size,
        uploadedBy: req.user.username,
        status: 'Failed',
        message: JSON.stringify(parsed.errors.slice(0, 20)),
        createdAt: nowIso()
      }]);
      const missingTracking = parsed.errors.some((error) => String(error.message || '').includes('Tracking Number'));
      return res.status(400).json({
        message: missingTracking ? 'Upload file is missing Tracking Number.' : 'Label import validation failed.',
        errors: parsed.errors,
        importedRows: 0,
        skippedRows: parsed.skippedCount,
        rejectedRows: parsed.rejectedCount,
        warning: ''
      });
    }
    await appendRows(tabs.metroLabeling, parsed.rows);
    invalidateMetroCache();
    await appendRows(tabs.uploads, [{
      id: id('upload'),
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      driveFileId: driveFile.id,
      size: req.file.size,
      uploadedBy: req.user.username,
      status: parsed.errors.length ? 'Imported With Skips' : 'Imported',
      message: `${parsed.rows.length} Metro label rows imported${parsed.errors.length ? `, ${parsed.errors.length} rejected` : ''}`,
      createdAt: nowIso()
    }]);
    await audit({
      actor: req.user.username,
      action: 'metro_labels_uploaded',
      entity: 'MetroLabeling',
      entityId: driveFile.id,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { fileName: req.file.originalname, rows: parsed.rows.length }
    });
    res.status(201).json({
      importedRows: parsed.rows.length,
      skippedRows: parsed.skippedCount,
      rejectedRows: parsed.rejectedCount,
      errors: parsed.errors,
      uploadedBy: req.user.username,
      uploadedAt: nowIso(),
      driveFileId: driveFile.id,
      warning: '',
      rows: parsed.rows
    });
  } catch (error) {
    next(error);
  } finally {
    if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
  }
});

labelsRouter.post('/print/test', authRequired, requireAccess('printer-setup'), async (req, res, next) => {
  try {
    const body = labelPrintSchema.parse({ ...req.body, action: 'test' });
    const payload = await buildPrintPayload({
      trackingNumber: 'TEST-0001',
      barcodeValue: 'TEST-0001',
      customerName: 'Broadreach Test',
      service: '4x2 Label Check',
      route: '001',
      address: '123 Operations Way',
      city: 'Toronto',
      postalCode: 'M1A 1A1'
    }, body.type);
    res.json({
      ...payload,
      localAgentJob: {
        printerName: body.printerName,
        type: body.type,
        labelSize: '4x2',
        ...payload.label,
        zpl: payload.zpl,
        pdfBase64: payload.pdfBase64
      }
    });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/print', authRequired, requireAccess('metro-labeling'), async (req, res, next) => {
  try {
    const body = labelPrintSchema.parse(req.body);
    const label = await findLabel(body);
    if (!label) return res.status(404).json({ message: 'Label row was not found.' });
    const payload = await buildPrintPayload(label, body.type);
    let updated = label;
    if (!body.prepareOnly) {
      const status = body.action === 'reprint' || ['Printed', 'Reprinted'].includes(label.status) ? 'Reprinted' : 'Printed';
      const result = await markPrintResult(label, body, req, status);
      updated = result.row;
    } else {
      updated = label;
    }
    res.json({
      row: updated,
      ...payload,
      localAgentJob: {
        printerName: body.printerName,
        type: body.type,
        labelSize: '4x2',
        ...payload.label,
        zpl: payload.zpl,
        pdfBase64: payload.pdfBase64
      },
      ...getDriveWriteQueueStatus()
    });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/reprint', authRequired, requireAccess('metro-labeling'), async (req, res, next) => {
  try {
    const body = labelPrintSchema.parse({ ...req.body, action: 'reprint' });
    const label = await findLabel(body);
    if (!label) return res.status(404).json({ message: 'Label row was not found.' });
    const payload = await buildPrintPayload(label, body.type);
    const result = body.prepareOnly ? { row: label } : await markPrintResult(label, body, req, 'Reprinted');
    const updated = result.row;
    res.json({
      row: updated,
      ...payload,
      localAgentJob: {
        printerName: body.printerName,
        type: body.type,
        labelSize: '4x2',
        ...payload.label,
        zpl: payload.zpl,
        pdfBase64: payload.pdfBase64
      },
      ...getDriveWriteQueueStatus()
    });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/print/confirm', authRequired, requireAccess('metro-labeling'), async (req, res, next) => {
  try {
    const body = labelPrintSchema.parse(req.body);
    const label = await findLabel(body);
    if (!label) return res.status(404).json({ message: 'Label row was not found.' });
    const status = body.errorMessage ? 'Error' : (body.action === 'reprint' || ['Printed', 'Reprinted'].includes(label.status) ? 'Reprinted' : 'Printed');
    const result = await markPrintResult(label, body, req, status, body.errorMessage || '');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

labelsRouter.get('/sync/status', authRequired, requireAccess('metro-labeling'), (_req, res) => {
  res.json(getDriveWriteQueueStatus());
});

labelsRouter.post('/sync/retry', authRequired, requireAccess('metro-labeling'), (_req, res) => {
  res.json({ retried: retryFailedDriveWrites(), ...getDriveWriteQueueStatus() });
});

labelsRouter.get('/complete/summary', authRequired, requireAccess('metro-labeling'), requireFileCompleter, async (req, res, next) => {
  try {
    const rows = await readTodayMetroRows({ includeClosed: true });
    const completedAt = nowIso();
    const summary = await buildMetroCompleteSummary(rows, { completedBy: req.user.username, completedAt });
    res.json({ summary, warning: summary.pending > 0 ? 'Some labels are still pending. Complete anyway?' : '' });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/complete', authRequired, requireAccess('metro-labeling'), requireFileCompleter, async (req, res, next) => {
  try {
    await flushDriveWriteQueue();
    const rows = await readTodayMetroRows({ includeClosed: true });
    const completedAt = nowIso();
    const summary = await buildMetroCompleteSummary(rows, { completedBy: req.user.username, completedAt });
    if (summary.pending > 0 && !req.body?.completeAnyway) {
      return res.status(409).json({ message: 'Some labels are still pending. Complete anyway?', summary });
    }
    const saved = await saveMetroCompletedFile(rows, summary);
    await audit({
      actor: req.user.username,
      action: 'metro_file_completed',
      entity: 'MetroLabeling',
      entityId: summary.uploadedFileId || summary.fileName,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: {
        ...summary,
        completedFileId: saved.completedFile.id,
        summaryFileId: saved.summaryFile.id
      }
    });
    markMetroFileCompleted({ completedBy: req.user.username, completedAt });
    res.json({
      message: 'Metro file completed and saved to Drive.',
      batchStatus: 'Completed',
      rows: [],
      summary,
      completedFile: saved.completedFile,
      summaryFile: saved.summaryFile,
      ...getDriveWriteQueueStatus()
    });
  } catch (error) {
    next(error);
  }
});

labelsRouter.get('/completed-files', authRequired, requireAccess('metro-labeling'), requireFileCompleter, async (_req, res, next) => {
  try {
    res.json({ files: await listCompletedMetroFiles() });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/completed-files/:fileId/reload', authRequired, requireAccess('metro-labeling'), requireFileCompleter, async (req, res, next) => {
  try {
    const rows = await reloadCompletedMetroFile(req.params.fileId);
    await audit({
      actor: req.user.username,
      action: 'metro_completed_file_reloaded',
      entity: 'MetroLabeling',
      entityId: req.params.fileId,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { rows: rows.length }
    });
    res.json({
      message: 'Completed Metro file reloaded.',
      rows,
      count: rows.length,
      batchStatus: 'Reloaded Completed',
      ...getDriveWriteQueueStatus()
    });
  } catch (error) {
    next(error);
  }
});

labelsRouter.get('/batch/summary', authRequired, requireAccess('metro-labeling'), requireBatchCloser, async (_req, res, next) => {
  try {
    const rows = await readTodayMetroRows({ includeClosed: true });
    const summary = await buildMetroCloseSummary(rows);
    res.json({ summary, warning: summary.pending > 0 ? 'There are pending labels. Close anyway?' : '' });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/batch/close', authRequired, requireAccess('metro-labeling'), requireBatchCloser, async (req, res, next) => {
  try {
    await flushDriveWriteQueue();
    const rows = await readTodayMetroRows({ includeClosed: true });
    const summary = await buildMetroCloseSummary(rows);
    if (summary.pending > 0 && !req.body?.closeAnyway) {
      return res.status(409).json({ message: 'There are pending labels. Close anyway?', summary });
    }
    const printRows = await readRows(tabs.printLogs);
    await saveFinalMetroFiles(rows, printRows);
    const closedAt = nowIso();
    const saved = await saveMetroCloseSummary({ ...summary, closedAt }, { closedBy: req.user.username });
    await audit({
      actor: req.user.username,
      action: 'metro_batch_closed',
      entity: 'MetroLabeling',
      entityId: summary.date,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { ...summary, closedAt, closeSummaryFileId: saved.driveFile.id }
    });
    markMetroBatchClosed({ closedBy: req.user.username });
    res.json({
      message: 'Metro batch closed. Upload a new file to begin.',
      batchStatus: 'Closed',
      rows: [],
      summary: { ...summary, closedBy: req.user.username, closedAt },
      closeSummaryFile: saved.driveFile,
      closeSummaryFileName: saved.fileName,
      ...getDriveWriteQueueStatus()
    });
  } catch (error) {
    next(error);
  }
});

labelsRouter.get('/batch/close-summary/download', authRequired, requireAccess('metro-labeling'), requireBatchCloser, (_req, res) => {
  const closeSummary = getLastCloseSummary();
  if (!closeSummary?.buffer) return res.status(404).json({ message: 'No close summary is available for download.' });
  res.setHeader('Content-Type', mimeFor('xlsx'));
  res.setHeader('Content-Disposition', `attachment; filename="${closeSummary.fileName}"`);
  res.send(closeSummary.buffer);
});

labelsRouter.patch('/:id', authRequired, requireAccess('metro-labeling'), async (req, res, next) => {
  try {
    const current = await findLabel({ id: req.params.id });
    if (!current) return res.status(404).json({ message: 'Label row was not found.' });
    const patch = labelPatch({
      ...req.body,
      currentDeliveryAddress: current.deliveryAddress || current.address || '',
      currentCity: current.city || '',
      currentPostalCode: current.postalCode || ''
    });
    const row = await updateRowById(tabs.metroLabeling, req.params.id, patch);
    await audit({
      actor: req.user.username,
      action: 'metro_label_updated',
      entity: 'MetroLabeling',
      entityId: req.params.id,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { trackingNumber: current.trackingNumber }
    });
    res.json({ row });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/export', authRequired, requireAccess('exports'), async (req, res, next) => {
  try {
    const format = ['csv', 'xlsx', 'pdf'].includes(req.body?.format) ? req.body.format : 'csv';
    const rows = filterLabels(await readRows(tabs.metroLabeling), req.body?.filters || {});
    const timestamp = nowIso();
    const buffer = await buildExport(format, rows, {
      user: req.user.username,
      timestamp,
      report: 'Metro Labeling',
      rowCount: rows.length
    });
    const fileName = `metro-labels-${timestamp.replace(/[:.]/g, '-')}.${format}`;
    const driveFile = await uploadBufferToDrive({ buffer, fileName, mimeType: mimeFor(format) });
    await appendRows(tabs.exports, [{
      id: id('export'),
      type: 'metro-labeling',
      format,
      filters: JSON.stringify(req.body?.filters || {}),
      rowCount: rows.length,
      requestedBy: req.user.username,
      driveFileId: driveFile.id,
      fileName,
      createdAt: timestamp
    }]);
    res.setHeader('Content-Type', mimeFor(format));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});
