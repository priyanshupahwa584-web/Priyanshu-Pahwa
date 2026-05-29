import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { appendRows, readRows, updateRowById } from './googleSheets.js';
import { defaultPermissionsByRole, roles, tabs } from './sheetSchema.js';
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateTotpSecret, totpUri, verifyTotp } from './totpService.js';
import { id, nowIso } from '../utils/ids.js';

const maxFailures = 5;
const lockMs = 15 * 60 * 1000;
const adminConfigErrorCode = 'admin_auth_config';
const envAdminState = {
  failedLoginCount: 0,
  lockedUntil: '',
  twoFactorEnabled: 'false',
  twoFactorSecret: '',
  twoFactorPendingSecret: '',
  backupCodeHashes: '',
  passwordChangedAt: ''
};
const envSessions = new Map();
const roleAliases = {
  'Team Lead': 'Supervisor',
  'Scanner/User': 'User'
};

function canonicalRole(role) {
  return roleAliases[role] || role || 'User';
}

function isEnvUser(user) {
  return user?.source === 'env' || user?.id === 'env_admin';
}

function isConfiguredAdminUsername(username) {
  return Boolean(config.adminUsername) && String(username || '').toLowerCase() === config.adminUsername.toLowerCase();
}

function adminLoginConfigWarning(username) {
  if (!isConfiguredAdminUsername(username)) return '';
  if (!config.adminPasswordHash) return 'ADMIN_PASSWORD_HASH is not configured on the server.';
  if (!/^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(config.adminPasswordHash)) {
    return 'ADMIN_PASSWORD_HASH is not a valid bcrypt hash.';
  }
  return '';
}

export class AuthConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthConfigurationError';
    this.statusCode = 500;
    this.code = adminConfigErrorCode;
    this.safeMessage = 'Admin login is not configured. Set ADMIN_PASSWORD_HASH to a valid bcrypt hash.';
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storedPermissions(user) {
  return String(user.permissions || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function sessionTimeoutMs() {
  return Math.max(5, config.sessionIdleMinutes || 30) * 60 * 1000;
}

async function updateUserSecurity(user, patch) {
  if (isEnvUser(user)) {
    Object.assign(envAdminState, patch);
    return { ...user, ...envAdminState, ...patch };
  }
  return updateRowById(tabs.users, user.id, { ...patch, updatedAt: nowIso() });
}

async function recordFailedLogin(user) {
  const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
  const lockedUntil = failedLoginCount >= maxFailures ? new Date(Date.now() + lockMs).toISOString() : '';
  await updateUserSecurity(user, { failedLoginCount, lockedUntil });
  return { failedLoginCount, lockedUntil };
}

async function resetLoginFailures(user) {
  await updateUserSecurity(user, { failedLoginCount: 0, lockedUntil: '', lastLogin: nowIso() });
}

function userWithEnvSecurity(user) {
  return isEnvUser(user) ? { ...user, ...envAdminState } : user;
}

export function publicUser(user) {
  const role = canonicalRole(user.role);
  const permissions = role === 'Admin'
    ? defaultPermissionsByRole.Admin
    : storedPermissions(user).length
      ? storedPermissions(user)
      : defaultPermissionsByRole[role] || defaultPermissionsByRole.User;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role,
    active: String(user.active).toLowerCase() !== 'false',
    permissions,
    twoFactorEnabled: String(user.twoFactorEnabled || 'false').toLowerCase() === 'true'
  };
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export async function findUser(username) {
  if (isConfiguredAdminUsername(username) && config.adminPasswordHash) {
    return userWithEnvSecurity({
      id: 'env_admin',
      username: config.adminUsername,
      displayName: config.adminUsername,
      passwordHash: config.adminPasswordHash,
      role: 'Admin',
      active: 'true',
      permissions: defaultPermissionsByRole.Admin.join(','),
      source: 'env',
      createdAt: '',
      updatedAt: ''
    });
  }
  let users = [];
  try {
    users = await readRows(tabs.users);
  } catch (error) {
    if (error?.statusCode === 503) return null;
    throw error;
  }
  const user = users.find((row) => String(row.username || '').toLowerCase() === username.toLowerCase());
  return user ? { ...user, role: canonicalRole(user.role) } : null;
}

function twoFactorEnabled(user) {
  return String(user.twoFactorEnabled || 'false').toLowerCase() === 'true';
}

function twoFactorSecret(user) {
  try {
    return decryptSecret(user.twoFactorSecret || '');
  } catch (error) {
    console.error('Unable to decrypt 2FA secret:', error.message);
    return '';
  }
}

async function verifyRecoveryCode(user, recoveryCode) {
  const cleanCode = String(recoveryCode || '').trim().toUpperCase();
  if (!cleanCode) return false;
  const hashes = parseJsonArray(user.backupCodeHashes);
  for (const hash of hashes) {
    if (await bcrypt.compare(cleanCode, hash)) {
      const remaining = hashes.filter((item) => item !== hash);
      await updateUserSecurity(user, { backupCodeHashes: JSON.stringify(remaining) });
      return true;
    }
  }
  return false;
}

async function verifySecondFactor(user, { totpCode, recoveryCode }) {
  if (totpCode && verifyTotp(twoFactorSecret(user), totpCode)) return true;
  if (recoveryCode && await verifyRecoveryCode(user, recoveryCode)) return true;
  return false;
}

export async function authenticate({ username, password, totpCode = '', recoveryCode = '' }) {
  const configWarning = adminLoginConfigWarning(username);
  if (configWarning) {
    console.error(`Admin auth configuration warning: ${configWarning}`);
    throw new AuthConfigurationError(configWarning);
  }
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
    const failed = await recordFailedLogin(user);
    return { ok: false, reason: failed.lockedUntil ? 'locked' : 'invalid', failedLoginCount: failed.failedLoginCount };
  }
  if (twoFactorEnabled(user)) {
    if (!totpCode && !recoveryCode) return { ok: false, reason: '2fa_required' };
    if (!await verifySecondFactor(user, { totpCode, recoveryCode })) {
      const failed = await recordFailedLogin(user);
      return { ok: false, reason: failed.lockedUntil ? 'locked' : 'invalid_2fa', failedLoginCount: failed.failedLoginCount };
    }
  }
  await resetLoginFailures(user);
  return { ok: true, user: publicUser({ ...user, failedLoginCount: 0, lockedUntil: '' }) };
}

export async function createSession(user, { rememberDevice = false, secure = false, ip = '', device = '' } = {}) {
  const canRemember = rememberDevice && config.isProduction && secure;
  const maxAge = canRemember ? 30 * 24 * 60 * 60 : 8 * 60 * 60;
  const createdAt = nowIso();
  const session = {
    id: id('session'),
    userId: user.id,
    username: user.username,
    device: String(device || 'unknown device').slice(0, 240),
    ip,
    createdAt,
    lastSeenAt: createdAt,
    expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(),
    revokedAt: '',
    revokedBy: ''
  };
  if (user.id === 'env_admin') {
    envSessions.set(session.id, session);
  } else {
    await appendRows(tabs.sessions, [session]);
  }
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, sid: session.id },
    config.jwtSecret,
    { expiresIn: canRemember ? '30d' : config.jwtExpiresIn }
  );
  return { token, maxAge, remembered: canRemember, session };
}

