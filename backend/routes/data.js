import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { readFacilityOperationRows } from '../services/facilityAnalyticsService.js';

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
    const source = await readFacilityOperationRows();
    const rows = filterOperations(source.rows, req.query);
    const facilities = source.facilities.length
      ? source.facilities
      : Array.from(new Set(rows.map((row) => row.facility).filter(Boolean))).sort();
    res.json({ rows, facilities, count: rows.length });
  } catch (error) {
    next(error);
  }
});

dataRouter.post('/', authRequired, requireAccess('data'), (_req, res) => {
  res.status(403).json({ message: 'Facility Operations is read-only. Update operational source data in the Facility Operations Sort workbook.' });
});

dataRouter.put('/:id', authRequired, requireAccess('data'), (_req, res) => {
  res.status(403).json({ message: 'Facility Operations is read-only. Update operational source data in the Facility Operations Sort workbook.' });
});

dataRouter.delete('/:id', authRequired, requireAccess('data'), (_req, res) => {
  res.status(403).json({ message: 'Facility Operations is read-only. Update operational source data in the Facility Operations Sort workbook.' });
});
