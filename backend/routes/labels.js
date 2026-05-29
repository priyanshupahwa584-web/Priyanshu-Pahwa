import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { buildExport, mimeFor } from '../services/exportService.js';
import { uploadBufferToDrive, uploadFileToDriveFolder } from '../services/googleDrive.js';
import { appendRows, readRows, updateRowById } from '../services/googleSheets.js';
import { parseMetroLabelFile } from '../services/labelImportService.js';
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
  const rows = await readRows(tabs.metroLabeling);
  return rows.find((row) => (rowId && row.id === rowId) || (trackingNumber && row.trackingNumber === trackingNumber)) || null;
}

function exactTrackingMatch(row, value) {
  const tracking = String(value || '').trim().toLowerCase();
  if (!tracking) return false;
  return [row.trackingNumber, row.barcodeValue].some((candidate) => String(candidate || '').trim().toLowerCase() === tracking);
}

async function markPrintResult(label, body, req, status, errorMessage = '') {
  const timestamp = nowIso();
  const action = body.action === 'reprint' || ['Printed', 'Reprinted'].includes(label.status) ? 'reprint' : 'print';
  const reprintCount = action === 'reprint' ? Number(label.reprintCount || 0) + 1 : Number(label.reprintCount || 0);
  const updated = await updateRowById(tabs.metroLabeling, label.id, {
    status,
    printedAt: status === 'Error' ? label.printedAt || '' : timestamp,
    printedBy: status === 'Error' ? label.printedBy || '' : req.user.username,
    printerName: body.printerName || label.printerName || '',
    reprintCount,
    errorMessage,
    updatedAt: timestamp
  });
  await appendRows(tabs.printLogs, [{
    id: id('print'),
    trackingNumber: label.trackingNumber,
    action,
    userId: req.user.username,
    status,
    printerName: body.printerName || '',
    timestamp,
    errorMessage
  }]);
  await audit({
    actor: req.user.username,
    action: status === 'Error' ? 'label_print_failed' : `label_${action}ed`,
    entity: 'MetroLabeling',
    entityId: label.id,
    ip: req.ip,
    device: req.get('user-agent') || '',
    metadata: { trackingNumber: label.trackingNumber, printerName: body.printerName || '', status, errorMessage }
  });
  return updated;
}

async function markPendingPrint(label) {
  return updateRowById(tabs.metroLabeling, label.id, {
    status: 'Pending Print',
    errorMessage: '',
    updatedAt: nowIso()
  });
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
    const rows = filterLabels(await readRows(tabs.metroLabeling), req.query).reverse();
    res.json({ rows, count: rows.length });
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
    const rows = await readRows(tabs.metroLabeling);
    const row = rows.find((item) => exactTrackingMatch(item, trackingNumber));
    await audit({
      actor: req.user.username,
      action: row ? 'metro_label_scanned' : 'metro_label_scan_not_found',
      entity: 'MetroLabeling',
      entityId: row?.id || '',
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { trackingNumber, status: row?.status || 'Not found' }
    });
    if (!row) return res.status(404).json({ message: 'Tracking not found.' });
    res.json({ row, scannedBy: req.user.username, scannedAt: nowIso() });
  } catch (error) {
    next(error);
  }
});

labelsRouter.post('/upload', authRequired, requireAccess('metro-labeling'), requireLabelUploader, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a CSV, XLSX, XLSM, or JSON label file first.' });
    let driveFile = { id: '', name: req.file.originalname };
    let archiveWarning = '';
    if (config.google.driveFolderId) {
      driveFile = await uploadFileToDriveFolder({
        filePath: req.file.path,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        folderName: 'Labels'
      });
    } else {
      archiveWarning = 'Drive archive folder not configured. File imported but original upload was not archived.';
    }
    const parsed = await parseMetroLabelFile(req.file.path, req.file.originalname, driveFile.id, req.user.username);
    if (!parsed.rows.length && parsed.errors.length) {
      await appendRows(tabs.uploads, [{
        id: id('upload'),
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        driveFileId: driveFile.id,
        size: req.file.size,
        uploadedBy: req.user.username,
        status: archiveWarning ? 'Failed - Not Archived' : 'Failed',
        message: archiveWarning || JSON.stringify(parsed.errors.slice(0, 20)),
        createdAt: nowIso()
      }]);
      const missingTracking = parsed.errors.some((error) => String(error.message || '').includes('Tracking Number'));
      return res.status(400).json({
        message: missingTracking ? 'Upload file is missing Tracking Number.' : 'Label import validation failed.',
        errors: parsed.errors,
        importedRows: 0,
        skippedRows: parsed.skippedCount,
        rejectedRows: parsed.rejectedCount,
        warning: archiveWarning
      });
    }
    await appendRows(tabs.metroLabeling, parsed.rows);
    await appendRows(tabs.uploads, [{
      id: id('upload'),
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
        driveFileId: driveFile.id,
        size: req.file.size,
        uploadedBy: req.user.username,
        status: archiveWarning ? 'Imported - Not Archived' : parsed.errors.length ? 'Imported With Skips' : 'Imported',
        message: archiveWarning || `${parsed.rows.length} Metro label rows imported${parsed.errors.length ? `, ${parsed.errors.length} rejected` : ''}`,
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
      warning: archiveWarning,
      rows: parsed.rows.slice(0, 50)
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
      updated = await markPrintResult(label, body, req, status);
    } else {
      updated = await markPendingPrint(label) || label;
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
      }
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
    const updated = body.prepareOnly ? await markPendingPrint(label) || label : await markPrintResult(label, body, req, 'Reprinted');
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
      }
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
    const row = await markPrintResult(label, body, req, status, body.errorMessage || '');
    res.json({ row });
  } catch (error) {
    next(error);
  }
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
