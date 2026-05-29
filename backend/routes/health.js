import express from 'express';
import { adminAuthDiagnostic, config, facilitySourceConfigured, googleConfigError, googleConfigured, platformStorageConfigured } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { ensurePlatformStorage } from '../services/googleSheets.js';
import { checkStorage } from '../services/storageChecks.js';

export const healthRouter = express.Router();

healthRouter.get('/', async (_req, res) => {
  const configured = googleConfigured();
  const storage = await checkStorage();
  res.json({
    ok: true,
    version: config.version,
    buildDate: config.buildDate,
    adminAuth: adminAuthDiagnostic(),
    googleConfigured: configured,
    facilitySourceConfigured: facilitySourceConfigured(),
    platformDataConfigured: platformStorageConfigured(),
    driveFolderConfigured: Boolean(config.google.driveFolderId),
    googleConfigError: configured ? '' : googleConfigError(),
    storage,
    facilitySourceReadable: storage.facilitySourceReadable,
    platformDataReadable: storage.platformDataReadable,
    platformDataWritable: storage.platformDataWritable,
    driveFolderWritable: storage.driveFolderWritable,
    missingPlatformTabs: storage.missingPlatformTabs,
    dataSource: 'Google Sheets API',
    fileStorage: 'Google Drive API'
  });
});

async function initializePlatformStorage(_req, res, next) {
  try {
    await ensurePlatformStorage();
    const storage = await checkStorage();
    res.json({ ok: true, message: 'Platform storage tabs are ready.', storage, missingPlatformTabs: storage.missingPlatformTabs });
  } catch (error) {
    next(error);
  }
}

healthRouter.post('/initialize-platform-storage', authRequired, requireAccess('settings'), initializePlatformStorage);
healthRouter.post('/initialize-google-tabs', authRequired, requireAccess('settings'), initializePlatformStorage);
