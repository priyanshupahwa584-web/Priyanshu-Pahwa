import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { readRows } from '../services/googleSheets.js';
import { tabs } from '../services/sheetSchema.js';

export const logsRouter = express.Router();

logsRouter.get('/audit', authRequired, requireAccess('activity'), async (_req, res, next) => {
  try {
    res.json({ rows: (await readRows(tabs.audit)).reverse().slice(0, 300) });
  } catch (error) {
    next(error);
  }
});

logsRouter.get('/uploads', authRequired, requireAccess('activity'), async (_req, res, next) => {
  try {
    res.json({ rows: (await readRows(tabs.uploads)).reverse().slice(0, 300) });
  } catch (error) {
    next(error);
  }
});

logsRouter.get('/exports', authRequired, requireAccess('activity'), async (_req, res, next) => {
  try {
    res.json({ rows: (await readRows(tabs.exports)).reverse().slice(0, 300) });
  } catch (error) {
    next(error);
  }
});
