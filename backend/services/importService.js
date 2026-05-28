import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { dataRowSchema } from '../utils/validation.js';

function parseCsv(text) {
  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function normalizeKeys(row) {
  const map = {};
  Object.entries(row).forEach(([key, value]) => {
    map[key.toLowerCase().replace(/[^a-z0-9]/g, '')] = value;
  });
  return {
    date: dateValue(map.date || map.day || map.createddate),
    facility: map.facility || map.site || map.location,
    pieces: map.pieces || map.totalpieces || map.output || map.volume,
    throughput: map.throughput || 0,
    productivity: map.productivity || 0,
    cycleTime: map.cycletime || map.cycle || 0,
    status: map.status || 'Active',
    notes: map.notes || ''
  };
}

function dateValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function cellValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object') {
    if ('text' in value) return value.text;
    if ('result' in value) return value.result;
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
  }
  return value ?? '';
}

async function parseXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = String(cellValue(cell.value) || '').trim();
  });
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cellValue(row.getCell(index + 1).value);
    });
    if (Object.values(record).some((value) => value !== '')) rows.push(record);
  });
  return rows;
}

export async function parseImportFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.csv') {
    return rowsToObjects(parseCsv(fs.readFileSync(filePath, 'utf8')));
  }
  if (ext === '.json') {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : parsed.rows || parsed.data || [];
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    return parseXlsx(filePath);
  }
  const error = new Error('Only CSV, XLSX, XLSM, and JSON imports are supported.');
  error.statusCode = 400;
  throw error;
}

export function validateImportRows(rows) {
  const cleanRows = [];
  const errors = [];
  rows.forEach((row, index) => {
    try {
      cleanRows.push(dataRowSchema.parse(normalizeKeys(row)));
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push({ row: index + 2, message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
      } else {
        errors.push({ row: index + 2, message: error.message });
      }
    }
  });
  return { rows: cleanRows, errors };
}
