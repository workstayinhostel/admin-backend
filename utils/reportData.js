const Hostel = require('../models/Hostel');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Log = require('../models/Log');

const MAX_REPORT_ROWS = 2000;
const USER_ROLES = ['student', 'hostelowner', 'agent', 'admin', 'superadmin', 'founder'];
const BOOKING_STATUSES = ['pending', 'contacted', 'confirmed', 'cancelled', 'completed', 'no-show'];
const PAYMENT_STATUSES = ['pending', 'partial', 'completed'];

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const text = (value) => String(value ?? '').trim();
const isAll = (value) => value === undefined || value === null || String(value).toLowerCase() === 'all';
const asYesNo = (value) => value ? 'Yes' : 'No';
const fullName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '';

const parseBooleanFilter = (value, label) => {
  if (isAll(value)) return null;
  if (value === true || ['true', 'on', 'yes', 'active'].includes(String(value).toLowerCase())) return true;
  if (value === false || ['false', 'off', 'no', 'inactive'].includes(String(value).toLowerCase())) return false;
  throw badRequest(`${label} must be all, on, or off.`);
};

const parseDateRange = (body, filters) => {
  const period = body.dataPeriod;
  const fromValue = filters.from || (period && typeof period === 'object' ? period.from : null);
  const toValue = filters.to || (period && typeof period === 'object' ? period.to : null);
  const from = fromValue ? new Date(fromValue) : null;
  const to = toValue ? new Date(toValue) : null;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw badRequest('Date period contains an invalid date.');
  }
  if (from && to && from > to) throw badRequest('The start date must be on or before the end date.');
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(toValue))) to.setHours(23, 59, 59, 999);

  const queryRange = {};
  if (from) queryRange.$gte = from;
  if (to) queryRange.$lte = to;

  const format = (date) => date.toLocaleDateString('en-GB');
  let summary = 'All dates';
  if (from || to) summary = `${from ? format(from) : 'Beginning'} to ${to ? format(to) : 'Present'}`;
  else if (typeof period === 'string' && period.trim()) {
    throw badRequest('Use dataPeriod.from and dataPeriod.to to filter report dates.');
  }

  return { queryRange, summary };
};

const appendRemarksColumn = (columns, rows, includeRemarks, getRemark) => {
  if (!includeRemarks) return;
  columns.push({ key: 'remarks', label: 'Remarks' });
  rows.forEach((row, index) => { row.remarks = getRemark(index); });
};

const prependSerialNumberColumn = (columns, rows) => {
  columns.unshift({ key: 'serialNumber', label: 'SN' });
  rows.forEach((row, index) => { row.serialNumber = index + 1; });
};

const buildHostelReport = async (filters, includeRemarks) => {
  const query = {};
  const type = text(filters.type || filters.hostelType || 'all').toLowerCase();
  if (!['all', 'boys', 'girls', 'pg'].includes(type)) throw badRequest('Hostel type must be all, boys, girls, or pg.');
  if (type !== 'all') query.type = type;

  let verification = filters.verificationStatus ?? filters.verified ?? 'all';
  verification = typeof verification === 'boolean'
    ? (verification ? 'verified' : 'unverified')
    : text(verification).toLowerCase();
  if (verification === 'on' || verification === 'true') verification = 'verified';
  if (verification === 'off' || verification === 'false') verification = 'unverified';
  if (!['all', 'verified', 'unverified', 'pending', 'rejected'].includes(verification)) {
    throw badRequest('Verification status must be all, verified, unverified, pending, or rejected.');
  }
  if (verification === 'verified') query.$or = [{ isVerified: true }, { 'verificationStatus.status': 'verified' }];
  if (verification === 'unverified') query.isVerified = false;
  if (verification === 'pending' || verification === 'rejected') query['verificationStatus.status'] = verification;

  for (const [filterName, fieldName] of [['live', 'isLive'], ['approved', 'isApproved'], ['sponsored', 'isSponsored']]) {
    const value = parseBooleanFilter(filters[filterName], filterName);
    if (value !== null) query[fieldName] = value;
  }

  const hostels = await Hostel.find(query)
    .select('name type hostelCode owner verificationStatus isVerified isLive isApproved isSponsored averageRating ratings location.addressText remarks remark')
    .populate('owner', 'firstName lastName email')
    .sort({ hostelCode: 1, name: 1 })
    .limit(MAX_REPORT_ROWS)
    .lean();

  const rows = hostels.map((hostel) => ({
    hostelCode: hostel.hostelCode || '',
    name: hostel.name || '',
    type: hostel.type || '',
    ownerEmail: hostel.owner?.email || '',
    verificationStatus: hostel.verificationStatus?.status || (hostel.isVerified ? 'verified' : 'unverified'),
    live: asYesNo(hostel.isLive),
    approved: asYesNo(hostel.isApproved),
    sponsored: asYesNo(hostel.isSponsored),
    rating: hostel.averageRating ?? hostel.ratings?.average ?? 0,
    address: hostel.location?.addressText || '',
    remarks: hostel.remarks || hostel.remark || ''
  }));
  const columns = [
    { key: 'hostelCode', label: 'Hostel Code' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'ownerEmail', label: 'Owner Email' },
    { key: 'verificationStatus', label: 'Verification Status' },
    { key: 'live', label: 'Live' },
    { key: 'approved', label: 'Approved' },
    { key: 'sponsored', label: 'Sponsored' },
    { key: 'rating', label: 'Rating' },
    { key: 'address', label: 'Address' }
  ];
  appendRemarksColumn(columns, rows, includeRemarks, (index) => rows[index].remarks);

  const labels = [`Type: ${type === 'all' ? 'All' : type}`];
  labels.push(`Verification: ${verification}`);
  for (const key of ['live', 'approved', 'sponsored']) {
    const value = parseBooleanFilter(filters[key], key);
    labels.push(`${key[0].toUpperCase()}${key.slice(1)}: ${value === null ? 'All' : value ? 'On' : 'Off'}`);
  }
  return { documentName: 'Hostels', columns, rows, summary: labels.join(' | ') };
};

