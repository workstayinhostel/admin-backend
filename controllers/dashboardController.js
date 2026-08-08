const User = require('../models/User');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const Log = require('../models/Log');
const logger = require('../config/logger');

exports.getLogs = async (req, res) => {
  try {
    const { action, resourceType, page = 1, limit = 20 } = req.query;
    let query = {};
    if (action) query.action = action;
    if (resourceType) query.resourceType = resourceType;

    const skip = (Number(page) - 1) * Number(limit);
    const logs = await Log.find(query).populate('user', 'firstName lastName email role').sort('-createdAt').skip(skip).limit(Number(limit));
    const total = await Log.countDocuments(query);

    res.status(200).json({ success: true, count: logs.length, total, pages: Math.ceil(total / Number(limit)), currentPage: Number(page), logs });
  } catch (error) {
    logger.error('Get logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching logs' });
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const stats = {
      totalUsers: await User.countDocuments(),
      totalHostels: await Hostel.countDocuments(),
      totalBookings: await Booking.countDocuments(),
      pendingHostels: await Hostel.countDocuments({ isPending: true }),
      pendingBookings: await Booking.countDocuments({ status: 'pending' }),
      verifiedHostels: await Hostel.countDocuments({ isApproved: true })
    };
    res.status(200).json({ success: true, stats });
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching statistics' });
  }
};
