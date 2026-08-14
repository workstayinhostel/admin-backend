const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const incomingTokenHash = user.getSessionTokenHash(token);
    if (user.activeSessionToken && user.activeSessionToken !== incomingTokenHash) {
      return res.status(401).json({
        success: false,
        message: 'Your session has expired. Please log in again.'
      });
    }

    if (!user.isActive && !user.forcePasswordChange) {
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }

    req.user = user;
    logger.info(`User ${user._id} authenticated successfully`);
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      logger.warn(`Unauthorized access attempt by user ${req.user._id} with role ${req.user.role}`);
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

const isFounder = async (req, res, next) => {
  if (req.user.role !== 'founder') {
    return res.status(403).json({
      success: false,
      message: 'Only founder can access this resource'
    });
  }
  next();
};

const isAdminLevel = (req, res, next) => {
  if (!['founder', 'superadmin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Admin level access required'
    });
  }
  next();
};

const checkPasswordChange = (req, res, next) => {
  if (req.user.forcePasswordChange) {
    return res.status(401).json({
      success: false,
      message: 'Password change required',
      requirePasswordChange: true
    });
  }
  next();
};

const getCurrentUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('associatedHostels');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    req.currentUser = user;
    next();
  } catch (error) {
    logger.error('Error getting current user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data'
    });
  }
};

module.exports = { protect, authorize, isFounder, isAdminLevel, checkPasswordChange, getCurrentUser };