const buildUserReport = async (filters, includeRemarks) => {
  let roles = filters.roles ?? filters.role ?? 'all';
  if (!Array.isArray(roles)) roles = [roles];
  roles = roles.map((role) => text(role).toLowerCase()).filter((role) => role && role !== 'all');
  const invalidRole = roles.find((role) => !USER_ROLES.includes(role));
  if (invalidRole) throw badRequest(`Unknown user role: ${invalidRole}.`);

  const query = roles.length ? { role: { $in: roles } } : {};
  const users = await User.find(query)
    .select('firstName lastName email role isActive remarks remark')
    .sort({ firstName: 1, lastName: 1 })
    .limit(MAX_REPORT_ROWS)
    .lean();
  const rows = users.map((user) => ({
    name: fullName(user),
    email: user.email || '',
    status: user.isActive ? 'Active' : 'Inactive',
    remarks: user.remarks || user.remark || ''
  }));
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status' }
  ];
  appendRemarksColumn(columns, rows, includeRemarks, (index) => rows[index].remarks);
  prependSerialNumberColumn(columns, rows);

  return {
    documentName: 'Users',
    columns,
    rows,
    summary: `Roles: ${roles.length ? roles.join(', ') : 'All'}`
  };
};

const buildBookingReport = async (body, filters, includeRemarks) => {
  const { queryRange, summary: period } = parseDateRange(body, filters);
  const query = {};
  if (Object.keys(queryRange).length) query.checkInDate = queryRange;

  const status = text(filters.status || 'all').toLowerCase();
  if (!isAll(status)) {
    if (!BOOKING_STATUSES.includes(status)) throw badRequest('Invalid booking status.');
    query.status = status;
  }
  const paymentStatus = text(filters.paymentStatus || 'all').toLowerCase();
  if (!isAll(paymentStatus)) {
    if (!PAYMENT_STATUSES.includes(paymentStatus)) throw badRequest('Invalid payment status.');
    query.paymentStatus = paymentStatus;
  }

  const bookings = await Booking.find(query)
    .populate('hostel', 'name location.addressText')
    .populate('student', 'firstName lastName phone')
    .sort({ checkInDate: -1 })
    .limit(MAX_REPORT_ROWS)
    .lean();
  const rows = bookings.map((booking) => ({
    guestName: booking.studentDetails?.name || '',
    studentName: fullName(booking.student) || booking.studentDetails?.name || '',
    hostelName: booking.hostel?.name || '',
    address: booking.hostel?.location?.addressText || '',
    checkInDate: booking.checkInDate || '',
    guestContact: booking.studentDetails?.phone || booking.student?.phone || '',
    remarks: booking.specialRequests || booking.additionalInfo || ''
  }));
  const columns = [
    { key: 'guestName', label: 'Guest Name' },
    { key: 'studentName', label: 'Student Name' },
    { key: 'hostelName', label: 'Hostel Name' },
    { key: 'address', label: 'Address' },
    { key: 'checkInDate', label: 'Check-in Date' },
    { key: 'guestContact', label: 'Guest Contact' }
  ];
  appendRemarksColumn(columns, rows, includeRemarks, (index) => rows[index].remarks);
  prependSerialNumberColumn(columns, rows);
  const filtersSummary = [period !== 'All dates' ? `Period: ${period}` : null, `Status: ${status}`, `Payment: ${paymentStatus}`].filter(Boolean);

  return { documentName: 'Bookings', columns, rows, summary: filtersSummary.join(' | ') };
};

