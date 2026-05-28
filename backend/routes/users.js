import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { createUser, listUsers, updateUser } from '../services/authService.js';
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

usersRouter.post('/', authRequired, requireAccess('users'), async (req, res, next) => {
  try {
    const body = userCreateSchema.parse(req.body);
    const user = await createUser(body);
    await audit({ actor: req.user.username, action: 'user_created', entity: 'Users', entityId: user.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.put('/:id', authRequired, requireAccess('users'), async (req, res, next) => {
  try {
    const body = userUpdateSchema.parse(req.body);
    const user = await updateUser(req.params.id, body);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    await audit({ actor: req.user.username, action: 'user_updated', entity: 'Users', entityId: req.params.id, ip: req.ip, device: req.get('user-agent') || '' });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
