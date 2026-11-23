import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

import { netLine, type QuoteLine } from './commerce-values';
export { netLine } from './commerce-values';
export interface QuoteClient { rfc?: string; contact?: string; email?: string; address?: string; }
export interface QuoteDocument {
  id: number; partyId?: number; party: string; owner: string; date: string; validUntil: string; status: string;
  terms: string; notes: string; taxRate: number; subtotal: number; tax: number; total: number; lines: QuoteLine[];
}

const navy = '#103554';
const teal = '#08788b';
const muted = '#4e6475';
const lineColor = '#dce5eb';
const pale = '#eef5f8';
const ink = '#152b3e';
const left = 15;
const right = 195;
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const date = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' });
const dateLabel = (value: string) => date.format(new Date(value));
const unitNames = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

export function quoteCode(id: number) { return 'COT-' + String(id).padStart(4, '0'); }

function numberInWords(value: number): string {
  if (value < 30) return unitNames[value];
  if (value < 100) {
    const unit = value % 10;
    return tens[Math.floor(value / 10)] + (unit ? ' y ' + unitNames[unit] : '');
  }
  if (value < 1000) return value === 100 ? 'cien' :
    (hundreds[Math.floor(value / 100)] + ' ' + numberInWords(value % 100)).trim();
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const prefix = thousands === 1 ? 'mil' : numberInWords(thousands) + ' mil';
    return (prefix + ' ' + numberInWords(value % 1000)).trim();
  }
  const millions = Math.floor(value / 1_000_000);
  const prefix = millions === 1 ? 'un millón' : numberInWords(millions) + ' millones';
  return (prefix + ' ' + numberInWords(value % 1_000_000)).trim();
}

