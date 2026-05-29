import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { uploadFileToDrive } from '../services/googleDrive.js';
import { appendRows, readRows } from '../services/googleSheets.js';
import { parseImportFile, validateImportRows } from '../services/importService.js';
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
    const rawRows = await parseImportFile(req.file.path, req.file.originalname);
    const validation = validateImportRows(rawRows);
    if (validation.errors.length) {
      await appendRows(tabs.uploads, [{
        id: id('upload'),
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        driveFileId: '',
        size: req.file.size,
        uploadedBy: req.user.username,
        status: 'Failed',
        message: JSON.stringify(validation.errors.slice(0, 20)),
        createdAt: nowIso()
      }]);
      return res.status(400).json({ message: 'Import validation failed.', errors: validation.errors });
    }
    const driveFile = await uploadFileToDrive({ filePath: req.file.path, fileName: req.file.originalname, mimeType: req.file.mimetype, folderName: 'Metro Uploads' });
    const createdAt = nowIso();
    const records = validation.rows.map((row) => ({ id: id('op'), ...row, createdAt, updatedAt: createdAt, createdBy: req.user.username }));
    await appendRows(tabs.operations, records);
    await appendRows(tabs.uploads, [{
      id: id('upload'),
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      driveFileId: driveFile.id,
      size: req.file.size,
      uploadedBy: req.user.username,
      status: 'Imported',
      message: `${records.length} rows imported`,
      createdAt
    }]);
    await audit({ actor: req.user.username, action: 'file_imported', entity: 'UploadLogs', entityId: driveFile.id, ip: req.ip, device: req.get('user-agent') || '', metadata: { fileName: req.file.originalname, rows: records.length } });
    res.status(201).json({ importedRows: records.length, driveFileId: driveFile.id });
  } catch (error) {
    next(error);
  } finally {
    if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
  }
});
