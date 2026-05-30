import { config, facilitySourceConfigError, facilitySourceConfigured } from '../config.js';
import { getSheetsClient } from './googleClient.js';

export const masterOperationsSheet = 'Sort 2026- Jan 01- Dec 31st';

const sourceStartRow = 4;
const dataStartRow = 5;
const facilityStartIndex = 18; // Column S
const facilityEndIndex = 33; // Column AH
const facilityColumnLetters = [
  'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH'
];

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function parseCount(value) {
  if (value === null || typeof value === 'undefined' || value === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function excelDateToIso(serial) {
  const days = Number(serial);
  if (!Number.isFinite(days)) return '';
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return excelDateToIso(value);
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return '';
  const [, first, second, yearRaw] = match;
  const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
  const month = Number(first) > 12 ? Number(second) : Number(first);
  const day = Number(first) > 12 ? Number(first) : Number(second);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function addDays(isoDate, offset) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function startOfMonth(isoDate) {
  return `${isoDate.slice(0, 7)}-01`;
}

function startOfQuarter(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1)).toISOString().slice(0, 10);
}

function durationStart(duration, latestDate) {
  if (!latestDate) return '';
  switch (duration) {
    case 'Today':
      return latestDate;
    case '7D':
      return addDays(latestDate, -6);
    case '30D':
      return addDays(latestDate, -29);
    case 'Month':
      return startOfMonth(latestDate);
    case 'Quarter':
      return startOfQuarter(latestDate);
    case 'Year':
      return `${latestDate.slice(0, 4)}-01-01`;
    case 'All':
    default:
      return '';
  }
}

function movingAverage(points, key = 'total', windowSize = 7) {
  return points.map((point, index) => {
    const sample = points.slice(Math.max(0, index - windowSize + 1), index + 1);
    const total = sample.reduce((sum, item) => sum + Number(item[key] || 0), 0);
    return Math.round(total / sample.length);
  });
}

function weekKey(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - firstDay.getTime()) / 86400000) + firstDay.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()} W${String(week).padStart(2, '0')}`;
}

function periodKey(isoDate, aggregation) {
  if (aggregation === 'Weekly') return weekKey(isoDate);
  if (aggregation === 'Monthly') return isoDate.slice(0, 7);
  return isoDate;
}

function topByValue(entries, limit) {
  return entries.sort((a, b) => b.total - a.total).slice(0, limit);
}

export async function readMasterFacilityRows() {
  const sheets = getSheetsClient();
  const range = `${quoteSheetName(masterOperationsSheet)}!A${sourceStartRow}:AH`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  const rows = response.data.values || [];
  const headerRow = rows[0] || [];
  const facilityHeaders = facilityColumnLetters.map((letter, index) => {
    const header = String(headerRow[facilityStartIndex + index] || '').trim();
    return header || `Facility ${letter}`;
  });
  const records = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const date = parseDate(row[0]);
    if (!date) return;
    facilityHeaders.forEach((facility, index) => {
      const count = parseCount(row[facilityStartIndex + index]);
      if (!count) return;
      records.push({
        id: `${date}-${facilityColumnLetters[index]}-${rowIndex + dataStartRow}`,
        date,
        facility,
        count,
        sourceRow: rowIndex + dataStartRow,
        column: facilityColumnLetters[index]
      });
    });
  });
  return { records, facilities: facilityHeaders.filter(Boolean), sourceSheet: masterOperationsSheet };
}

export async function checkFacilitySourceReadable() {
  const result = {
    facilitySourceConfigured: facilitySourceConfigured(),
    facilitySourceReadable: false,
    facilitySourceSheet: masterOperationsSheet,
    facilitySourceError: ''
  };
  if (!result.facilitySourceConfigured) {
    result.facilitySourceError = facilitySourceConfigError();
    return result;
  }
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: `${quoteSheetName(masterOperationsSheet)}!A${sourceStartRow}:AH${sourceStartRow}`,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    result.facilitySourceReadable = true;
    return result;
  } catch (error) {
    const status = Number(error?.code || error?.response?.status || 0);
    result.facilitySourceError = status === 401 || status === 403 || status === 404
      ? 'Facility Sort sheet is not accessible. Share the Google Sheet with the service account as a viewer.'
      : (error.message || 'Facility Sort sheet read check failed.');
    return result;
  }
}

export async function buildFacilityAnalytics(options = {}) {
  const duration = options.duration || '30D';
  const aggregation = options.aggregation || 'Daily';
  const selectedFacilities = String(options.facilities || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const { records, facilities, sourceSheet } = await readMasterFacilityRows();
  const dates = Array.from(new Set(records.map((row) => row.date))).sort();
  const latestDate = dates.at(-1) || '';
  const startDate = durationStart(duration, latestDate);
  const facilitySet = new Set(selectedFacilities);
  const filteredRecords = records.filter((row) => {
    if (startDate && row.date < startDate) return false;
    if (duration === 'Today' && row.date !== latestDate) return false;
    if (facilitySet.size && !facilitySet.has(row.facility)) return false;
    return true;
  });

  const dailyTotals = new Map();
  const facilityTotals = new Map();
  const dateFacilityTotals = new Map();
  filteredRecords.forEach((row) => {
    dailyTotals.set(row.date, (dailyTotals.get(row.date) || 0) + row.count);
    facilityTotals.set(row.facility, (facilityTotals.get(row.facility) || 0) + row.count);
    const dateMap = dateFacilityTotals.get(row.date) || new Map();
    dateMap.set(row.facility, (dateMap.get(row.facility) || 0) + row.count);
    dateFacilityTotals.set(row.date, dateMap);
  });

  const lineSeries = Array.from(dailyTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => {
      const dateMap = dateFacilityTotals.get(date) || new Map();
      return {
        date,
        total,
        ...Object.fromEntries(facilities.map((facility) => [facility, dateMap.get(facility) || 0]))
      };
    });
  const averages = movingAverage(lineSeries);
  lineSeries.forEach((point, index) => {
    point.rollingAverage = averages[index] || 0;
  });

  const facilityTotalsList = Array.from(facilityTotals.entries())
    .map(([facility, total]) => ({ facility, total }))
    .sort((a, b) => b.total - a.total);

  const groupedForBar = new Map();
  filteredRecords.forEach((row) => {
    const key = `${periodKey(row.date, aggregation)}|${row.facility}`;
    const current = groupedForBar.get(key) || { period: periodKey(row.date, aggregation), facility: row.facility, total: 0 };
    current.total += row.count;
    groupedForBar.set(key, current);
  });
  const barSeries = topByValue(Array.from(groupedForBar.values()), 14);

  const totalPackages = filteredRecords.reduce((sum, row) => sum + row.count, 0);
  const pieTop = facilityTotalsList.slice(0, 8);
  const pieOtherTotal = facilityTotalsList.slice(8).reduce((sum, row) => sum + row.total, 0);
  const pieSeries = [
    ...pieTop,
    ...(pieOtherTotal ? [{ facility: 'Other', total: pieOtherTotal }] : [])
  ].map((row) => ({
    ...row,
    percent: totalPackages ? Math.round((row.total / totalPackages) * 1000) / 10 : 0
  }));

  const peakDays = topByValue(Array.from(dailyTotals.entries()).map(([date, total]) => ({ date, total })), 5);
  const heatmapFacilities = facilityTotalsList.slice(0, 8).map((row) => row.facility);
  const heatmapDates = dates.filter((date) => !startDate || date >= startDate).slice(-14);
  const heatmap = heatmapDates.map((date) => {
    const dateMap = dateFacilityTotals.get(date) || new Map();
    return {
      date,
      values: heatmapFacilities.map((facility) => ({ facility, count: dateMap.get(facility) || 0 }))
    };
  });

  const bestFacility = facilityTotalsList[0] || null;
  const worstFacility = facilityTotalsList.filter((row) => row.total > 0).at(-1) || null;
  const previousTotal = lineSeries.length > 1 ? lineSeries.at(-2).total : 0;
  const currentTotal = lineSeries.at(-1)?.total || 0;
  const delta = currentTotal - previousTotal;

  return {
    module: 'Facility Operations Intelligence',
    source: { sheetName: sourceSheet, readOnly: true, range: 'A, S:AH', latestDate },
    filters: { duration, aggregation, selectedFacilities },
    facilities,
    kpis: {
      totalPackages,
      currentTotal,
      previousTotal,
      delta,
      activeFacilities: facilityTotalsList.length,
      bestFacility,
      worstFacility,
      peakDay: peakDays[0] || null,
      rollingAverage: lineSeries.at(-1)?.rollingAverage || 0
    },
    dailyTotals: Array.from(dailyTotals.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total })),
    facilityTotals: facilityTotalsList,
    lineSeries,
    barSeries,
    pieSeries,
    heatmap,
    peakDays,
    summary: [
      bestFacility ? `${bestFacility.facility} leads the selected period with ${bestFacility.total.toLocaleString()} packages.` : 'No facility volume is available for the selected period.',
      peakDays[0] ? `${peakDays[0].date} is the peak day at ${peakDays[0].total.toLocaleString()} packages.` : 'No peak day is available yet.',
      delta ? `Latest daily movement is ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toLocaleString()} packages versus the previous day.` : 'Latest daily output is steady against the previous day.'
    ],
    recordCount: filteredRecords.length,
    generatedAt: new Date().toISOString()
  };
}
