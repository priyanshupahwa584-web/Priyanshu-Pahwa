import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

function csvCell(value) {
  const text = value === null || typeof value === 'undefined' ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows, metadata = {}) {
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).filter((key) => !key.startsWith('_')).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const metaLines = Object.entries(metadata).map(([key, value]) => `# ${key}: ${value}`);
  const body = [headers.join(',')]
    .concat(rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')))
    .join('\n');
  return Buffer.from([...metaLines, body].join('\n'), 'utf8');
}

export async function buildXlsx(rows, metadata = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Broadreach Operations Platform';
  workbook.created = new Date();
  const metaSheet = workbook.addWorksheet('ExportInfo');
  metaSheet.columns = [{ header: 'key', key: 'key', width: 24 }, { header: 'value', key: 'value', width: 80 }];
  Object.entries(metadata).forEach(([key, value]) => metaSheet.addRow({ key, value }));

  const dataRows = rows.map((row) => {
    const clean = { ...row };
    delete clean._rowNumber;
    return clean;
  });
  const headers = Array.from(dataRows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const dataSheet = workbook.addWorksheet('Data');
  dataSheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(14, String(header).length + 4) }));
  dataRows.forEach((row) => dataSheet.addRow(row));
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

export function buildPdf(rows, metadata = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 42, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text('Broadreach Operations Platform Export', { underline: true });
    doc.moveDown();
    Object.entries(metadata).forEach(([key, value]) => doc.fontSize(9).text(`${key}: ${value}`));
    doc.moveDown();
    rows.slice(0, 120).forEach((row, index) => {
      const summary = `${row.date || ''} | ${row.facility || ''} | Pieces: ${row.pieces || 0} | Throughput: ${row.throughput || 0} | Productivity: ${row.productivity || 0}`;
      doc.fontSize(9).text(`${index + 1}. ${summary}`);
    });
    if (rows.length > 120) doc.moveDown().fontSize(9).text(`Showing first 120 of ${rows.length} rows.`);
    doc.end();
  });
}

export function mimeFor(format) {
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pdf') return 'application/pdf';
  return 'text/csv';
}

export async function buildExport(format, rows, metadata) {
  if (format === 'xlsx') return buildXlsx(rows, metadata);
  if (format === 'pdf') return buildPdf(rows, metadata);
  return buildCsv(rows, metadata);
}
