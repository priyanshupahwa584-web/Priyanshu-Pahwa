import express from 'express';
import { authRequired, requireAdmin } from '../middleware/auth.js';
import { runDriveStorageDiagnostics } from '../services/driveDiagnostics.js';

export const systemRouter = express.Router();

async function driveCheck(_req, res, next) {
  try {
    const diagnostics = await runDriveStorageDiagnostics({
      writeProbe: true,
      force: true,
      includeFolderId: true
    });
    res.status(diagnostics.driveStorageWritable ? 200 : 503).json({
      ok: diagnostics.driveStorageWritable,
      ...diagnostics
    });
  } catch (error) {
    next(error);
  }
}

systemRouter.get('/drive-check', authRequired, requireAdmin, driveCheck);
systemRouter.post('/drive-check', authRequired, requireAdmin, driveCheck);