export async function validateSession(user, sessionId) {
  if (!sessionId) return null;
  const sessions = await listSessionsForUser(user, true);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || session.revokedAt) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  if (new Date(session.lastSeenAt || session.createdAt).getTime() + sessionTimeoutMs() <= Date.now()) {
    await revokeSession(user, sessionId, 'idle_timeout');
    return null;
  }
  if (Date.now() - new Date(session.lastSeenAt || session.createdAt).getTime() > 5 * 60 * 1000) {
    await touchSession(user, sessionId);
  }
  return session;
}

export async function listSessionsForUser(user, includeRevoked = false) {
  if (isEnvUser(user)) {
    return Array.from(envSessions.values())
      .filter((session) => session.userId === user.id)
      .filter((session) => includeRevoked || !session.revokedAt);
  }
  const rows = await readRows(tabs.sessions);
  return rows
    .filter((session) => session.userId === user.id)
    .filter((session) => includeRevoked || !session.revokedAt);
}

export async function touchSession(user, sessionId) {
  if (isEnvUser(user)) {
    const current = envSessions.get(sessionId);
    if (current) envSessions.set(sessionId, { ...current, lastSeenAt: nowIso() });
    return;
  }
  await updateRowById(tabs.sessions, sessionId, { lastSeenAt: nowIso() });
}

export async function revokeSession(user, sessionId, revokedBy = '') {
  if (isEnvUser(user)) {
    const current = envSessions.get(sessionId);
    if (current) envSessions.set(sessionId, { ...current, revokedAt: nowIso(), revokedBy });
    return true;
  }
  return Boolean(await updateRowById(tabs.sessions, sessionId, { revokedAt: nowIso(), revokedBy }));
}

export async function revokeAllSessions(user, revokedBy = '', exceptSessionId = '') {
  const sessions = await listSessionsForUser(user);
  await Promise.all(sessions
    .filter((session) => session.id !== exceptSessionId)
    .map((session) => revokeSession(user, session.id, revokedBy)));
  return sessions.filter((session) => session.id !== exceptSessionId).length;
}

export async function securityProfile(user) {
  const fullUser = await findUser(user.username);
  const sessions = await listSessionsForUser(fullUser);
  return {
    twoFactorEnabled: twoFactorEnabled(fullUser),
    recoveryCodesRemaining: parseJsonArray(fullUser.backupCodeHashes).length,
    lockedUntil: fullUser.lockedUntil || '',
    failedLoginCount: Number(fullUser.failedLoginCount || 0),
    passwordChangedAt: fullUser.passwordChangedAt || '',
    sessions: sessions.map((session) => ({
      id: session.id,
      device: session.device,
      ip: session.ip,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt
    }))
  };
}

