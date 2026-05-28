import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { appendRows, deleteRowById, readRows, updateRowById } from '../services/googleSheets.js';
import { tabs } from '../services/sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';
import { dataRowSchema } from '../utils/validation.js';

export const dataRouter = express.Router();

export function filterOperations(rows, filters = {}) {
  return rows.filter((row) => {
    if (filters.dateFrom && String(row.date) < filters.dateFrom) return false;
    if (filters.dateTo && String(row.date) > filters.dateTo) return false;
    if (filters.facility && String(row.facility).toLowerCase() !== String(filters.facility).toLowerCase()) return false;
    if (filters.status && String(row.status).toLowerCase() !== String(filters.status).toLowerCase()) return false;
    if (filters.search) {
      const haystack = `${row.date} ${row.facility} ${row.status} ${row.notes}`.toLowerCase();
      if (!haystack.includes(String(filters.search).toLowerCase())) return false;
    }
    return true;
  });
}

dataRouter.get('/', authRequired, requireAccess('data'), async (req, res, next) => {
  try {
    const rows = filterOperations(await readRows(tabs.operations), req.query);
    const facilities = Array.from(new Set(rows.map((row) => row.facility).filter(Boolean))).sort();
    res.json({ rows, facilities, count: rows.length });
  } catch (error) {
    next(error);
  }
});

dataRouter.post('/', authRequired, requireAccess('data'), async (req, res, next) => {
  try {
    const body = dataRowSchema.parse(req.body);
    const createdAt = nowIso();
    const record = { id: id('op'), ...body, createdAt, updatedAt: createdAt, createdBy: req.user.username };
    await appendRows(tabs.operations, [record]);
    await audit({ actor: req.user.username, action: 'data_created', entity: 'OperationsData', entityId: record.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.status(201).json({ row: record });
  } catch (error) {
    next(error);
  }
});

dataRouter.put('/:id', authRequired, requireAccess('data'), async (req, res, next) => {
  try {
    const body = dataRowSchema.partial().parse(req.body);
    const row = await updateRowById(tabs.operations, req.params.id, { ...body, updatedAt: nowIso() });
    if (!row) return res.status(404).json({ message: 'Data row not found.' });
    await audit({ actor: req.user.username, action: 'data_updated', entity: 'OperationsData', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.json({ row });
  } catch (error) {
    next(error);
  }
});

dataRouter.delete('/:id', authRequired, requireAccess('data'), async (req, res, next) => {
  try {
    const deleted = await deleteRowById(tabs.operations, req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Data row not found.' });
    await audit({ actor: req.user.username, action: 'data_deleted', entity: 'OperationsData', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
