import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { getDriveWriteQueueStatus, getPerformanceStatus } from '../services/metroCacheService.js';

export const performanceRouter = express.Router();

performanceRouter.get('/status', authRequired, requireAccess('settings'), (_req, res) => {
  res.json({
    ...getPerformanceStatus(),
    ...getDriveWriteQueueStatus()
  });
});
