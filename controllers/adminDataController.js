const mongoose = require('mongoose');
const SubmittedHostel = require('../models/SubmittedHostel');
const Subscriber = require('../models/Subscriber');
const SupportMessage = require('../models/SupportMessage');
const Visit = require('../models/Visit');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const Log = require('../models/Log');
const { createAuditLog } = require('../utils/adminHelpers');

const safeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pagination = (query) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const addDateRange = (query, field, from, to) => {
  if (!from && !to) return;
  query[field] = {};
  if (from) query[field].$gte = new Date(from);
  if (to) query[field].$lte = new Date(to);
};

const respondList = (res, message, data, page, limit, total) => res.json({
  success: true,
  message,
  data,
  pagination: { page, limit, total, pages: Math.ceil(total / limit), hasMore: page * limit < total }
});

exports.listBookings = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = {};

    if (req.query.status) query.status = req.query.status;
    if (req.query.paymentStatus) query.paymentStatus = req.query.paymentStatus;
    if (req.query.hostel && mongoose.isValidObjectId(req.query.hostel)) query.hostel = req.query.hostel;
    if (req.query.student && mongoose.isValidObjectId(req.query.student)) query.student = req.query.student;
    if (req.query.hostelOwner && mongoose.isValidObjectId(req.query.hostelOwner)) query.hostelOwner = req.query.hostelOwner;
    addDateRange(query, 'createdAt', req.query.from, req.query.to);

    if (req.query.search) {
      const search = safeRegex(req.query.search);
      query.$or = [
        { bookingCode: { $regex: search, $options: 'i' } },
        { roomType: { $regex: search, $options: 'i' } },
        { 'studentDetails.name': { $regex: search, $options: 'i' } },
        { 'studentDetails.email': { $regex: search, $options: 'i' } },
        { 'studentDetails.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const [data, total] = await Promise.all([
      Booking.find(query)
        .populate('hostel', 'name hostelCode type location.addressText')
        .populate('student', 'firstName lastName email phone role')
        .populate('hostelOwner', 'firstName lastName email phone role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(query)
    ]);

    respondList(res, 'Bookings fetched successfully', data, page, limit, total);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching bookings' });
  }
};

const getById = async (Model, id, res, populate) => {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ success: false, message: 'Invalid resource id' });
    return null;
  }
  let query = Model.findById(id);
  if (populate) query = query.populate(populate);
  const item = await query;
  if (!item) res.status(404).json({ success: false, message: 'Resource not found' });
  return item;
};

exports.listSubmissions = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = {};
    if (req.query.type) query.type = req.query.type;
    if (req.query.listerEmail) query.listerEmail = String(req.query.listerEmail).toLowerCase();
    const searchValue = req.query.search ?? req.query.text;
    if (searchValue) {
      const search = safeRegex(searchValue);
      query.$or = [
        { hostelName: { $regex: search, $options: 'i' } },
        { listerEmail: { $regex: search, $options: 'i' } },
        { whatsapp: { $regex: search, $options: 'i' } }
      ];
    }
    addDateRange(query, 'createdAt', req.query.from, req.query.to);
    const [data, total] = await Promise.all([
      SubmittedHostel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      SubmittedHostel.countDocuments(query)
    ]);
    respondList(res, 'Submissions fetched successfully', data, page, limit, total);
  } catch (error) { res.status(500).json({ success: false, message: 'Error fetching submissions' }); }
};

exports.getSubmission = async (req, res) => {
  try {
    const data = await getById(SubmittedHostel, req.params.id, res);
    if (data) res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, message: 'Error fetching submission' }); }
};

