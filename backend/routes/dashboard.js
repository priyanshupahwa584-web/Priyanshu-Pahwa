import express from 'express';
import { authRequired, requireAccess } from '../middleware/auth.js';
import { readRows } from '../services/googleSheets.js';
import { tabs } from '../services/sheetSchema.js';
import { filterOperations } from './data.js';

export const dashboardRouter = express.Router();

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function average(rows, key) {
  return rows.length ? sum(rows, key) / rows.length : 0;
}

function trend(rows) {
  const grouped = new Map();
  rows.forEach((row) => grouped.set(row.date, (grouped.get(row.date) || 0) + Number(row.pieces || 0)));
  return Array.from(grouped.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .slice(-14)
    .map(([date, pieces]) => ({ date, pieces }));
}

function newest(rows) {
  return rows.slice(-1)[0] || null;
}

function labelSummary(rows) {
  const printed = rows.filter((row) => ['printed', 'reprinted'].includes(String(row.status || '').toLowerCase())).length;
  const pending = rows.filter((row) => String(row.status || '').toLowerCase() === 'pending').length;
  const errors = rows.filter((row) => String(row.status || '').toLowerCase() === 'error').length;
  return {
    uploaded: rows.length,
    printed,
    pending,
    errors,
    fulfilmentCompletion: rows.length ? `${Math.round((printed / rows.length) * 100)}%` : 'No labels'
  };
}

dashboardRouter.get('/', authRequired, requireAccess('dashboard'), async (req, res, next) => {
  try {
    const rows = filterOperations(await readRows(tabs.operations), req.query);
    const uploads = (await readRows(tabs.uploads)).slice(-5).reverse();
    const exportsLog = (await readRows(tabs.exports)).slice(-5).reverse();
    const activity = (await readRows(tabs.audit)).slice(-8).reverse();
    const labels = await readRows(tabs.metroLabeling);
    const fulfilmentReports = await readRows(tabs.fulfilmentReports);
    const printLogs = await readRows(tabs.printLogs);
    const missingCoreFields = rows.filter((row) => !row.date || !row.facility || row.pieces === '').length;
    res.json({
      kpis: {
        totalPieces: sum(rows, 'pieces'),
        throughput: Math.round(average(rows, 'throughput') * 100) / 100,
        productivity: Math.round(average(rows, 'productivity') * 100) / 100,
        cycleTime: Math.round(average(rows, 'cycleTime') * 100) / 100,
        dataHealth: rows.length ? `${Math.round(((rows.length - missingCoreFields) / rows.length) * 100)}%` : 'No data',
        ...labelSummary(labels)
      },
      trend: trend(rows),
      recentUploads: uploads,
      recentExports: exportsLog,
      recentActivity: activity,
      recentLabelActivity: {
        lastUploadedLabelFile: uploads.find((row) => String(row.message || '').toLowerCase().includes('metro label')) || null,
        lastPrintedLabel: newest(printLogs),
        lastFulfilmentReport: newest(fulfilmentReports)
      },
      rowCount: rows.length
    });
  } catch (error) {
    next(error);
  }
});
