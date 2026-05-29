import { config } from '../config.js';
import { findUser, publicUser, validateSession, verifyToken } from '../services/authService.js';

export function cookieValue(req, name) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }).filter(([key]) => key));
  return cookies[name] || '';
}

export async function resolveAuthContext(req) {
  const auth = req.get('authorization') || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const cookieToken = cookieValue(req, config.cookieName);
  const token = bearerToken || cookieToken;
  const tokenPresent = Boolean(token);
  if (!token) return { ok: false, authenticated: false, tokenPresent, sessionPresent: false, reason: 'missing' };

  const payload = verifyToken(token);
  const user = await findUser(payload.username);
  if (!user || String(user.active).toLowerCase() === 'false') {
    return { ok: false, authenticated: false, tokenPresent, sessionPresent: false, reason: 'user' };
  }

  const session = await validateSession(user, payload.sid);
  if (!session) return { ok: false, authenticated: false, tokenPresent, sessionPresent: false, reason: 'session', user };

  return {
    ok: true,
    authenticated: true,
    tokenPresent,
    sessionPresent: true,
    tokenSource: bearerToken ? 'authorization' : 'cookie',
    user,
    publicUser: publicUser(user),
    sessionId: payload.sid,
    session
  };
}

export function authRequired(req, res, next) {
  Promise.resolve()
    .then(async () => {
      const context = await resolveAuthContext(req);
      if (!context.ok) {
        const message = context.reason === 'missing' ? 'Login required.' : 'Session expired. Please sign in again.';
        return res.status(401).json({
          message,
          authenticated: false,
          sessionPresent: context.sessionPresent,
          tokenPresent: context.tokenPresent
        });
      }
      req.user = context.publicUser;
      req.user.sessionId = context.sessionId;
      req.sessionId = context.sessionId;
      req.session = context.session;
      return next();
    })
    .catch(() => res.status(401).json({
      message: 'Session expired. Please sign in again.',
      authenticated: false,
      sessionPresent: false,
      tokenPresent: false
    }));
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'Admin') return next();
  return res.status(403).json({ message: 'Admin access required.' });
}

export function requireAccess(section) {
  return (req, res, next) => {
    if (req.user?.role === 'Admin' || req.user?.permissions?.includes(section)) return next();
    return res.status(403).json({ message: 'You do not have access to that section.' });
  };
}
