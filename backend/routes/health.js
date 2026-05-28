import express from 'express';
import { config, googleConfigured } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { ensureCoreTabs } from '../services/googleSheets.js';

export const healthRouter = express.Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    version: config.version,
    buildDate: config.buildDate,
    googleConfigured: googleConfigured(),
    dataSource: 'Google Sheets API',
    fileStorage: 'Google Drive API'
  });
});

healthRouter.post('/initialize-google-tabs', authRequired, requireAccess('settings'), async (_req, res, next) => {
  try {
    await ensureCoreTabs();
    res.json({ ok: true, message: 'Google Sheet tabs are ready.' });
  } catch (error) {
    next(error);
  }
});
