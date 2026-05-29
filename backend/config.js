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

function configuredCorsOrigins() {
  const defaultOrigins = process.env.NODE_ENV === 'production'
    ? 'https://*.vercel.app'
    : 'http://127.0.0.1:4000,http://localhost:4000,http://127.0.0.1:5173,http://localhost:5173';
  const raw = process.env.CORS_ORIGIN || defaultOrigins;
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL.trim());
  if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '').trim()}`);
  return Array.from(new Set(origins));
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
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 30),
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
  corsOrigins: configuredCorsOrigins(),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  version: packageVersion(),
  buildDate: process.env.BUILD_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
};

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return config.corsOrigins.some((allowed) => {
    if (allowed === origin) return true;
    if (!allowed.includes('*')) return false;
    const pattern = allowed.split('*').map(escapeRegex).join('[^.]+');
    return new RegExp(`^${pattern}$`).test(origin);
  });
}

export function googleConfigured() {
  return Boolean(config.google.clientEmail && config.google.privateKey && config.google.sheetId);
}
