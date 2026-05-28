import express from 'express';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/security.js';
import { audit } from '../services/auditService.js';
import { authenticate, signUser } from '../services/authService.js';
import { appendRows } from '../services/googleSheets.js';
import { tabs } from '../services/sheetSchema.js';
import { id, nowIso } from '../utils/ids.js';
import { loginSchema } from '../utils/validation.js';

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
      await audit({ actor: body.username, action: result.reason === 'locked' ? 'login_locked' : 'login_failed', entity: 'auth', ip: req.ip, device: device(req), metadata: { reason: result.reason } });
      return res.status(result.reason === 'locked' ? 423 : 401).json({
        message: result.reason === 'locked' ? 'Account locked due to too many failed attempts.' : 'Invalid username or password.'
      });
    }
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    const session = signUser(result.user, body.rememberDevice, secure);
    setSessionCookie(res, session.token, session.maxAge);
    await audit({ actor: result.user.username, action: 'login_success', entity: 'auth', entityId: result.user.id, ip: req.ip, device: device(req), metadata: { rememberDevice: session.remembered } });
    res.json({ user: result.user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', authRequired, async (req, res) => {
  const sameSite = config.isProduction ? 'None' : 'Lax';
  const secure = config.isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${config.cookieName}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure}`);
  await audit({ actor: req.user.username, action: 'logout', entity: 'auth', entityId: req.user.id, ip: req.ip, device: device(req) });
  res.json({ ok: true });
});

authRouter.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
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