const buildAuditReport = async (body, filters, includeRemarks, marketingOnly = false) => {
  const { queryRange, summary: period } = parseDateRange(body, filters);
  const query = marketingOnly ? { action: 'marketing_email_sent' } : {};
  if (Object.keys(queryRange).length) query.createdAt = queryRange;
  if (!marketingOnly && filters.action && !isAll(filters.action)) query.action = text(filters.action);
  if (filters.status && !isAll(filters.status)) {
    const status = text(filters.status).toLowerCase();
    if (!['success', 'failed', 'pending'].includes(status)) throw badRequest('Audit status must be success, failed, or pending.');
    query.status = status;
  }

  const logs = await Log.find(query)
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(MAX_REPORT_ROWS)
    .lean();
  const rows = logs.map((log) => ({
    auditType: log.action || '',
    name: log.userName || fullName(log.user) || 'System',
    resource: [log.resourceType, log.resourceName].filter(Boolean).join(': '),
    status: log.status || '',
    timestamp: log.createdAt || '',
    emailType: marketingOnly ? 'Marketing Email' : undefined,
    remarks: log.description || ''
  }));
  const columns = marketingOnly ? [
    { key: 'emailType', label: 'Email Type' },
    { key: 'name', label: 'Sent By' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp' }
  ] : [
    { key: 'auditType', label: 'Audit Type' },
    { key: 'name', label: 'Name' },
    { key: 'resource', label: 'Resource' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp' }
  ];
  appendRemarksColumn(columns, rows, includeRemarks, (index) => rows[index].remarks);
  prependSerialNumberColumn(columns, rows);
  const summary = period === 'All dates' ? 'All audit events' : `Period: ${period}`;
  return { documentName: marketingOnly ? 'Marketing Emails' : 'Audit Report', columns, rows, summary };
};

const buildCustomReport = (body, includeRemarks) => {
  const documentName = text(body.documentName || body.docName);
  let rows = body.rows;
  let columns = body.columns;
  if (!documentName || documentName.length > 100) throw badRequest('Provide a documentName up to 100 characters.');
  if (!Array.isArray(rows) || rows.length > MAX_REPORT_ROWS) {
    throw badRequest(`Rows must be an array containing no more than ${MAX_REPORT_ROWS} records.`);
  }
  if (!Array.isArray(columns) && rows.length && rows[0] && !Array.isArray(rows[0])) {
    columns = Object.keys(rows[0]).map((key) => ({ key, label: key }));
  }
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 20) {
    throw badRequest('Provide between 1 and 20 columns, or rows with object fields.');
  }
  columns = columns.map((column) => {
    if (typeof column === 'string') return { key: column, label: column };
    if (column && typeof column.key === 'string') return { key: column.key, label: String(column.label || column.key) };
    return null;
  });
  if (columns.some((column) => !column)) throw badRequest('Each column must be a name or an object with a key.');
  rows = rows.map((row) => Array.isArray(row)
    ? Object.fromEntries(columns.map((column, index) => [column.key, row[index]]))
    : row);
  if (includeRemarks && !columns.some((column) => column.key.toLowerCase() === 'remarks')) {
    columns.push({ key: 'remarks', label: 'Remarks' });
  }
  if (!includeRemarks) columns = columns.filter((column) => column.key.toLowerCase() !== 'remarks');
  if (!columns.length) throw badRequest('At least one non-remarks column is required.');
  prependSerialNumberColumn(columns, rows);
  const period = typeof body.dataPeriod === 'string' ? body.dataPeriod.trim() : 'All records';
  if (period.length > 160) throw badRequest('Data period must be no more than 160 characters.');
  return { documentName, columns, rows, summary: period };
};

exports.buildReport = async (body = {}) => {
  const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
  const includeRemarks = body.includeRemarks === true;
  const type = text(body.reportType || (Array.isArray(body.rows) ? 'custom' : '')).toLowerCase().replace(/[_\s]+/g, '-');

  if (type === 'hostel' || type === 'hostels') return buildHostelReport(filters, includeRemarks);
  if (type === 'user' || type === 'users') return buildUserReport(filters, includeRemarks);
  if (type === 'booking' || type === 'bookings') return buildBookingReport(body, filters, includeRemarks);
  if (type === 'audit' || type === 'audits' || type === 'audit-report') return buildAuditReport(body, filters, includeRemarks);
  if (['marketing-email', 'marketing-emails', 'emails'].includes(type)) return buildAuditReport(body, filters, includeRemarks, true);
  if (type === 'custom') return buildCustomReport(body, includeRemarks);
  throw badRequest('reportType must be hostels, users, bookings, audit, marketing-emails, or custom.');
};

exports.MAX_REPORT_ROWS = MAX_REPORT_ROWS;