import express from 'express';
import { adminAuthDiagnostic, config, facilitySourceConfigured, googleConfigError } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { checkFacilitySourceReadable } from '../services/facilityAnalyticsService.js';
import { checkDriveExcelStorage, ensureCoreFiles } from '../services/driveExcelStore.js';

export const healthRouter = express.Router();

healthRouter.get('/', async (_req, res) => {
  const configured = facilitySourceConfigured();
  const [facilitySource, driveStorage] = await Promise.all([
    checkFacilitySourceReadable(),
    checkDriveExcelStorage()
  ]);
  res.json({
    ok: true,
    version: config.version,
    buildDate: config.buildDate,
    adminAuth: adminAuthDiagnostic(),
    googleConfigured: configured,
    facilitySourceConfigured: facilitySource.facilitySourceConfigured,
    facilitySourceReadable: facilitySource.facilitySourceReadable,
    facilitySourceSheet: facilitySource.facilitySourceSheet,
    facilitySourceError: facilitySource.facilitySourceError,
    driveFolderConfigured: Boolean(config.google.driveFolderId),
    driveStorageConfigured: driveStorage.driveStorageConfigured,
    driveStorageWritable: driveStorage.driveStorageWritable,
    todayMetroFolder: driveStorage.todayMetroFolder,
    driveStorageError: driveStorage.driveStorageError,
    googleConfigError: configured ? '' : googleConfigError(),
    dataSource: 'Google Sheets API (Facility Operations Sort sheet read-only)',
    platformStorage: 'Google Drive Excel files',
    fileStorage: 'Google Drive API'
  });
});

healthRouter.post('/initialize-drive-storage', authRequired, requireAccess('settings'), async (_req, res, next) => {
  try {
    await ensureCoreFiles();
    res.json({ ok: true, message: 'Google Drive Excel storage files are ready.' });
  } catch (error) {
    next(error);
  }
});