function amountInWords(amount: number) {
  const total = Math.round(amount * 100);
  const whole = Math.floor(total / 100);
  const pesos = whole === 1 ? 'peso' : 'pesos';
  const noun = whole >= 1_000_000 && whole % 1_000_000 === 0 ? ' de ' + pesos : ' ' + pesos;
  const words = (numberInWords(whole) || 'cero') + noun + ' ' + String(total % 100).padStart(2, '0') + '/100 M.N.';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function makeQuotePdf(quote: QuoteDocument, logo?: Uint8Array, client?: QuoteClient): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: quoteCode(quote.id) + ' · Propuesta comercial BUMI', author: 'BUMI' });
  function type(size: number, color = ink, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color);
  }
  function drawHeader(first: boolean) {
    if (logo) doc.addImage(logo, 'PNG', left, 11, 32, 17.45);
    type(14, navy, true);
    doc.text('BUMI', logo ? 49 : left, 18);
    type(8, muted);
    doc.text('Gestión comercial', logo ? 49 : left, 23);
    type(7.5, muted, true);
    doc.text('PROPUESTA COMERCIAL', right, 13, { align: 'right' });
    type(17, teal, true);
    doc.text(quoteCode(quote.id), right, 20, { align: 'right' });
    type(7.5, muted);
    if (first) {
      doc.text('Emisión: ' + dateLabel(quote.date), right, 25, { align: 'right' });
      doc.text('Válida hasta: ' + dateLabel(quote.validUntil), right, 29, { align: 'right' });
    } else {
      doc.text('Continuación de la propuesta', right, 26, { align: 'right' });
    }
    doc.setDrawColor(teal).setLineWidth(.35).line(left, 33, right, 33);
  }

  type(10, navy, true);
  const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
  const party = doc.splitTextToSize(oneLine(quote.party), 103) as string[];
  const owner = doc.splitTextToSize(oneLine(quote.owner), 54) as string[];
  type(8, muted);
  const clientInfo = [
    client?.rfc ? 'RFC: ' + client.rfc : '', client?.contact ? 'Atención: ' + client.contact : '',
    client?.email || '', client?.address || '',
  ].filter(Boolean).flatMap(value => doc.splitTextToSize(oneLine(value), 110) as string[]);
  const identityHeight = 11 + Math.max(party.length * 4.3 + clientInfo.length * 3.5, owner.length * 4.3);
  doc.setFillColor(pale).roundedRect(left, 39, right - left, identityHeight, 2, 2, 'F');
  type(7.5, muted, true);
  doc.text('DATOS DEL CLIENTE', left + 4, 45);
  doc.text('RESPONSABLE COMERCIAL', right - 4, 45, { align: 'right' });
  type(10, navy, true);
  doc.text(party, left + 4, 50);
  doc.text(owner, right - 4, 50, { align: 'right' });
  if (clientInfo.length) {
    type(8, muted);
    doc.text(clientInfo, left + 4, 50 + party.length * 4.3);
  }

  let tableEnd = 39 + identityHeight + 5;
  autoTable(doc, {
    startY: tableEnd,
    margin: { top: 39, left, right: 15, bottom: 19 },
    head: [['#', 'Descripción del producto o servicio', 'Cant.', 'Precio unitario', 'Descuento', 'Importe']],
    body: quote.lines.map((row, index) => [String(index + 1).padStart(2, '0'), row.product,
      String(row.quantity), money.format(row.price), row.discount + ' %', money.format(netLine(row))]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.4, textColor: ink, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 } },
    headStyles: { fillColor: pale, textColor: navy, lineWidth: 0, fontSize: 7.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: '#f8fbfc' },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 67 }, 2: { cellWidth: 16, halign: 'right' },
      3: { cellWidth: 31, halign: 'right' }, 4: { cellWidth: 23, halign: 'right' }, 5: { cellWidth: 33, halign: 'right', fontStyle: 'bold' } },
    rowPageBreak: 'avoid',
    didDrawPage: data => { tableEnd = data.cursor?.y ?? tableEnd; drawHeader(data.pageNumber === 1); },
  });

  let y = tableEnd + 7;
  const need = (height: number) => {
    if (y + height > 277) { doc.addPage(); drawHeader(false); y = 40; }
  };
  type(9, navy, true);
  const written = doc.splitTextToSize(amountInWords(quote.total), 85) as string[];
  const summaryHeight = Math.max(34, 13 + written.length * 4);
  need(summaryHeight);
  doc.setFillColor(pale).roundedRect(left, y, 94, 13 + written.length * 4, 2, 2, 'F');
  type(7.5, muted, true);
  doc.text('IMPORTE CON LETRA', left + 4, y + 6);
  type(9, navy, true);
  doc.text(written, left + 4, y + 11);
  const gross = quote.lines.reduce((sum, row) => sum + row.quantity * row.price, 0);
  const discount = Math.max(0, Math.round((gross - quote.subtotal) * 100) / 100);
  const ledger: [string, string][] = [
    ['Subtotal bruto', money.format(gross)], ['Descuento comercial', money.format(discount)],
    ['Subtotal neto', money.format(quote.subtotal)], ['Impuesto (' + quote.taxRate + ' %)', money.format(quote.tax)],
  ];
  ledger.forEach(([label, amount], index) => {
    type(8.3, muted);
    doc.text(label, 116, y + 4 + index * 5);
    type(8.3);
    doc.text(amount, right - 3, y + 4 + index * 5, { align: 'right' });
  });
  doc.setFillColor(pale).roundedRect(113, y + 23, 82, 9, 2, 2, 'F');
  type(9, teal, true);
  doc.text('TOTAL', 116, y + 29);
  doc.text(money.format(quote.total) + ' MXN', right - 3, y + 29, { align: 'right' });
  y += summaryHeight + 5;

  function drawNotes(title: string, value: string) {
    if (!value.trim()) return;
    type(8.7);
    const wrapped = doc.splitTextToSize(value, right - left - 9) as string[];
    for (let offset = 0; offset < wrapped.length;) {
      need(16);
      const lines = wrapped.slice(offset, offset + Math.floor((277 - y - 12) / 3.7));
      const height = 12 + lines.length * 3.7;
      doc.setFillColor(pale).roundedRect(left, y, right - left, height, 2, 2, 'F');
      type(7.5, navy, true);
      doc.text(title + (offset ? ' (CONTINUACIÓN)' : ''), left + 4, y + 6);
      type(8.7);
      doc.text(lines, left + 4, y + 11);
      offset += lines.length;
      y += height + 5;
    }
  }
  drawNotes('TÉRMINOS Y CONDICIONES', quote.terms);
  drawNotes('OBSERVACIONES', quote.notes);

  need(24);
  doc.setDrawColor(lineColor).setLineWidth(.28).line(left, y + 13, 99, y + 13).line(111, y + 13, right, y + 13);
  type(8, navy, true);
  doc.text('Aceptación de la propuesta', 57, y + 18, { align: 'center' });
  doc.text('Responsable comercial', 153, y + 18, { align: 'center' });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(lineColor).line(left, 282, right, 282);
    type(7.5, muted);
    doc.text('BUMI  |  ' + quoteCode(quote.id) + '  |  ' + quote.status, left, 287);
    doc.text('Página ' + page + ' de ' + pages, right, 287, { align: 'right' });
  }
  return doc;
}

