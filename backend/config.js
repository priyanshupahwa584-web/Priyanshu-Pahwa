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
  return value ? value.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n') : '';
}

function parseServiceAccountJson(value) {
  if (!value) return { credentials: null, error: '' };
  try {
    const parsed = JSON.parse(value);
    return {
      credentials: {
        projectId: parsed.project_id || '',
        clientEmail: parsed.client_email || '',
        privateKey: parsePrivateKey(parsed.private_key || '')
      },
      error: ''
    };
  } catch {
    return {
      credentials: null,
      error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.'
    };
  }
}

function googleCredentials() {
  const serviceAccount = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '');
  if (serviceAccount.credentials || serviceAccount.error) {
    return {
      projectId: serviceAccount.credentials?.projectId || required('GOOGLE_PROJECT_ID'),
      clientEmail: serviceAccount.credentials?.clientEmail || '',
      privateKey: serviceAccount.credentials?.privateKey || '',
      configError: serviceAccount.error
    };
  }
  return {
    projectId: required('GOOGLE_PROJECT_ID'),
    clientEmail: required('GOOGLE_CLIENT_EMAIL'),
    privateKey: parsePrivateKey(required('GOOGLE_PRIVATE_KEY')),
    configError: ''
  };
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
    ? 'https://priyanshu-pahwa.vercel.app,https://*.vercel.app'
    : 'http://127.0.0.1:4000,http://localhost:4000,http://127.0.0.1:5173,http://localhost:5173';
  const raw = process.env.CORS_ORIGIN || defaultOrigins;
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL.trim());
  if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '').trim()}`);
  return Array.from(new Set(origins));
}

const generatedSecret = crypto.randomBytes(48).toString('hex');
const resolvedGoogleCredentials = googleCredentials();

function isBcryptHash(value) {
  return /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(String(value || ''));
}

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
    projectId: resolvedGoogleCredentials.projectId,
    clientEmail: resolvedGoogleCredentials.clientEmail,
    privateKey: resolvedGoogleCredentials.privateKey,
    configError: resolvedGoogleCredentials.configError,
    sheetId: required('GOOGLE_SHEET_ID'),
    driveFolderId: required('GOOGLE_DRIVE_FOLDER_ID')
  },
  corsOrigins: configuredCorsOrigins(),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  version: packageVersion(),
  buildDate: process.env.BUILD_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
};

export function adminAuthDiagnostic() {
  const usernameConfigured = Boolean(config.adminUsername);
  const passwordHashConfigured = Boolean(config.adminPasswordHash);
  const passwordHashLooksValid = passwordHashConfigured && isBcryptHash(config.adminPasswordHash);
  let warning = '';
  if (!usernameConfigured) warning = 'ADMIN_USERNAME is not configured on the server.';
  else if (!passwordHashConfigured) warning = 'ADMIN_PASSWORD_HASH is not configured on the server.';
  else if (!passwordHashLooksValid) warning = 'ADMIN_PASSWORD_HASH is not a valid bcrypt hash.';
  return {
    usernameConfigured,
    passwordHashConfigured,
    passwordHashLooksValid,
    configured: usernameConfigured && passwordHashLooksValid,
    warning
  };
}

export function adminAuthConfigured() {
  return adminAuthDiagnostic().configured;
}

export function adminAuthConfigWarning() {
  return adminAuthDiagnostic().warning;
}

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
  return facilitySourceConfigured();
}

export function googleCredentialsConfigured() {
  return Boolean(!config.google.configError && config.google.clientEmail && config.google.privateKey);
}

export function facilitySourceConfigured() {
  return Boolean(googleCredentialsConfigured() && config.google.sheetId);
}

export function driveStorageConfigured() {
  return Boolean(googleCredentialsConfigured() && config.google.driveFolderId);
}

export function googleCredentialsError() {
  if (config.google.configError) return config.google.configError;
  if (!config.google.clientEmail || !config.google.privateKey) return 'Google service account credentials are not configured on the server.';
  return '';
}

export function facilitySourceConfigError() {
  const credentialsError = googleCredentialsError();
  if (credentialsError) return credentialsError;
  if (!config.google.sheetId) return 'GOOGLE_SHEET_ID is not configured on the server.';
  return '';
}

export function driveStorageConfigError() {
  const credentialsError = googleCredentialsError();
  if (credentialsError) return credentialsError;
  if (!config.google.driveFolderId) return 'GOOGLE_DRIVE_FOLDER_ID is not configured. Share the root BROPS Storage folder with the service account and set GOOGLE_DRIVE_FOLDER_ID.';
  return '';
}

export function googleConfigError(target = 'facility') {
  if (target === 'drive') return driveStorageConfigError();
  return facilitySourceConfigError();
}
