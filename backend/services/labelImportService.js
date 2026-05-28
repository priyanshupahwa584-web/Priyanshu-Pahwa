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

function normalizeMetroRow(row, uploadedFileId, timestamp) {
  const map = keyMap(row);
  const trackingNumber = value(map, [
    'trackingnumber',
    'trackingno',
    'tracking',
    'barcode',
    'barcodevalue',
    'packagetrackingnumber'
  ]);
  const route = value(map, ['route', 'routingsequence', 'routingseq', 'stop', 'stopnumber', 'sequence']);
  const driver = value(map, ['driver', 'drivername']);
  const address = value(map, ['deliveryaddress', 'address', 'customeraddress']);
  const city = value(map, ['city']);
  const postal = value(map, ['postalcode', 'postcode', 'zip']);
  const customerName = value(map, ['customername', 'customer', 'name', 'recipient', 'consignee'], address || driver);
  const service = value(map, ['service', 'servicetype', 'carrier'], [city, postal].filter(Boolean).join(' '));
  return {
    id: id('metro'),
    trackingNumber,
    barcodeValue: value(map, ['barcodevalue', 'barcode'], trackingNumber),
    customerName,
    service,
    route,
    status: 'Pending',
    uploadedFileId,
    printedAt: '',
    printedBy: '',
    reprintCount: 0,
    errorMessage: '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export async function parseMetroLabelFile(filePath, originalName, uploadedFileId = '') {
  const rawRows = await parseImportFile(filePath, originalName);
  const timestamp = nowIso();
  const rows = [];
  const errors = [];
  rawRows.forEach((row, index) => {
    const record = normalizeMetroRow(row, uploadedFileId, timestamp);
    if (!record.trackingNumber) {
      errors.push({ row: index + 2, message: 'Tracking Number is required.' });
      return;
    }
    rows.push(record);
  });
  return { rows, errors };
}
