import { z } from 'zod';
import { roles, sections } from '../services/sheetSchema.js';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
  rememberDevice: z.boolean().optional().default(false),
  totpCode: z.string().trim().max(12).optional().default(''),
  recoveryCode: z.string().trim().max(32).optional().default('')
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200)
});

export const twoFactorCodeSchema = z.object({
  code: z.string().trim().min(6).max(12)
});

export const dataRowSchema = z.object({
  date: z.string().trim().min(1).max(40),
  facility: z.string().trim().min(1).max(160),
  pieces: z.coerce.number().min(0).max(100000000),
  throughput: z.coerce.number().min(0).max(100000000).optional().default(0),
  productivity: z.coerce.number().min(0).max(100000000).optional().default(0),
  cycleTime: z.coerce.number().min(0).max(100000000).optional().default(0),
  status: z.string().trim().max(80).optional().default('Active'),
  notes: z.string().trim().max(2000).optional().default('')
});

export const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(80),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(4).max(200),
  role: z.enum(roles),
  active: z.boolean().default(true),
  permissions: z.array(z.enum(sections)).default([])
});

export const userUpdateSchema = userCreateSchema.extend({
  password: z.string().min(4).max(200).optional().or(z.literal(''))
});

export const exportSchema = z.object({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  filters: z.object({
    dateFrom: z.string().optional().default(''),
    dateTo: z.string().optional().default(''),
    facility: z.string().optional().default(''),
    status: z.string().optional().default('')
  }).optional().default({})
});

export const importTypeSchema = z.enum(['csv', 'xlsx', 'json']);

export const labelPrintSchema = z.object({
  id: z.string().trim().optional().default(''),
  trackingNumber: z.string().trim().optional().default(''),
  printerName: z.string().trim().max(180).optional().default(''),
  type: z.enum(['zpl', 'pdf']).optional().default('zpl'),
  action: z.enum(['print', 'reprint', 'test']).optional().default('print'),
  prepareOnly: z.boolean().optional().default(false),
  errorMessage: z.string().trim().max(1000).optional().default('')
});

export const fulfilmentReportSchema = z.object({
  reportDate: z.string().trim().max(40).optional().default(''),
  client: z.string().trim().max(120).optional().default('Metro'),
  service: z.string().trim().max(120).optional().default(''),
  route: z.string().trim().max(120).optional().default('')
});
