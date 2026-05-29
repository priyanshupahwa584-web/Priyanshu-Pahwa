import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';

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
  return {
    trackingNumber,
    barcodeValue: clean(label.barcodeValue || trackingNumber),
    customerName: clean(label.customerName || label.customer || label.driver || ''),
    service: clean(label.service || label.city || ''),
    route: clean(label.route || label.routingSequence || label.stop || ''),
    address: clean(label.address || label.deliveryAddress || ''),
    city: clean(label.city || ''),
    postalCode: clean(label.postalCode || label.postal || label.postcode || label.zip || ''),
    status: clean(label.status || 'Pending')
  };
}

export function buildZplLabel(label = {}) {
  const row = normalizeLabelPayload(label);
  const customer = truncate(row.customerName, 34);
  const service = truncate(row.service, 28);
  const route = truncate(row.route, 20);
  const address = truncate([row.address, row.city, row.postalCode].filter(Boolean).join(', ') || row.service, 36);
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
    '^FO76,112^A0N,38,34^FDDriver / Customer:^FS',
    `^FO326,104^A0N,44,40^FD${zplText(customer || 'N/A')}^FS`,
    '^FO72,186^A0N,38,34^FDRouting Seq:^FS',
    `^FO326,178^A0N,52,46^FD${zplText(route || 'N/A')}^FS`,
    '^FO74,258^A0N,34,30^FDService / Address:^FS',
    `^FO326,248^A0N,24,22^FD${zplText(service || 'N/A')}^FS`,
    `^FO326,276^A0N,24,22^FD${zplText(address || 'N/A')}^FS`,
    `^FO92,312^BCN,62,Y,N,N^FD${zplText(row.barcodeValue)}^FS`,
    '^XZ'
  ].join('\n');
}

export async function buildPdfLabel(label = {}) {
  const row = normalizeLabelPayload(label);
  const barcodeBuffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: row.barcodeValue,
    scale: 2,
    height: 8,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0
  });
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
    doc.moveTo(8, 112).lineTo(280, 112).stroke();
    doc.moveTo(100, 8).lineTo(100, 112).stroke();

    doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(12).text('Tracking No.', 14, 16, { width: 82 });
    doc.fontSize(14).text(row.trackingNumber, 106, 14, { width: 164 });
    doc.fontSize(12).text('Driver:', 28, 44, { width: 66 });
    doc.fontSize(16).text(row.customerName || 'N/A', 106, 40, { width: 164, align: 'center' });
    doc.fontSize(12).text('Routing Seq:', 20, 70, { width: 76 });
    doc.fontSize(19).text(row.route || 'N/A', 106, 66, { width: 164, align: 'center' });
    doc.fontSize(10).text('Service / Address:', 16, 94, { width: 86 });
    doc.fontSize(9).text(row.service || 'N/A', 106, 91, { width: 164, align: 'center' });
    doc.fontSize(8).text([row.address, row.city, row.postalCode].filter(Boolean).join(', ') || 'N/A', 106, 103, { width: 164, align: 'center' });
    doc.image(barcodeBuffer, 74, 116, { width: 140, height: 16 });
    doc.font('Helvetica-Bold').fontSize(7).text(row.barcodeValue, 216, 119, { width: 58, align: 'center' });
    doc.end();
  });
}