exports.approveSubmission = async (req, res) => {
  try {
    const submission = await getById(SubmittedHostel, req.params.id, res);
    if (!submission) return;
    const payload = req.body.liveHostel || req.body;
    const required = ['name', 'type', 'description', 'phone'];
    if (required.some((field) => !payload[field]) || !payload.location?.addressText || !Array.isArray(payload.location?.coordinates?.coordinates)) {
      return res.status(400).json({ success: false, message: 'Complete live hostel details are required: name, type, description, phone, addressText and GeoJSON coordinates' });
    }
    const coordinates = payload.location.coordinates.coordinates.map(Number);
    if (coordinates.length !== 2 || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) {
      return res.status(400).json({ success: false, message: 'Coordinates must be [longitude, latitude]' });
    }
    const duplicate = await Hostel.findOne({ $or: [{ name: payload.name.trim() }, { whatsappNumber: submission.whatsapp }] }).select('_id name');
    if (duplicate) return res.status(409).json({ success: false, message: 'A matching live hostel already exists', hostel: duplicate });

    const hostel = await Hostel.create({
      ...payload,
      location: { ...payload.location, coordinates: { type: 'Point', coordinates } },
      isLive: false,
      isApproved: false,
      isVerified: false,
      verificationStatus: { status: 'pending' },
      phone: payload.phone,
      email: payload.email || submission.listerEmail,
      whatsappNumber: payload.whatsappNumber || submission.whatsapp
    });
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'submission_approved', resourceType: 'submittedHostel', resourceId: submission._id, description: `Approved submission into hostel ${hostel._id}`, changes: { after: { hostelId: hostel._id, status: 'pending' } }, ipAddress: req.ip, userAgent: req.get('user-agent') });
    await SubmittedHostel.deleteOne({ _id: submission._id });
    res.status(201).json({ success: true, message: 'Submission approved and archived', data: { hostel, submissionId: submission._id } });
  } catch (error) { res.status(500).json({ success: false, message: error.message || 'Error approving submission' }); }
};

exports.rejectSubmission = async (req, res) => {
  try {
    const submission = await getById(SubmittedHostel, req.params.id, res);
    if (!submission) return;
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'submission_rejected', resourceType: 'submittedHostel', resourceId: submission._id, description: `Rejected submission from ${submission.listerEmail}`, changes: { after: { rejectionReason: req.body.reason || null } }, ipAddress: req.ip, userAgent: req.get('user-agent') });
    await SubmittedHostel.deleteOne({ _id: submission._id });
    res.json({ success: true, message: 'Submission rejected and removed' });
  } catch (error) { res.status(500).json({ success: false, message: 'Error rejecting submission' }); }
};

exports.listSubscribers = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = {};
    if (req.query.search) query.email = { $regex: safeRegex(req.query.search), $options: 'i' };
    addDateRange(query, 'createdAt', req.query.from, req.query.to);
    const [data, total] = await Promise.all([Subscriber.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit), Subscriber.countDocuments(query)]);
    respondList(res, 'Subscribers fetched successfully', data, page, limit, total);
  } catch (error) { res.status(500).json({ success: false, message: 'Error fetching subscribers' }); }
};

exports.getSubscriber = async (req, res) => {
  try { const data = await getById(Subscriber, req.params.id, res); if (data) res.json({ success: true, data }); } catch (error) { res.status(500).json({ success: false, message: 'Error fetching subscriber' }); }
};

exports.deleteSubscriber = async (req, res) => {
  try {
    const subscriber = await getById(Subscriber, req.params.id, res);
    if (!subscriber) return;
    if (String(req.query.confirm).toLowerCase() !== 'true') return res.status(409).json({ success: false, message: 'Confirm deletion with ?confirm=true' });
    await Subscriber.deleteOne({ _id: subscriber._id });
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'subscriber_deleted', resourceType: 'subscriber', resourceId: subscriber._id, description: `Deleted subscriber ${subscriber.email}`, ipAddress: req.ip, userAgent: req.get('user-agent') });
    res.json({ success: true, message: 'Subscriber deleted successfully' });
  } catch (error) { res.status(500).json({ success: false, message: 'Error deleting subscriber' }); }
};

exports.exportSubscribers = async (req, res) => {
  try {
    const subscribers = await Subscriber.find().sort({ createdAt: -1 }).select('email createdAt').lean();
    const csv = ['email,createdAt', ...subscribers.map((item) => `${JSON.stringify(item.email)},${item.createdAt.toISOString()}`)].join('\n');
    res.type('text/csv').attachment('subscribers.csv').send(csv);
  } catch (error) { res.status(500).json({ success: false, message: 'Error exporting subscribers' }); }
};

const supportUserFields = 'firstName lastName email role';
exports.listSupportMessages = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.topic) query.topic = { $regex: safeRegex(req.query.topic), $options: 'i' };
    if (req.query.email) query.email = String(req.query.email).toLowerCase();
    if (req.query.user && mongoose.isValidObjectId(req.query.user)) query.user = req.query.user;
    addDateRange(query, 'createdAt', req.query.from, req.query.to);
    const [data, total] = await Promise.all([SupportMessage.find(query).populate('user', supportUserFields).sort({ createdAt: -1 }).skip(skip).limit(limit), SupportMessage.countDocuments(query)]);
    respondList(res, 'Support messages fetched successfully', data, page, limit, total);
  } catch (error) { res.status(500).json({ success: false, message: 'Error fetching support messages' }); }
};

