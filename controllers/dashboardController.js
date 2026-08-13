const User = require('../models/User');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const Log = require('../models/Log');
const logger = require('../config/logger');

exports.getLogs = async (req, res) => {
  try {
    const { action, resourceType, page = 1, limit = 20, all } = req.query;
    const shouldReturnAll = String(all).toLowerCase() === 'true';

    let query = {};
    if (action) query.action = action;
    if (resourceType) query.resourceType = resourceType;

    const pageValue = Number(page) || 1;
    const limitValue = shouldReturnAll ? 0 : (Number(limit) || 20);

    let logQuery = Log.find(query).populate('user', 'firstName lastName email role').sort('-createdAt');

    if (!shouldReturnAll) {
      const skip = (pageValue - 1) * limitValue;
      logQuery = logQuery.skip(skip).limit(limitValue);
    }

    const logs = await logQuery.exec();
    const total = await Log.countDocuments(query);

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      pages: shouldReturnAll ? 1 : Math.ceil(total / limitValue),
      currentPage: shouldReturnAll ? 1 : pageValue,
      all: shouldReturnAll,
      logs
    });
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
