import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { buildExport, mimeFor } from '../services/exportService.js';
import { uploadBufferToDrive } from '../services/googleDrive.js';
import { appendRows, readRows } from '../services/driveExcelStore.js';
import { tabs } from '../services/sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';
import { exportSchema } from '../utils/validation.js';
import { filterOperations } from './data.js';

export const exportsRouter = express.Router();

exportsRouter.get('/logs', authRequired, requireAccess('exports'), async (_req, res, next) => {
  try {
    res.json({ rows: (await readRows(tabs.exports)).reverse().slice(0, 100) });
  } catch (error) {
    next(error);
  }
});

exportsRouter.post('/', authRequired, requireAccess('exports'), async (req, res, next) => {
  try {
    const body = exportSchema.parse(req.body);
    const rows = filterOperations(await readRows(tabs.operations), body.filters);
    const timestamp = nowIso();
    const metadata = {
      user: req.user.username,
      timestamp,
      filters: JSON.stringify(body.filters || {}),
      rowCount: rows.length
    };
    const buffer = await buildExport(body.format, rows, metadata);
    const fileName = `broadreach-export-${timestamp.replace(/[:.]/g, '-')}.${body.format}`;
    const driveFile = await uploadBufferToDrive({ buffer, fileName, mimeType: mimeFor(body.format) });
    await appendRows(tabs.exports, [{
      id: id('export'),
      type: 'operations-data',
      format: body.format,
      filters: JSON.stringify(body.filters || {}),
      rowCount: rows.length,
      requestedBy: req.user.username,
      driveFileId: driveFile.id,
      fileName,
      createdAt: timestamp
    }]);
    await audit({ actor: req.user.username, action: 'data_exported', entity: 'ExportLogs', entityId: driveFile.id, ip: req.ip, device: req.get('user-agent') || '', metadata: { format: body.format, rows: rows.length } });
    res.setHeader('Content-Type', mimeFor(body.format));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});
