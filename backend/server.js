import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { adminAuthConfigWarning, config, driveStorageConfigured, isAllowedOrigin } from './config.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { dataRouter } from './routes/data.js';
import { exportsRouter } from './routes/exports.js';
import { facilityIntelligenceRouter } from './routes/facilityIntelligence.js';
import { healthRouter } from './routes/health.js';
import { importsRouter } from './routes/imports.js';
import { labelsRouter } from './routes/labels.js';
import { fulfilmentRouter } from './routes/fulfilment.js';
import { logsRouter } from './routes/logs.js';
import { systemRouter } from './routes/system.js';
import { usersRouter } from './routes/users.js';
import { apiRateLimit, enforceHttpsInProduction, errorHandler, sameOriginProtection } from './middleware/security.js';

export const app = express();

app.disable('x-powered-by');
if (config.isProduction) app.set('trust proxy', 1);

app.use(enforceHttpsInProduction);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/api', cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS origin is not allowed.'));
  },
  credentials: true
}));
app.use('/api', helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
  hsts: config.isProduction ? undefined : false
}));
app.use('/api', apiRateLimit);
app.use('/api', sameOriginProtection);

app.get('/', (_req, res) => {
  res.json({ service: 'Broadreach Operations API', status: 'running' });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/facility-intelligence', facilityIntelligenceRouter);
app.use('/api/data', dataRouter);
app.use('/api/imports', importsRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/reports/export', exportsRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/metro-labeling', labelsRouter);
app.use('/api/fulfilment', fulfilmentRouter);
app.use('/api/users', usersRouter);
app.use('/api/logs', logsRouter);
app.use('/api/system', systemRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API route not found.' });
});
app.use('/api', errorHandler);

const localFrontendIndex = path.join(config.frontendDist, 'index.html');
if (!config.isProduction && fs.existsSync(localFrontendIndex)) {
  app.use(express.static(config.frontendDist, { fallthrough: true }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(localFrontendIndex);
  });
}

app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found. Use /api routes for this service.' });
});

export function startServer(port = config.port) {
  return app.listen(port, () => {
    console.log(`Broadreach Operations Platform running on http://127.0.0.1:${port}`);
    console.log(`Drive storage configured: ${driveStorageConfigured()}`);
    console.log(`Drive folder ID present: ${Boolean(config.google.driveFolderId)}`);
    const authWarning = adminAuthConfigWarning();
    if (authWarning) console.warn(`Auth configuration warning: ${authWarning}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
