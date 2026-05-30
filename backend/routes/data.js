import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { readRows } from '../services/driveExcelStore.js';
import { tabs } from '../services/sheetSchema.js';

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
    res.status(405).json({ message: 'Facility Operations is read-only from the Sort sheet. Platform data is stored in Google Drive Excel files.' });
  } catch (error) {
    next(error);
  }
});

dataRouter.put('/:id', authRequired, requireAccess('data'), async (req, res, next) => {
  try {
    res.status(405).json({ message: 'Facility Operations is read-only from the Sort sheet. Platform data is stored in Google Drive Excel files.' });
  } catch (error) {
    next(error);
  }
});

dataRouter.delete('/:id', authRequired, requireAccess('data'), async (req, res, next) => {
  try {
    res.status(405).json({ message: 'Facility Operations is read-only from the Sort sheet. Platform data is stored in Google Drive Excel files.' });
  } catch (error) {
    next(error);
  }
});
