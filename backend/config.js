import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const rootDir = process.cwd();
const runtimeDir = path.join(rootDir, '.runtime');
const uploadDir = path.join(runtimeDir, 'uploads');
const exportDir = path.join(runtimeDir, 'exports');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });

function required(name) {
  return process.env[name] || '';
}

function parsePrivateKey(value) {
  return value ? value.replace(/\\n/g, '\n') : '';
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

const generatedSecret = crypto.randomBytes(48).toString('hex');

export const config = {
  rootDir,
  frontendDist: path.join(rootDir, 'frontend', 'dist'),
  uploadDir,
  exportDir,
  port: Number(process.env.PORT || 4000),
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  jwtSecret: process.env.JWT_SECRET || generatedSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieName: 'br_session',
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  google: {
    projectId: required('GOOGLE_PROJECT_ID'),
    clientEmail: required('GOOGLE_CLIENT_EMAIL'),
    privateKey: parsePrivateKey(required('GOOGLE_PRIVATE_KEY')),
    sheetId: required('GOOGLE_SHEET_ID'),
    driveFolderId: required('GOOGLE_DRIVE_FOLDER_ID')
  },
  corsOrigins: (process.env.CORS_ORIGIN || 'http://127.0.0.1:4000,http://localhost:4000,http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  version: packageVersion(),
  buildDate: process.env.BUILD_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
};

export function googleConfigured() {
  return Boolean(config.google.clientEmail && config.google.privateKey && config.google.sheetId);
}