export async function startTwoFactorSetup(user) {
  const fullUser = await findUser(user.username);
  const secret = generateTotpSecret();
  await updateUserSecurity(fullUser, { twoFactorPendingSecret: encryptSecret(secret) });
  return { secret, otpauthUrl: totpUri({ username: fullUser.username, secret }) };
}

export async function enableTwoFactor(user, code) {
  const fullUser = await findUser(user.username);
  const pendingSecret = decryptSecret(fullUser.twoFactorPendingSecret || '');
  if (!pendingSecret || !verifyTotp(pendingSecret, code)) {
    const error = new Error('Invalid authenticator code.');
    error.statusCode = 400;
    throw error;
  }
  const recoveryCodes = generateRecoveryCodes();
  const backupCodeHashes = await Promise.all(recoveryCodes.map((recoveryCode) => bcrypt.hash(recoveryCode, 12)));
  await updateUserSecurity(fullUser, {
    twoFactorEnabled: 'true',
    twoFactorSecret: encryptSecret(pendingSecret),
    twoFactorPendingSecret: '',
    backupCodeHashes: JSON.stringify(backupCodeHashes)
  });
  return { recoveryCodes };
}

export async function disableTwoFactor(user, code) {
  const fullUser = await findUser(user.username);
  if (twoFactorEnabled(fullUser) && !await verifySecondFactor(fullUser, { totpCode: code })) {
    const error = new Error('Invalid authenticator code.');
    error.statusCode = 400;
    throw error;
  }
  await updateUserSecurity(fullUser, {
    twoFactorEnabled: 'false',
    twoFactorSecret: '',
    twoFactorPendingSecret: '',
    backupCodeHashes: ''
  });
}

export async function changePassword(user, { currentPassword, newPassword }) {
  const fullUser = await findUser(user.username);
  const valid = Boolean(fullUser.passwordHash) && await bcrypt.compare(currentPassword, fullUser.passwordHash);
  if (!valid) {
    const error = new Error('Current password is incorrect.');
    error.statusCode = 400;
    throw error;
  }
  if (isEnvUser(fullUser)) {
    const error = new Error('Environment admin password must be rotated by updating ADMIN_PASSWORD_HASH.');
    error.statusCode = 400;
    throw error;
  }
  await updateRowById(tabs.users, fullUser.id, {
    passwordHash: await bcrypt.hash(newPassword, 12),
    passwordChangedAt: nowIso(),
    updatedAt: nowIso()
  });
  await revokeAllSessions(fullUser, 'password_change', user.sessionId);
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
    permissions: role === 'Admin' ? defaultPermissionsByRole.Admin.join(',') : (permissions.length ? permissions : defaultPermissionsByRole[role] || []).join(','),
    failedLoginCount: 0,
    lockedUntil: '',
    lastLogin: '',
    createdAt,
    updatedAt: createdAt,
    twoFactorEnabled: 'false',
    twoFactorSecret: '',
    twoFactorPendingSecret: '',
    backupCodeHashes: '',
    passwordChangedAt: createdAt
  };
  await appendRows(tabs.users, [record]);
  return publicUser(record);
}

export async function updateUser(userId, patch) {
  const users = await readRows(tabs.users);
  const current = users.find((user) => user.id === userId);
  if (!current) return null;
  const role = canonicalRole(patch.role ?? current.role);
  const next = {
    username: patch.username ?? current.username,
    displayName: patch.displayName ?? current.displayName,
    role,
    active: typeof patch.active === 'boolean' ? String(patch.active) : String(current.active || 'true'),
    permissions: Array.isArray(patch.permissions) ? (role === 'Admin' ? defaultPermissionsByRole.Admin : patch.permissions).join(',') : current.permissions,
    updatedAt: nowIso()
  };
  if (patch.password) {
    next.passwordHash = await bcrypt.hash(patch.password, 12);
    next.passwordChangedAt = nowIso();
  }
  const updated = await updateRowById(tabs.users, userId, next);
  return publicUser(updated);
}

export async function listUsers() {
  const users = await readRows(tabs.users);
  return users.map((user) => ({
    ...publicUser(user),
    failedLoginCount: Number(user.failedLoginCount || 0),
    lockedUntil: user.lockedUntil || '',
    lastLogin: user.lastLogin || '',
    passwordChangedAt: user.passwordChangedAt || '',
    recoveryCodesRemaining: parseJsonArray(user.backupCodeHashes).length
  }));
}

export async function unlockUser(userId) {
  const updated = await updateRowById(tabs.users, userId, { failedLoginCount: 0, lockedUntil: '', updatedAt: nowIso() });
  return updated ? publicUser(updated) : null;
}

export async function resetUserTwoFactor(userId) {
  const updated = await updateRowById(tabs.users, userId, {
    twoFactorEnabled: 'false',
    twoFactorSecret: '',
    twoFactorPendingSecret: '',
    backupCodeHashes: '',
    updatedAt: nowIso()
  });
  return updated ? publicUser(updated) : null;
}

export async function revokeUserSessions(userId, revokedBy = '') {
  const users = await readRows(tabs.users);
  const user = users.find((row) => row.id === userId);
  if (!user) return 0;
  return revokeAllSessions(user, revokedBy);
}
