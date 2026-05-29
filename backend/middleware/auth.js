import { config } from '../config.js';
import { findUser, publicUser, validateSession, verifyToken } from '../services/authService.js';

export function cookieValue(req, name) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }).filter(([key]) => key));
  return cookies[name] || '';
}

export function authRequired(req, res, next) {
  Promise.resolve()
    .then(async () => {
      const auth = req.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : cookieValue(req, config.cookieName);
      if (!token) return res.status(401).json({ message: 'Login required.' });
      const payload = verifyToken(token);
      const user = await findUser(payload.username);
      if (!user || String(user.active).toLowerCase() === 'false') {
        return res.status(401).json({ message: 'Session expired. Please sign in again.' });
      }
      const session = await validateSession(user, payload.sid);
      if (!session) return res.status(401).json({ message: 'Session expired. Please sign in again.' });
      req.user = publicUser(user);
      req.user.sessionId = payload.sid;
      req.sessionId = payload.sid;
      req.session = session;
      return next();
    })
    .catch(() => res.status(401).json({ message: 'Session expired. Please sign in again.' }));
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
