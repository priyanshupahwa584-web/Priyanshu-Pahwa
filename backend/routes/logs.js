import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { readRows } from '../services/googleSheets.js';
import { tabs } from '../services/sheetSchema.js';

export const logsRouter = express.Router();

function inDateRange(row, from, to) {
  const createdAt = String(row.createdAt || row.timestamp || '');
  if (from && createdAt && createdAt < from) return false;
  if (to && createdAt && createdAt > to) return false;
  return true;
}

function filterRows(rows, query = {}) {
  const username = String(query.username || '').trim().toLowerCase();
  const action = String(query.action || '').trim().toLowerCase();
  const ip = String(query.ip || '').trim().toLowerCase();
  const device = String(query.device || '').trim().toLowerCase();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  return rows.filter((row) => {
    if (username && !String(row.actor || row.uploadedBy || row.requestedBy || row.userId || '').toLowerCase().includes(username)) return false;
    if (action && !String(row.action || row.status || row.type || '').toLowerCase().includes(action)) return false;
    if (ip && !String(row.ip || '').toLowerCase().includes(ip)) return false;
    if (device && !String(row.device || '').toLowerCase().includes(device)) return false;
    return inDateRange(row, from, to);
  });
}

logsRouter.get('/audit', authRequired, requireAccess('activity'), async (req, res, next) => {
  try {
    res.json({ rows: filterRows(await readRows(tabs.audit), req.query).reverse().slice(0, 300) });
  } catch (error) {
    next(error);
  }
});

logsRouter.get('/uploads', authRequired, requireAccess('activity'), async (req, res, next) => {
  try {
    res.json({ rows: filterRows(await readRows(tabs.uploads), req.query).reverse().slice(0, 300) });
  } catch (error) {
    next(error);
  }
});

logsRouter.get('/exports', authRequired, requireAccess('activity'), async (req, res, next) => {
  try {
    res.json({ rows: filterRows(await readRows(tabs.exports), req.query).reverse().slice(0, 300) });
  } catch (error) {
    next(error);
  }
});
