import express from 'express';
import { authRequired, requireAccess, requireAdmin } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { createUser, getUserSessions, listUsers, resetUserTwoFactor, revokeUserSessions, unlockUser, updateUser } from '../services/authService.js';
import { roles, sections } from '../services/sheetSchema.js';
import { userCreateSchema, userUpdateSchema } from '../utils/validation.js';

export const usersRouter = express.Router();

usersRouter.get('/', authRequired, requireAccess('users'), async (_req, res, next) => {
  try {
    res.json({ users: await listUsers(), roles, sections });
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/', authRequired, requireAdmin, async (req, res, next) => {
  try {
    const body = userCreateSchema.parse(req.body);
    const user = await createUser(body);
    await audit({ actor: req.user.username, action: 'user_created', entity: 'Users', entityId: user.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.put('/:id', authRequired, requireAdmin, async (req, res, next) => {
  try {
    const body = userUpdateSchema.parse(req.body);
    const user = await updateUser(req.params.id, body);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    await audit({ actor: req.user.username, action: 'user_updated', entity: 'Users', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    if (body.password) {
      await audit({ actor: req.user.username, action: 'password_reset', entity: 'Users', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.get('/:id/sessions', authRequired, requireAdmin, async (req, res, next) => {
  try {
    const sessions = await getUserSessions(req.params.id);
    if (!sessions) return res.status(404).json({ message: 'User not found.' });
    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/:id/unlock', authRequired, requireAdmin, async (req, res, next) => {
  try {
    const user = await unlockUser(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    await audit({ actor: req.user.username, action: 'user_unlocked', entity: 'Users', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/:id/reset-2fa', authRequired, requireAdmin, async (req, res, next) => {
  try {
    const user = await resetUserTwoFactor(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    await audit({ actor: req.user.username, action: 'user_2fa_reset', entity: 'Users', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/:id/revoke-sessions', authRequired, requireAdmin, async (req, res, next) => {
  try {
    const revoked = await revokeUserSessions(req.params.id, req.user.username);
    await audit({ actor: req.user.username, action: 'user_sessions_revoked', entity: 'Users', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '', metadata: { revoked } });
    res.json({ ok: true, revoked });
  } catch (error) {
    next(error);
  }
});
