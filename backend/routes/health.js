import express from 'express';
import { adminAuthDiagnostic, config, facilitySourceConfigured, googleConfigError } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { checkFacilitySourceReadable } from '../services/facilityAnalyticsService.js';
import { ensureCoreFiles } from '../services/driveExcelStore.js';
import { runDriveStorageDiagnostics } from '../services/driveDiagnostics.js';

export const healthRouter = express.Router();

healthRouter.get('/', async (_req, res) => {
  const configured = facilitySourceConfigured();
  const [facilitySource, driveStorage] = await Promise.all([
    checkFacilitySourceReadable(),
    runDriveStorageDiagnostics({ writeProbe: true })
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
    driveAuthMode: driveStorage.driveAuthMode,
    driveStorageWritable: driveStorage.driveStorageWritable,
    driveFolderIdPresent: driveStorage.driveFolderIdPresent,
    driveFolderAccessible: driveStorage.driveFolderAccessible,
    serviceAccountEmail: driveStorage.serviceAccountEmail,
    serviceAccountSource: driveStorage.serviceAccountSource,
    serviceAccountJsonPresent: driveStorage.serviceAccountJsonPresent,
    driveErrorCode: driveStorage.driveErrorCode,
    driveErrorMessage: driveStorage.driveErrorMessage,
    driveErrorStatus: driveStorage.driveErrorStatus,
    driveErrorReason: driveStorage.driveErrorReason,
    googleErrorCode: driveStorage.googleErrorCode,
    googleErrorReason: driveStorage.googleErrorReason,
    googleErrorMessage: driveStorage.googleErrorMessage,
    folderExists: driveStorage.folderExists,
    folderName: driveStorage.folderName,
    folderMimeType: driveStorage.folderMimeType,
    folderCapabilities: driveStorage.folderCapabilities,
    folderSharedWithServiceAccount: driveStorage.folderSharedWithServiceAccount,
    writeProbeSuccess: driveStorage.writeProbeSuccess,
    writeProbeFileId: driveStorage.writeProbeFileId,
    driveStorageError: driveStorage.driveErrorMessage,
    writeProbeAttempted: driveStorage.writeProbeAttempted,
    writeProbeFolderCreated: driveStorage.writeProbeFolderCreated,
    writeProbeFileCreated: driveStorage.writeProbeFileCreated,
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
