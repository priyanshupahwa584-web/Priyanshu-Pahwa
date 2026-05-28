import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { buildFacilityAnalytics } from '../services/facilityAnalyticsService.js';

export const facilityIntelligenceRouter = express.Router();

facilityIntelligenceRouter.get('/', authRequired, requireAccess('dashboard'), async (req, res, next) => {
  try {
    const duration = String(req.query.duration || '30D');
    const aggregation = String(req.query.aggregation || 'Daily');
    const facilities = String(req.query.facilities || '');
    const analytics = await buildFacilityAnalytics({ duration, aggregation, facilities });
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});
