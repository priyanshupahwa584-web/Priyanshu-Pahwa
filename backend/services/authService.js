import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { appendRows, readRows, updateRowById } from './googleSheets.js';
import { defaultPermissionsByRole, roles, tabs } from './sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';

const maxFailures = 5;
const lockMs = 15 * 60 * 1000;
const envAdminState = { failedLoginCount: 0, lockedUntil: '' };
let cachedEnvAdminPasswordHash = '';

async function envAdminPasswordHash() {
  if (config.adminPasswordHash) return config.adminPasswordHash;
  if (!config.adminPassword) return '';
  if (!cachedEnvAdminPasswordHash) {
    cachedEnvAdminPasswordHash = await bcrypt.hash(config.adminPassword, 12);
  }
  return cachedEnvAdminPasswordHash;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role,
    active: String(user.active).toLowerCase() !== 'false',
    permissions: user.role === 'Admin'
      ? defaultPermissionsByRole.Admin
      : String(user.permissions || '').split(',').map((item) => item.trim()).filter(Boolean)
  };
}

export function signUser(user, rememberDevice = false, secure = false) {
  const canRemember = rememberDevice && config.isProduction && secure;
  const maxAge = canRemember ? 30 * 24 * 60 * 60 : 8 * 60 * 60;
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, source: user.source || 'sheet' },
    config.jwtSecret,
    { expiresIn: canRemember ? '30d' : config.jwtExpiresIn }
  );
  return { token, maxAge, remembered: canRemember };
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export async function findUser(username) {
  const envPasswordHash = await envAdminPasswordHash();
  if (config.adminUsername && envPasswordHash && username.toLowerCase() === config.adminUsername.toLowerCase()) {
    return {
      id: 'env_admin',
      username: config.adminUsername,
      displayName: config.adminUsername,
      passwordHash: envPasswordHash,
      role: 'Admin',
      active: 'true',
      permissions: defaultPermissionsByRole.Admin.join(','),
      failedLoginCount: envAdminState.failedLoginCount,
      lockedUntil: envAdminState.lockedUntil,
      source: 'env'
    };
  }
  let users = [];
  try {
    users = await readRows(tabs.users);
  } catch (error) {
    if (error?.statusCode === 503) return null;
    throw error;
  }
  return users.find((user) => String(user.username || '').toLowerCase() === username.toLowerCase()) || null;
}

export async function authenticate({ username, password }) {
  const user = await findUser(username);
  if (!user || String(user.active).toLowerCase() === 'false') return { ok: false, reason: 'invalid' };
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) return { ok: false, reason: 'locked' };
  let valid = false;
  try {
    valid = Boolean(user.passwordHash) && await bcrypt.compare(password, user.passwordHash);
  } catch (error) {
    console.error('Password verification failed:', error);
  }
  if (!valid) {
    const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
    const lockedUntil = failedLoginCount >= maxFailures ? new Date(Date.now() + lockMs).toISOString() : '';
    if (user.source === 'env') {
      envAdminState.failedLoginCount = failedLoginCount;
      envAdminState.lockedUntil = lockedUntil;
    } else {
      await updateRowById(tabs.users, user.id, { failedLoginCount, lockedUntil, updatedAt: nowIso() });
    }
    return { ok: false, reason: lockedUntil ? 'locked' : 'invalid', failedLoginCount };
  }
  if (user.source === 'env') {
    envAdminState.failedLoginCount = 0;
    envAdminState.lockedUntil = '';
  } else {
    await updateRowById(tabs.users, user.id, { failedLoginCount: 0, lockedUntil: '', lastLogin: nowIso(), updatedAt: nowIso() });
  }
  return { ok: true, user: publicUser(user) };
}

export async function createUser({ username, displayName, password, role, active = true, permissions = [] }) {
  if (!roles.includes(role)) {
    const error = new Error('Unsupported role.');
    error.statusCode = 400;
    throw error;
  }
  const existing = await findUser(username);
  if (existing) {
    const error = new Error('Username already exists.');
    error.statusCode = 409;
    throw error;
  }
  const createdAt = nowIso();
  const record = {
    id: id('user'),
    username,
    displayName: displayName || username,
    passwordHash: await bcrypt.hash(password, 12),
    role,
    active: active ? 'true' : 'false',
    permissions: role === 'Admin' ? defaultPermissionsByRole.Admin.join(',') : permissions.join(','),
    failedLoginCount: 0,
    lockedUntil: '',
    lastLogin: '',
    createdAt,
    updatedAt: createdAt
  };
  await appendRows(tabs.users, [record]);
  return publicUser(record);
}

export async function updateUser(userId, patch) {
  const users = await readRows(tabs.users);
  const current = users.find((user) => user.id === userId);
  if (!current) return null;
  const next = {
    username: patch.username ?? current.username,
    displayName: patch.displayName ?? current.displayName,
    role: patch.role ?? current.role,
    active: typeof patch.active === 'boolean' ? String(patch.active) : String(current.active || 'true'),
    permissions: Array.isArray(patch.permissions) ? patch.permissions.join(',') : current.permissions,
    updatedAt: nowIso()
  };
  if (patch.password) next.passwordHash = await bcrypt.hash(patch.password, 12);
  const updated = await updateRowById(tabs.users, userId, next);
  return publicUser(updated);
}

export async function listUsers() {
  const users = await readRows(tabs.users);
  return users.map(publicUser);
}
