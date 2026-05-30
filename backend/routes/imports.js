import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { appendRows, readRows } from '../services/driveExcelStore.js';
import { tabs } from '../services/sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';

export const importsRouter = express.Router();

function safeName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext).replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);
  return `${base}-${Date.now()}${ext}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadDir),
    filename: (_req, file, callback) => callback(null, safeName(file.originalname))
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xlsm', '.json'].includes(ext)) return callback(new Error('Only CSV, XLSX, XLSM, and JSON files are allowed.'));
    callback(null, true);
  }
});

importsRouter.get('/logs', authRequired, requireAccess('imports'), async (_req, res, next) => {
  try {
    res.json({ rows: (await readRows(tabs.uploads)).reverse().slice(0, 100) });
  } catch (error) {
    next(error);
  }
});

importsRouter.post('/', authRequired, requireAccess('imports'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a CSV, XLSX, or JSON file first.' });
    const createdAt = nowIso();
    await appendRows(tabs.uploads, [{
      id: id('upload'),
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      driveFileId: '',
      size: req.file.size,
      uploadedBy: req.user.username,
      status: 'Rejected',
      message: 'Facility Operations imports are disabled because the Sort sheet is read-only.',
      createdAt
    }]);
    res.status(405).json({ message: 'Facility Operations imports are disabled. The Google Sheets Sort sheet is read-only.' });
  } catch (error) {
    next(error);
  } finally {
    if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
  }
});
