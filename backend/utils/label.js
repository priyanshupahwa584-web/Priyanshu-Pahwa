import PDFDocument from 'pdfkit';

function clean(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function zplText(value) {
  return clean(value).replace(/[\^~]/g, ' ');
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}` : text;
}

export function normalizeLabelPayload(label = {}) {
  const trackingNumber = clean(label.trackingNumber || label.barcodeValue || 'TEST-TRACKING');
  const driver = clean(label.driver || label.customerName || label.customer || '');
  const routingSequence = clean(label.routingSequence || label.route || label.stop || '');
  const deliveryAddress = clean(label.deliveryAddress || label.address || '');
  const city = clean(label.city || '');
  const postalCode = clean(label.postalCode || label.postal || label.postcode || label.zip || '');
  return {
    trackingNumber,
    barcodeValue: clean(label.barcodeValue || trackingNumber),
    customerName: driver,
    service: clean(label.service || label.city || ''),
    route: routingSequence,
    driver,
    routingSequence,
    address: deliveryAddress,
    deliveryAddress,
    city,
    postalCode,
    fullAddress: clean(label.fullAddress || [deliveryAddress, city, postalCode].filter(Boolean).join(', ')),
    status: clean(label.status || 'Pending')
  };
}

export function buildZplLabel(label = {}) {
  const row = normalizeLabelPayload(label);
  const driver = truncate(row.driver, 34);
  const route = truncate(row.routingSequence, 20);
  const address = truncate(row.deliveryAddress, 38);
  const city = truncate(row.city, 30);
  const postalCode = truncate(row.postalCode, 18);
  return [
    '^XA',
    '^PW812',
    '^LL406',
    '^LH0,0',
    '^CI28',
    '^FO28,22^GB756,362,2^FS',
    '^FO28,92^GB756,0,2^FS',
    '^FO28,162^GB756,0,2^FS',
    '^FO28,240^GB756,0,2^FS',
    '^FO306,22^GB0,218,2^FS',
    '^FO44,42^A0N,36,32^FDTracking No.^FS',
    `^FO326,34^A0N,42,38^FD${zplText(row.trackingNumber)}^FS`,
    '^FO76,112^A0N,38,34^FDDriver:^FS',
    `^FO326,104^A0N,44,40^FD${zplText(driver || 'N/A')}^FS`,
    '^FO72,186^A0N,38,34^FDRouting Seq:^FS',
    `^FO326,178^A0N,52,46^FD${zplText(route || 'N/A')}^FS`,
    '^FO74,286^A0N,36,32^FDAddress:^FS',
    `^FO326,252^A0N,32,29^FD${zplText(address || 'N/A')}^FS`,
    `^FO326,292^A0N,32,29^FD${zplText(city || '')}^FS`,
    `^FO326,332^A0N,32,29^FD${zplText(postalCode || '')}^FS`,
    '^XZ'
  ].join('\n');
}

export async function buildPdfLabel(label = {}) {
  const row = normalizeLabelPayload(label);
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: [288, 144], margin: 8 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.lineWidth(0.8).strokeColor('#222');
    doc.rect(8, 8, 272, 128).stroke();
    doc.moveTo(8, 34).lineTo(280, 34).stroke();
    doc.moveTo(8, 62).lineTo(280, 62).stroke();
    doc.moveTo(8, 86).lineTo(280, 86).stroke();
    doc.moveTo(100, 8).lineTo(100, 136).stroke();

    doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(12).text('Tracking No.', 14, 16, { width: 82 });
    doc.fontSize(14).text(row.trackingNumber, 106, 14, { width: 164 });
    doc.fontSize(12).text('Driver:', 28, 44, { width: 66 });
    doc.fontSize(16).text(row.driver || 'N/A', 106, 40, { width: 164, align: 'center' });
    doc.fontSize(12).text('Routing Seq:', 20, 70, { width: 76 });
    doc.fontSize(19).text(row.routingSequence || 'N/A', 106, 66, { width: 164, align: 'center' });
    doc.fontSize(12).text('Address:', 24, 106, { width: 70 });
    doc.fontSize(10).text(row.deliveryAddress || 'N/A', 106, 94, { width: 164, align: 'center' });
    doc.fontSize(10).text(row.city || '', 106, 107, { width: 164, align: 'center' });
    doc.fontSize(10).text(row.postalCode || '', 106, 120, { width: 164, align: 'center' });
    doc.end();
  });
}
