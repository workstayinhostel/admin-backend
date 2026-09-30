const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const logoPath = path.join(__dirname, '..', 'utils', 'logo.png');

const toCellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleString('en-GB');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
};

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB');
};

const formatPeriod = (period) => {
  if (typeof period === 'string') return period.trim();
  if (!period || typeof period !== 'object') return 'Not specified';
  if (period.label || period.description) return String(period.label || period.description);

  const from = period.from ? formatDate(period.from) : 'Beginning';
  const to = period.to ? formatDate(period.to) : 'Present';
  return `${from} to ${to}`;
};

const getColumnText = (row, column, index) => {
  if (Array.isArray(row)) return toCellText(row[index]);
  return toCellText(row?.[column.key]);
};

const safeFilename = (value) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'admin-report';

exports.generatePdf = (req, res) => {
  const documentName = String(req.body.documentName || req.body.docName || '').trim();
  const { rows, columns: requestedColumns } = req.body;

  if (!documentName || documentName.length > 100) {
    return res.status(400).json({ success: false, message: 'Provide a documentName up to 100 characters.' });
  }
  if (!Array.isArray(rows) || rows.length > 2000) {
    return res.status(400).json({ success: false, message: 'Rows must be an array containing no more than 2,000 records.' });
  }

  let columns = requestedColumns;
  if (!Array.isArray(columns) && rows.length && rows[0] && !Array.isArray(rows[0])) {
    columns = Object.keys(rows[0]).map((key) => ({ key, label: key }));
  }
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 20) {
    return res.status(400).json({ success: false, message: 'Provide between 1 and 20 columns, or rows with object fields.' });
  }

  columns = columns.map((column) => {
    if (typeof column === 'string') return { key: column, label: column };
    if (column && typeof column.key === 'string') {
      return { key: column.key, label: String(column.label || column.key) };
    }
    return null;
  });
  if (columns.some((column) => !column)) {
    return res.status(400).json({ success: false, message: 'Each column must be a name or an object with a key.' });
  }

  const period = formatPeriod(req.body.dataPeriod);
  if (period.length > 160) {
    return res.status(400).json({ success: false, message: 'Data period must be no more than 160 characters.' });
  }

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  const filename = `${safeFilename(documentName)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.on('error', () => res.destroy());
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const left = 36;
  const right = pageWidth - 36;
  const tableWidth = right - left;
  const columnWidth = tableWidth / columns.length;
  const colors = {
    ink: '#202b2a',
    brand: '#176b5b',
    soft: '#edf4f1',
    grid: '#cbd7d2',
    muted: '#5f6d69',
    white: '#ffffff'
  };
  let pageNumber = 1;

  const drawFooter = () => {
    doc.save();
    doc.font('Helvetica').fontSize(8).fillColor(colors.muted);
    doc.text('Stay In Hostel  |  Admin Report', left, pageHeight - 25, { lineBreak: false });
    doc.text(`Page ${pageNumber}`, right - 70, pageHeight - 25, { width: 70, align: 'right', lineBreak: false });
    doc.restore();
  };

  const drawTableHeader = (top) => {
    const headerHeight = 24;
    columns.forEach((column, index) => {
      const x = left + index * columnWidth;
      doc.rect(x, top, columnWidth, headerHeight).fillAndStroke(colors.brand, colors.brand);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.white)
        .text(column.label, x + 5, top + 7, { width: columnWidth - 10, height: headerHeight - 8, ellipsis: true });
    });
    return top + headerHeight;
  };

  const drawContinuationHeader = () => {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.brand)
      .text(`${documentName} - continued`, left, 30, { lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(colors.muted)
      .text(`Data period: ${period}`, left, 49, { lineBreak: false });
    return drawTableHeader(68);
  };

  const generatedOn = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const generatedByName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'Admin';
  const generatedBy = `${generatedByName} (${req.user.email || ''})`;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, left, 26, { fit: [62, 62] });
  }
  doc.font('Helvetica-Bold').fontSize(19).fillColor(colors.brand)
    .text('Stay In Hostel', left + 72, 31, { width: tableWidth - 144, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor(colors.ink)
    .text('Admin Panel', left + 72, 56, { width: tableWidth - 144, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.ink)
    .text(documentName, left + 72, 76, { width: tableWidth - 144, align: 'center', lineBreak: false, ellipsis: true });

  doc.font('Helvetica').fontSize(8).fillColor(colors.ink)
    .text(`Generated on: ${generatedOn}`, left, 108, { width: tableWidth * 0.48, lineBreak: false });
  doc.text(`Generated by: ${generatedBy}`, left + tableWidth * 0.48, 108, {
    width: tableWidth * 0.52, align: 'right', lineBreak: false, ellipsis: true
  });
  doc.fillColor(colors.muted).text(`Data period: ${period}`, left, 126, { width: tableWidth, lineBreak: false, ellipsis: true });

  let cursorY = drawTableHeader(148);
  const fontSize = Math.max(6, Math.min(8, 78 / columns.length));

  rows.forEach((row, rowIndex) => {
    const cells = columns.map((column, index) => getColumnText(row, column, index));
    const cellHeights = cells.map((text) => doc.font('Helvetica').fontSize(fontSize)
      .heightOfString(text || ' ', { width: Math.max(8, columnWidth - 10), lineGap: 1 }));
    const rowHeight = Math.max(22, ...cellHeights.map((height) => height + 9));

    if (cursorY + rowHeight > pageHeight - 42) {
      drawFooter();
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 36 });
      pageNumber += 1;
      cursorY = drawContinuationHeader();
    }

    cells.forEach((text, index) => {
      const x = left + index * columnWidth;
      const fill = rowIndex % 2 === 0 ? colors.white : colors.soft;
      doc.rect(x, cursorY, columnWidth, rowHeight).fillAndStroke(fill, colors.grid);
      doc.font('Helvetica').fontSize(fontSize).fillColor(colors.ink)
        .text(text, x + 5, cursorY + 5, { width: columnWidth - 10, height: rowHeight - 8, lineGap: 1 });
    });
    cursorY += rowHeight;
  });

  drawFooter();
  doc.end();
};