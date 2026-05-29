import { parseImportFile } from './importService.js';
import { id, nowIso } from '../utils/ids.js';

function keyMap(row) {
  const map = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    map[String(key).toLowerCase().replace(/[^a-z0-9]/g, '')] = value;
  });
  return map;
}

function value(map, keys, fallback = '') {
  for (const key of keys) {
    const current = map[key];
    if (current !== null && typeof current !== 'undefined' && String(current).trim() !== '') return String(current).trim();
  }
  return fallback;
}

function isEmptyRow(row) {
  return !Object.values(row || {}).some((current) => String(current ?? '').trim() !== '');
}

function titleCaseCity(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function normalizeMetroRow(row, uploadedFileId, timestamp, uploadedBy = '') {
  const map = keyMap(row);
  const trackingNumber = value(map, [
    'trackingnumber',
    'trackingno',
    'tracking',
    'barcode',
    'barcodevalue',
    'packagetrackingnumber'
  ]);
  const routingSequence = value(map, ['routingsequence', 'routingseq', 'sequence', 'route', 'stop', 'stopnumber']);
  const route = routingSequence;
  const driver = value(map, ['driver', 'drivername']);
  const deliveryAddress = value(map, ['deliveryaddress', 'address', 'customeraddress']);
  const address = deliveryAddress;
  const city = titleCaseCity(value(map, ['city']));
  const postal = value(map, ['postalcode', 'postcode', 'zip']);
  const fullAddress = [deliveryAddress, city, postal].filter(Boolean).join(', ');
  const customerName = value(map, ['customername', 'customer', 'name', 'recipient', 'consignee'], driver);
  const service = value(map, ['service', 'servicetype', 'carrier'], '');
  return {
    id: id('metro'),
    trackingNumber,
    barcodeValue: value(map, ['barcodevalue', 'barcode'], trackingNumber),
    customerName,
    service,
    route,
    address,
    city,
    postalCode: postal,
    status: 'Uploaded',
    uploadedFileId,
    uploadedBy,
    printedAt: '',
    printedBy: '',
    reprintCount: 0,
    errorMessage: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    driver,
    routingSequence,
    deliveryAddress,
    fullAddress,
    originalRow: JSON.stringify(row || {}),
    printerName: ''
  };
}

export async function parseMetroLabelFile(filePath, originalName, uploadedFileId = '', uploadedBy = '') {
  const rawRows = await parseImportFile(filePath, originalName);
  const timestamp = nowIso();
  const rows = [];
  const errors = [];
  rawRows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const record = normalizeMetroRow(row, uploadedFileId, timestamp, uploadedBy);
    const required = [
      ['trackingNumber', 'Tracking Number'],
      ['deliveryAddress', 'Delivery Address']
    ];
    const missing = required.filter(([key]) => !record[key]).map(([, label]) => label);
    if (missing.length) {
      errors.push({ row: index + 2, message: `${missing.join(', ')} required.` });
      return;
    }
    rows.push(record);
  });
  return {
    rows,
    errors,
    importedCount: rows.length,
    skippedCount: rawRows.length - rows.length - errors.length,
    rejectedCount: errors.length
  };
}
