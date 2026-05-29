import express from 'express';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/security.js';
import { audit } from '../services/auditService.js';
import {
  authenticate,
  changePassword,
  createSession,
  disableTwoFactor,
  enableTwoFactor,
  listSessionsForUser,
  revokeAllSessions,
  revokeSession,
  securityProfile,
  startTwoFactorSetup
} from '../services/authService.js';
import { appendRows } from '../services/googleSheets.js';
import { tabs } from '../services/sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';
import { changePasswordSchema, loginSchema, twoFactorCodeSchema } from '../utils/validation.js';

export const authRouter = express.Router();

function device(req) {
  return (req.get('user-agent') || 'unknown device').slice(0, 240);
}

function setSessionCookie(res, token, maxAge) {
  const sameSite = config.isProduction ? 'None' : 'Lax';
  const secure = config.isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${config.cookieName}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${secure}`);
}

authRouter.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authenticate(body);
    if (!result.ok) {
      if (result.reason === '2fa_required') {
        await audit({ actor: body.username, action: 'login_2fa_required', entity: 'auth', ip: req.ip, device: device(req) });
        return res.status(202).json({ requiresTwoFactor: true, message: 'Enter your authenticator code or a recovery code.' });
      }
      await audit({ actor: body.username, action: result.reason === 'locked' ? 'login_locked' : 'login_failed', entity: 'auth', ip: req.ip, device: device(req), metadata: { reason: result.reason } });
      return res.status(result.reason === 'locked' ? 423 : 401).json({
        message: result.reason === 'locked' ? 'Account locked due to too many failed attempts.' : 'Invalid username or password.'
      });
    }
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    const session = await createSession(result.user, { rememberDevice: body.rememberDevice, secure, ip: req.ip, device: device(req) });
    setSessionCookie(res, session.token, session.maxAge);
    await audit({ actor: result.user.username, action: 'login_success', entity: 'auth', entityId: result.user.id, ip: req.ip, device: device(req), metadata: { rememberDevice: session.remembered } });
    res.json({ user: result.user });
  } catch (error) {
    if (error?.name === 'ZodError') return next(error);
    console.error('Login route failed:', error);
    return res.status(500).json({ message: 'Login service error.' });
  }
});

authRouter.post('/logout', authRequired, async (req, res) => {
  const sameSite = config.isProduction ? 'None' : 'Lax';
  const secure = config.isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${config.cookieName}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure}`);
  await revokeSession(req.user, req.sessionId, req.user.username);
  await audit({ actor: req.user.username, action: 'logout', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req) });
  res.json({ ok: true });
});

authRouter.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

authRouter.get('/security', authRequired, async (req, res, next) => {
  try {
    res.json({ ...await securityProfile(req.user), currentSessionId: req.sessionId });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/change-password', authRequired, async (req, res, next) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    await changePassword(req.user, body);
    await audit({ actor: req.user.username, action: 'password_changed', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req) });
    res.json({ ok: true, message: 'Password changed. Other sessions were signed out.' });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/setup', authRequired, async (req, res, next) => {
  try {
    const setup = await startTwoFactorSetup(req.user);
    await audit({ actor: req.user.username, action: '2fa_setup_started', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req) });
    res.json(setup);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/enable', authRequired, async (req, res, next) => {
  try {
    const body = twoFactorCodeSchema.parse(req.body);
    const result = await enableTwoFactor(req.user, body.code);
    await audit({ actor: req.user.username, action: '2fa_enabled', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req) });
    res.json({ message: 'Two-factor authentication enabled.', recoveryCodes: result.recoveryCodes });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/disable', authRequired, async (req, res, next) => {
  try {
    const body = twoFactorCodeSchema.parse(req.body);
    await disableTwoFactor(req.user, body.code);
    await audit({ actor: req.user.username, action: '2fa_disabled', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req) });
    res.json({ message: 'Two-factor authentication disabled.' });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/sessions', authRequired, async (req, res, next) => {
  try {
    const rows = await listSessionsForUser(req.user);
    res.json({ sessions: rows.map((session) => ({ ...session, current: session.id === req.sessionId })) });
  } catch (error) {
    next(error);
  }
});

authRouter.delete('/sessions/:id', authRequired, async (req, res, next) => {
  try {
    await revokeSession(req.user, req.params.id, req.user.username);
    await audit({ actor: req.user.username, action: 'session_revoked', entity: 'auth', entityId: req.params.id, ip: req.ip, device: device(req) });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout-all', authRequired, async (req, res, next) => {
  try {
    const revoked = await revokeAllSessions(req.user, req.user.username, req.sessionId);
    await audit({ actor: req.user.username, action: 'logout_all_devices', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req), metadata: { revoked } });
    res.json({ ok: true, revoked });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ message: 'Enter your username first.' });
    const record = {
      id: id('reset'),
      actor: username,
      action: 'password_reset_requested',
      entity: 'auth',
      entityId: '',
      ip: req.ip,
      device: device(req),
      metadata: JSON.stringify({ username, flow: 'admin_review' }),
      createdAt: nowIso()
    };
    await appendRows(tabs.audit, [record]);
    res.json({ message: 'Password reset request submitted. Contact admin to verify your identity and reset access.' });
  } catch (error) {
    next(error);
  }
});
