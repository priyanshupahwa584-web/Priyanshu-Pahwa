import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { buildExport, mimeFor } from '../services/exportService.js';
import { uploadBufferToDrive } from '../services/googleDrive.js';
import { appendRows, readRows } from '../services/driveExcelStore.js';
import { tabs } from '../services/sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';
import { fulfilmentReportSchema } from '../utils/validation.js';

export const fulfilmentRouter = express.Router();

function requireReportExporter(req, res, next) {
  if (['Admin', 'Supervisor'].includes(req.user?.role)) return next();
  return res.status(403).json({ message: 'Only Admin or Supervisor can export fulfilment reports.' });
}

function filterMetroRows(rows, filters = {}) {
  return rows.filter((row) => {
    if (filters.service && String(row.service || '').toLowerCase() !== String(filters.service).toLowerCase()) return false;
    if (filters.route && String(row.route || '').toLowerCase() !== String(filters.route).toLowerCase()) return false;
    return true;
  });
}

function calculateReport(rows, body, user) {
  const totalUploaded = rows.length;
  const totalPrinted = rows.filter((row) => ['printed', 'reprinted'].includes(String(row.status || '').toLowerCase())).length;
  const pending = rows.filter((row) => String(row.status || '').toLowerCase() === 'pending').length;
  const errors = rows.filter((row) => String(row.status || '').toLowerCase() === 'error').length;
  const completionPercent = totalUploaded ? Math.round((totalPrinted / totalUploaded) * 10000) / 100 : 0;
  const timestamp = nowIso();
  return {
    id: id('fulfil'),
    reportDate: body.reportDate || timestamp.slice(0, 10),
    client: body.client || 'Metro',
    service: body.service || 'All',
    route: body.route || 'All',
    totalUploaded,
    totalPrinted,
    pending,
    errors,
    completionPercent,
    createdBy: user.username,
    createdAt: timestamp
  };
}

async function exportReports(req, res, next, format) {
  try {
    const rows = await readRows(tabs.fulfilmentReports);
    const timestamp = nowIso();
    const buffer = await buildExport(format, rows, {
      user: req.user.username,
      timestamp,
      report: 'Fulfilment Reports',
      rowCount: rows.length
    });
    const fileName = `fulfilment-reports-${timestamp.replace(/[:.]/g, '-')}.${format}`;
    const driveFile = await uploadBufferToDrive({ buffer, fileName, mimeType: mimeFor(format) });
    await appendRows(tabs.exports, [{
      id: id('export'),
      type: 'fulfilment-report',
      format,
      filters: JSON.stringify(req.query || {}),
      rowCount: rows.length,
      requestedBy: req.user.username,
      driveFileId: driveFile.id,
      fileName,
      createdAt: timestamp
    }]);
    await audit({
      actor: req.user.username,
      action: 'fulfilment_report_exported',
      entity: 'ExportLogs',
      entityId: driveFile.id,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { format, rows: rows.length }
    });
    res.setHeader('Content-Type', mimeFor(format));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

fulfilmentRouter.get('/report', authRequired, requireAccess('fulfilment'), async (_req, res, next) => {
  try {
    res.json({ rows: (await readRows(tabs.fulfilmentReports)).reverse().slice(0, 200) });
  } catch (error) {
    next(error);
  }
});

fulfilmentRouter.post('/report/generate', authRequired, requireAccess('fulfilment'), async (req, res, next) => {
  try {
    const body = fulfilmentReportSchema.parse(req.body);
    const metroRows = filterMetroRows(await readRows(tabs.metroLabeling), body);
    const report = calculateReport(metroRows, body, req.user);
    await appendRows(tabs.fulfilmentReports, [report]);
    await audit({
      actor: req.user.username,
      action: 'fulfilment_report_generated',
      entity: 'FulfilmentReports',
      entityId: report.id,
      ip: req.ip,
      device: req.get('user-agent') || '',
      metadata: { service: body.service, route: body.route, totalUploaded: report.totalUploaded }
    });
    res.status(201).json({ report });
  } catch (error) {
    next(error);
  }
});

fulfilmentRouter.get('/report/export/csv', authRequired, requireAccess('fulfilment'), requireReportExporter, (req, res, next) => exportReports(req, res, next, 'csv'));
fulfilmentRouter.get('/report/export/xlsx', authRequired, requireAccess('fulfilment'), requireReportExporter, (req, res, next) => exportReports(req, res, next, 'xlsx'));
fulfilmentRouter.get('/report/export/pdf', authRequired, requireAccess('fulfilment'), requireReportExporter, (req, res, next) => exportReports(req, res, next, 'pdf'));
