import rateLimit from 'express-rate-limit';
import { config, isAllowedOrigin } from '../config.js';

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false
});

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many failed sign-in attempts. Wait a few minutes and try again.' }
});

export function sameOriginProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const referer = req.get('referer');
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  let source = origin || '';
  if (!source && referer) {
    try {
      source = new URL(referer).origin;
    } catch {
      source = 'invalid';
    }
  }
  if (!source || source === expectedOrigin || isAllowedOrigin(source)) return next();
  return res.status(403).json({ message: 'Security check failed. Refresh the app and try again.' });
}

export function enforceHttpsInProduction(req, res, next) {
  if (!config.isProduction) return next();
  if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
  if (req.method === 'GET') return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  return res.status(403).json({ message: 'HTTPS is required in production.' });
}

export function errorHandler(error, _req, res, _next) {
  if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message });
  if (error?.name === 'ZodError') return res.status(400).json({ message: 'Please check the form fields.', details: error.issues });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Request body was not valid JSON.' });
  if (String(error.message || '').includes('CORS')) return res.status(403).json({ message: 'Request origin is not allowed.' });
  console.error(error);
  return res.status(500).json({ message: 'Server unavailable, please try again later.' });
}