exports.getSupportMessage = async (req, res) => {
  try { const data = await getById(SupportMessage, req.params.id, res, { path: 'user', select: supportUserFields }); if (data) res.json({ success: true, data }); } catch (error) { res.status(500).json({ success: false, message: 'Error fetching support message' }); }
};

exports.updateSupportStatus = async (req, res) => {
  try {
    const message = await getById(SupportMessage, req.params.id, res);
    if (!message) return;
    if (!['new', 'in-progress', 'resolved'].includes(req.body.status)) return res.status(400).json({ success: false, message: 'Status must be new, in-progress or resolved' });
    const before = message.status;
    message.status = req.body.status;
    await message.save();
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'support_status_changed', resourceType: 'supportMessage', resourceId: message._id, description: `Changed support status from ${before} to ${message.status}`, changes: { before: { status: before }, after: { status: message.status } }, ipAddress: req.ip, userAgent: req.get('user-agent') });
    res.json({ success: true, message: 'Support status updated', data: message });
  } catch (error) { res.status(500).json({ success: false, message: 'Error updating support status' }); }
};

exports.deleteSupportMessage = async (req, res) => {
  try { const item = await getById(SupportMessage, req.params.id, res); if (!item) return; await SupportMessage.deleteOne({ _id: item._id }); await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'support_message_deleted', resourceType: 'supportMessage', resourceId: item._id, description: 'Deleted support message', ipAddress: req.ip, userAgent: req.get('user-agent') }); res.json({ success: true, message: 'Support message deleted' }); } catch (error) { res.status(500).json({ success: false, message: 'Error deleting support message' }); }
};

const visitQuery = (queryParams) => {
  const query = {};
  if (queryParams.app) query.appName = queryParams.app;
  if (queryParams.event) query.$or = [{ event: queryParams.event }, { eventType: queryParams.event }];
  if (queryParams.device) query.deviceType = queryParams.device;
  if (queryParams.user && mongoose.isValidObjectId(queryParams.user)) query.userId = queryParams.user;
  addDateRange(query, 'eventTimestamp', queryParams.from, queryParams.to);
  return query;
};

exports.listVisits = async (req, res) => {
  try { const { page, limit, skip } = pagination(req.query); const query = visitQuery(req.query); const [data, total] = await Promise.all([Visit.find(query).select('-identifier -userAgent').sort({ eventTimestamp: -1, createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'firstName lastName email role'), Visit.countDocuments(query)]); respondList(res, 'Visits fetched successfully', data, page, limit, total); } catch (error) { res.status(500).json({ success: false, message: 'Error fetching visits' }); }
};

exports.getVisitSummary = async (req, res) => {
  try { const match = visitQuery(req.query); const data = await Visit.aggregate([{ $match: match }, { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$hourBucket' } }, appName: '$appName', deviceType: '$deviceType', locationType: '$locationType', event: { $ifNull: ['$event', '$eventType'] }, authState: '$authState' }, visits: { $sum: 1 }, uniqueIdentifiers: { $addToSet: '$visitKey' } } }, { $project: { _id: 0, day: '$_id.day', appName: '$_id.appName', deviceType: '$_id.deviceType', locationType: '$_id.locationType', event: '$_id.event', authState: '$_id.authState', visits: 1, uniqueVisits: { $size: '$uniqueIdentifiers' } } }, { $sort: { day: -1 } }]); res.json({ success: true, data }); } catch (error) { res.status(500).json({ success: false, message: 'Error fetching visit summary' }); }
};

exports.getVisit = async (req, res) => { try { const data = await getById(Visit, req.params.id, res, { path: 'userId', select: supportUserFields }); if (data) res.json({ success: true, data }); } catch (error) { res.status(500).json({ success: false, message: 'Error fetching visit' }); } };

exports.deleteVisit = async (req, res) => { try { const item = await getById(Visit, req.params.id, res); if (!item) return; if (String(req.query.confirm).toLowerCase() !== 'true') return res.status(409).json({ success: false, message: 'Confirm deletion with ?confirm=true' }); await Visit.deleteOne({ _id: item._id }); await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'visit_deleted', resourceType: 'visit', resourceId: item._id, description: 'Deleted visit record', ipAddress: req.ip, userAgent: req.get('user-agent') }); res.json({ success: true, message: 'Visit deleted' }); } catch (error) { res.status(500).json({ success: false, message: 'Error deleting visit' }); } };