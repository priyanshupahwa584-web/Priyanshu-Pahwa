import express from 'express';
import { adminAuthDiagnostic, config, googleConfigError, googleConfigured } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { ensureCoreTabs } from '../services/googleSheets.js';

export const healthRouter = express.Router();

healthRouter.get('/', (_req, res) => {
  const configured = googleConfigured();
  res.json({
    ok: true,
    version: config.version,
    buildDate: config.buildDate,
    adminAuth: adminAuthDiagnostic(),
    googleConfigured: configured,
    driveFolderConfigured: Boolean(config.google.driveFolderId),
    googleConfigError: configured ? '' : googleConfigError(),
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
