const User = require('../models/User');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const Log = require('../models/Log');
const Otp = require('../models/Otp');
const Review = require('../models/Review');
const { sendEmail, sendTemplateEmail } = require('../utils/emailService');
const emailTemplates = require('../utils/emailTemplates');
const logger = require('../config/logger');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');
const { uploadMultipleFiles } = require('../config/cloudinary');

const hostelImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }
});

const roleHierarchy = {
  student: 1,
  hostelowner: 2,
  agent: 3,
  admin: 4,
  superadmin: 5,
  founder: 6
};

const isAdminRole = (role) => ['admin', 'superadmin', 'founder'].includes(role);
const normalizeHostelType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['boys', 'male', 'boy'].includes(normalized)) return 'boys';
  if (['girls', 'female', 'girl'].includes(normalized)) return 'girls';
  if (['pg', 'paying guest', 'payingguest'].includes(normalized)) return 'pg';
  return null;
};
const getHostelPermission = (user, hostel) => {
  const isOwner = Boolean(hostel?.owner && hostel.owner.toString() === user?._id?.toString());
  const isAdmin = isAdminRole(user?.role);
  return { isOwner, isAdmin, canManage: isOwner || isAdmin };
};

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const generateShortPassword = () => {
  // Generates short, secure passwords like 'asdansd34' or 'dnoeir94'
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  // Generates 6 random letters
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Appends 2 random numbers at the end
  result += Math.floor(10 + Math.random() * 90);
  
  return result;
};

const sendAdminOtpToEmail = async (email, purpose, otp) => {
  const subject = purpose === 'admin-password-reset'
    ? 'Admin Portal Password Reset OTP'
    : 'Admin Portal Verification OTP';
  const html = `<p>Your Admin Portal OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`;

  try {
    const result = await sendEmail(email, subject, html);
    return { success: true, otp, ...result };
  } catch (error) {
    logger.warn(`Admin OTP email could not be delivered to ${email}: ${error.message}`);
    return { success: false, otp };
  }
};

/**
 * Administrative Portal Login (Agents, Admins, Superadmins, Founders)
 */
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const adminRoles = ['agent', 'admin', 'superadmin', 'founder'];
    if (!adminRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Students and hostel owners must log in via the public website.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account is deactivated' });
    }

    user.lastLogin = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    user.ipAddress = req.ip;
    await user.save();

    await Log.create({
      user: user._id,
      userRole: user.role,
      action: 'admin_login',
      resourceType: 'user',
      resourceId: user._id,
      description: `Admin portal login: ${email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    const token = user.getSignedJwtToken();
    logger.info(`Admin logged in: ${email} (${user.role})`);

    res.status(200).json({
      success: true,
      message: user.forcePasswordChange ? 'Password reset required' : 'Admin login successful',
      token,
      requirePasswordChange: Boolean(user.forcePasswordChange),
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }
    });
  } catch (error) {
    logger.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Error during admin login' });
  }
};

/**
 * Admin Forgot Password & Verification Helpers
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Please provide email' });

    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    const adminRoles = ['agent', 'admin', 'superadmin', 'founder'];
    
    if (!user || !adminRoles.includes(user.role)) {
      return res.status(404).json({ success: false, message: 'Admin account not found with this email' });
    }

    if (!otp) {
      const otpValue = generateOtp();
      await Otp.findOneAndUpdate(
        { email: normalizedEmail, purpose: 'admin-password-reset' },
        { otp: otpValue, createdAt: new Date() },
        { upsert: true, new: true }
      );
      const otpResult = await sendAdminOtpToEmail(normalizedEmail, 'admin-password-reset', otpValue);
      return res.status(200).json({
        success: true,
        message: otpResult.success ? 'OTP sent to your email.' : 'OTP generated.',
        otp: otpResult.otp
      });
    }

    const otpRecord = await Otp.findOne({ email: normalizedEmail, purpose: 'admin-password-reset' });
    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await Otp.deleteOne({ _id: otpRecord._id });
    user.resetPasswordToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    res.status(200).json({ success: true, message: 'OTP verified.', resetToken: user.resetPasswordToken });
  } catch (error) {
    logger.error('Admin forgot password error:', error);
    res.status(500).json({ success: false, message: 'Error processing request' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Provide email and OTP' });

    const normalizedEmail = email.toLowerCase();
    const otpRecord = await Otp.findOne({ email: normalizedEmail, purpose: 'admin-password-reset' });
    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await Otp.deleteOne({ _id: otpRecord._id });
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });

    user.resetPasswordToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    res.status(200).json({ success: true, message: 'OTP verified successfully', resetToken: user.resetPasswordToken });
  } catch (error) {
    logger.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Error verifying OTP' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const token = req.params?.token
      || req.body?.token
      || req.body?.resetToken
      || req.body?.resetPasswordToken
      || req.query?.token
      || req.query?.resetToken
      || req.query?.resetPasswordToken
      || req.headers['x-reset-token'];
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    const { password, passwordConfirm } = req.body;

    if (!normalizedToken) {
      return res.status(400).json({ success: false, message: 'Reset token is required' });
    }

    if (!password || password !== passwordConfirm) {
      return res.status(400).json({ success: false, message: 'Passwords do not match or missing' });
    }

    const user = await User.findOne({ resetPasswordToken: normalizedToken, resetPasswordExpiry: { $gt: new Date() } });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    user.lastPasswordChangeAt = new Date();
    user.forcePasswordChange = false;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Error resetting password' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    const requiresCurrentPassword = !req.user?.forcePasswordChange;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'New password and confirm password are required' });
    }

    if (requiresCurrentPassword && !currentPassword) {
      return res.status(400).json({ success: false, message: 'Current password is required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New password and confirm password do not match' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long' });
    }

    if (requiresCurrentPassword && !(await user.matchPassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    user.forcePasswordChange = false;
    user.lastPasswordChangeAt = new Date();
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Error updating password' });
  }
};

/**
 * Create Admin/Agent Account
 */
exports.createAdmin = async (req, res) => {
  try {
    const creator = req.user;
    const { firstName, lastName, email, phone, role } = req.body;
    const targetRole = role || 'admin';

    if (targetRole === 'founder') {
      return res.status(403).json({ success: false, message: 'Founder accounts cannot be created via API.' });
    }

    if ((roleHierarchy[targetRole] || 0) >= (roleHierarchy[creator.role] || 0)) {
      return res.status(403).json({ success: false, message: 'Unauthorized hierarchical level.' });
    }

    const normalizedEmail = email.toLowerCase();
    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const tempPassword = generateShortPassword();
    const user = await User.create({
      firstName, lastName, email: normalizedEmail, phone,
      password: tempPassword, role: targetRole, isVerified: true,
      forcePasswordChange: true, createdBy: creator._id
    });

    await sendTemplateEmail(normalizedEmail, emailTemplates.adminAccountCreated(firstName, normalizedEmail, tempPassword, targetRole));
    await Log.create({
      user: creator._id, userRole: creator.role, action: 'user_created',
      resourceType: 'admin', resourceId: user._id, description: `Created ${targetRole}: ${normalizedEmail}`,
      ipAddress: req.ip, userAgent: req.get('user-agent')
    });

    res.status(201).json({ success: true, message: `${targetRole.toUpperCase()} created successfully`, user: { id: user._id, email: user.email, role: user.role } });
  } catch (error) {
    logger.error('Create admin error:', error);
    res.status(500).json({ success: false, message: 'Error creating account' });
  }
};

/**
 * Verify or Reject Hostel Listing
 */
exports.verifyHostel = async (req, res) => {
  try {
    const { hostelId } = req.params;
    const { status, rejectionReason } = req.body;
    const nextStatus = status || 'verified';

    if (!['verified', 'rejected'].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Status must be verified or rejected' });
    }

    const hostel = await Hostel.findById(hostelId).populate('owner');
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });

    if (nextStatus === 'verified') {
      hostel.verificationStatus = {
        status: 'verified',
        verifiedBy: req.user._id,
        verificationDate: new Date()
      };
      hostel.isApproved = true;
      hostel.isPending = false;
      hostel.isLive = true;
      hostel.isVerified = true;
      hostel.isActive = true;
      hostel.activeDate = hostel.activeDate || new Date();
      if (hostel.owner?.email) {
        await sendTemplateEmail(hostel.owner.email, emailTemplates.hostelVerified(hostel.owner.firstName || hostel.owner.email, hostel.name, hostel.hostelCode));
      }
    } else {
      hostel.verificationStatus = {
        status: 'rejected',
        verifiedBy: req.user._id,
        verificationDate: new Date(),
        rejectionReason
      };
      hostel.isPending = false;
      hostel.isApproved = false;
      hostel.isLive = false;
      hostel.isVerified = false;
      hostel.isActive = false;
      if (hostel.owner?.email) {
        await sendTemplateEmail(hostel.owner.email, emailTemplates.hostelRejected(hostel.owner.firstName || hostel.owner.email, hostel.name, rejectionReason || 'No reason provided'));
      }
    }

    await hostel.save();
    await Log.create({
      user: req.user._id,
      userRole: req.user.role,
      action: nextStatus === 'verified' ? 'hostel_verified' : 'hostel_rejected',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: `Hostel ${nextStatus}: ${hostel.name}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(200).json({ success: true, message: `Hostel ${nextStatus} successfully`, hostel });
  } catch (error) {
    logger.error('Verify hostel error:', error);
    res.status(500).json({ success: false, message: 'Error verifying hostel' });
  }
};

exports.rejectHostel = async (req, res) => {
  req.body.status = 'rejected';
  return exports.verifyHostel(req, res);
};

exports.getPendingHostels = async (req, res) => {
  try {
    const hostels = await Hostel.find({ isPending: true }).populate('owner', 'firstName lastName email phone').sort('-createdAt');
    res.status(200).json({ success: true, count: hostels.length, hostels });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching pending hostels' });
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder') return res.status(403).json({ success: false, message: 'Cannot deactivate founder' });

    user.isActive = false;
    await user.save();
    res.status(200).json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deactivating user' });
  }
};

/**
 * Strict User Lookup By Email
 */
exports.lookupUserByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, message: 'Email query parameter is required' });

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail }).select('firstName lastName email role associatedHostels');
    
    if (!user) {
      return res.status(404).json({ success: false, message: `User with email "${cleanEmail}" does not exist in the system.` });
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    logger.error('Error looking up user:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Hostel Account Association & Ownership Assignment with Strict Validation & Error Handling
 */
exports.assignHostelOwner = async (req, res) => {
  let targetIdentifier = null;
  try {
    const { ownerId, studentId, hostelId } = req.body;
    targetIdentifier = ownerId || studentId;

    if (!targetIdentifier || !hostelId) {
      return res.status(400).json({ success: false, message: 'User identifier (email or ID) and hostelId are required' });
    }

    let userQuery = mongoose.Types.ObjectId.isValid(targetIdentifier)
      ? { _id: targetIdentifier }
      : { email: targetIdentifier.trim().toLowerCase() };

    const owner = await User.findOne(userQuery);
    const hostel = await Hostel.findById(hostelId);

    if (!owner) {
      await Log.create({
        user: req.user._id, userRole: req.user.role, userName: `${req.user.firstName} ${req.user.lastName}`, userEmail: req.user.email,
        action: 'user_merged', resourceType: 'hostel', status: 'failed', errorMessage: `User not found: ${targetIdentifier}`,
        description: `Failed association attempt: User not found`, ipAddress: req.ip, userAgent: req.get('user-agent')
      });
      return res.status(404).json({ success: false, message: 'User not found with provided identifier.' });
    }

    if (!hostel) {
      await Log.create({
        user: req.user._id, userRole: req.user.role, userName: `${req.user.firstName} ${req.user.lastName}`, userEmail: req.user.email,
        action: 'user_merged', resourceType: 'hostel', status: 'failed', errorMessage: `Hostel not found: ${hostelId}`,
        description: `Failed association attempt: Hostel not found`, ipAddress: req.ip, userAgent: req.get('user-agent')
      });
      return res.status(404).json({ success: false, message: 'Hostel not found.' });
    }

    // Role restriction validation
    const restrictedRoles = ['agent', 'admin', 'superadmin', 'founder'];
    if (restrictedRoles.includes(owner.role)) {
      const errMsg = `Validation Error: Account with role '${owner.role.toUpperCase()}' cannot be assigned as a hostel owner.`;
      await Log.create({
        user: req.user._id, userRole: req.user.role, userName: `${req.user.firstName} ${req.user.lastName}`, userEmail: req.user.email,
        action: 'user_merged', resourceType: 'hostel', resourceId: hostel._id, resourceName: hostel.name,
        status: 'failed', errorMessage: errMsg, description: errMsg, ipAddress: req.ip, userAgent: req.get('user-agent')
      });
      return res.status(400).json({ success: false, message: errMsg });
    }

    // Ownership conflict validation
    if (hostel.owner) {
      const errMsg = hostel.owner.toString() === owner._id.toString()
        ? `Conflict: Hostel "${hostel.name}" is already attached to this owner account.`
        : `Conflict: Hostel already has an assigned owner. Detach owner first.`;
      
      await Log.create({
        user: req.user._id, userRole: req.user.role, userName: `${req.user.firstName} ${req.user.lastName}`, userEmail: req.user.email,
        action: 'user_merged', resourceType: 'hostel', resourceId: hostel._id, resourceName: hostel.name,
        status: 'failed', errorMessage: errMsg, description: errMsg, ipAddress: req.ip, userAgent: req.get('user-agent')
      });
      return res.status(400).json({ success: false, message: errMsg });
    }

    // Execution
    if (owner.role === 'student') owner.role = 'hostelowner';
    if (!owner.associatedHostels) owner.associatedHostels = [];
    if (!owner.associatedHostels.includes(hostelId)) owner.associatedHostels.push(hostelId);
    await owner.save();

    hostel.owner = owner._id;
    await hostel.save();

    // Successful Log entry storing full snapshot details
    await Log.create({
      user: req.user._id,
      userRole: req.user.role,
      userName: `${req.user.firstName} ${req.user.lastName}`,
      userEmail: req.user.email,
      action: 'user_merged',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      status: 'success',
      description: `Hostel "${hostel.name}" successfully assigned to owner ${owner.email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return res.status(200).json({
      success: true,
      message: 'Hostel successfully associated with owner!',
      data: {
        hostel: { id: hostel._id, name: hostel.name, code: hostel.hostelCode },
        owner: { id: owner._id, email: owner.email, role: owner.role, associatedHostels: owner.associatedHostels }
      }
    });

  } catch (error) {
    logger.error('Error assigning hostel owner:', error);
    return res.status(500).json({ success: false, message: 'Server error while assigning owner: ' + error.message });
  }
};
// Aliased for legacy endpoint references
exports.mergeStudentToHostel = exports.assignHostelOwner;

/**
 * System Logs & Dashboard Stats
 */
exports.getLogs = async (req, res) => {
  try {
    const { action, resourceType, page = 1, limit = 20 } = req.query;
    let query = {};
    if (action) query.action = action;
    if (resourceType) query.resourceType = resourceType;

    const skip = (page - 1) * limit;
    const logs = await Log.find(query).populate('user', 'firstName lastName email role').sort('-createdAt').skip(skip).limit(parseInt(limit));
    const total = await Log.countDocuments(query);

    res.status(200).json({ success: true, count: logs.length, total, pages: Math.ceil(total / limit), currentPage: parseInt(page), logs });
  } catch (error) {
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
    res.status(500).json({ success: false, message: 'Error fetching statistics' });
  }
};

exports.createUserAccount = async (req, res) => {
  try {
    const actor = req.user;
    const { firstName, lastName, email, phone, role, password, hostelCode } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ success: false, message: 'firstName, lastName, email and phone are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const allowedRoles = ['admin', 'superadmin', 'hostelowner'];
    const actorRole = actor.role;

    if (role === 'founder') {
      return res.status(403).json({ success: false, message: 'Founder accounts can only be created via seed script.' });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Role must be admin, superadmin or hostelowner' });
    }

    if (actorRole === 'admin' && role !== 'hostelowner') {
      return res.status(403).json({ success: false, message: 'Admins can only create hostel owner accounts.' });
    }

    if (actorRole === 'superadmin' && !['admin', 'hostelowner'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Superadmins can create admin or hostel owner accounts only.' });
    }

    if (actorRole === 'founder') {
      // allowed to create all account types
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const tempPassword = (password && password.trim()) || generateShortPassword();
    const cleanRole = role;
    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      phone,
      password: tempPassword,
      role: cleanRole,
      isVerified: true,
      isActive: true,
      forcePasswordChange: true,
      createdBy: actor._id
    });

    const roleLabel = cleanRole === 'hostelowner' ? 'Hostel Owner' : cleanRole.charAt(0).toUpperCase() + cleanRole.slice(1);
    const loginUrl = cleanRole === 'hostelowner' ? (process.env.CLIENT_URL || 'http://localhost:3000') : (process.env.ADMIN_CLIENT_URL || `${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/login`);

    await sendTemplateEmail(normalizedEmail, emailTemplates.adminAccountCreated(firstName, normalizedEmail, tempPassword, roleLabel));

    if (cleanRole === 'hostelowner' && hostelCode) {
      const hostel = await Hostel.findOne({ hostelCode: String(hostelCode).trim() });
      if (hostel) {
        if (hostel.owner) {
          return res.status(400).json({ success: false, message: 'This hostel code already belongs to an owner.' });
        }
        hostel.owner = user._id;
        hostel.isPending = false;
        hostel.isApproved = true;
        hostel.isLive = true;
        hostel.verificationStatus = { status: 'verified', verifiedBy: actor._id, verificationDate: new Date() };
        await hostel.save();
        user.associatedHostels = user.associatedHostels || [];
        if (!user.associatedHostels.includes(hostel._id)) {
          user.associatedHostels.push(hostel._id);
        }
        await user.save();
      }
    }

    await Log.create({
      user: actor._id,
      userRole: actor.role,
      action: 'user_created',
      resourceType: 'user',
      resourceId: user._id,
      description: `Created ${cleanRole}: ${normalizedEmail}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json({
      success: true,
      message: `${roleLabel} account created successfully`,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        tempPassword,
        loginUrl
      }
    });
  } catch (error) {
    logger.error('Create user account error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating account' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, active, search } = req.query;
    const query = {};

    if (role) query.role = role;
    if (active !== undefined) query.isActive = active === 'true';
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query).select('-password').sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: users.length, users });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { firstName, lastName, email, phone, role, isActive } = req.body;
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email) user.email = String(email).trim().toLowerCase();
    if (phone) user.phone = phone;
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = Boolean(isActive);

    await user.save();

    res.status(200).json({ success: true, message: 'User updated successfully', user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, role: user.role, isActive: user.isActive } });
  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating user' });
  }
};

exports.uploadHostelImages = [
  hostelImageUpload.array('images', 5),
  async (req, res) => {
    try {
      if (!req.files || !req.files.length) {
        return res.status(400).json({ success: false, message: 'At least one image is required' });
      }

      const uploaded = await uploadMultipleFiles(req.files.map(file => ({ buffer: file.buffer })), 'hostels');
      const imageUrls = uploaded.map(result => ({ url: result.secure_url || result.url }));

      res.status(200).json({ success: true, images: imageUrls, message: 'Images uploaded successfully' });
    } catch (error) {
      logger.error('Upload hostel images error:', error);
      res.status(500).json({ success: false, message: error.message || 'Error uploading hostel images' });
    }
  }
];

exports.createHostel = async (req, res) => {
  try {
    const actor = req.user;
    const payload = req.body;

    if (!payload.name || !payload.type || !payload.description || !payload.location || !payload.phone) {
      return res.status(400).json({ success: false, message: 'name, type, description, location and phone are required' });
    }

    const normalizedType = normalizeHostelType(payload.type);
    if (!normalizedType) {
      return res.status(400).json({ success: false, message: 'Type must be one of BOYS, GIRLS or PG' });
    }

    const ownerId = payload.ownerId || payload.owner || payload.ownerEmail || null;
    let owner = null;
    if (ownerId) {
      owner = await User.findOne({
        $or: [
          { _id: mongoose.Types.ObjectId.isValid(String(ownerId)) ? String(ownerId) : null },
          { email: String(ownerId).trim().toLowerCase() }
        ].filter(Boolean)
      });

      if (!owner) {
        return res.status(400).json({ success: false, message: 'Provide a valid hostel owner user id or email when an owner is supplied' });
      }

      if (!['hostelowner', 'founder'].includes(owner.role) && actor.role !== 'founder') {
        return res.status(400).json({ success: false, message: 'Selected user is not a valid hostel owner.' });
      }
    }

    const hostelCode = payload.hostelCode || `${(process.env.HOSTEL_CODE_PREFIX || 'STH')}${Date.now().toString().slice(-6)}`;
    const existingHostel = await Hostel.findOne({ hostelCode });
    if (existingHostel) {
      return res.status(400).json({ success: false, message: 'Hostel code already exists' });
    }

    const location = payload.location || {};
    const coordinates = Array.isArray(location.coordinates?.coordinates)
      ? location.coordinates.coordinates.map(Number)
      : [0, 0];

    const normalizedRoomTypes = Array.isArray(payload.roomTypes) ? payload.roomTypes.map(item => ({
      roomType: item.roomType || item.name || 'Room',
      price: Number(item.price || 0),
      capacity: Number(item.capacity || 1),
      totalBeds: Number(item.totalBeds || item.capacity || 1),
      bedsAvailable: Number(item.bedsAvailable || item.capacity || 1),
      bedConfigurations: Array.isArray(item.bedConfigurations) ? item.bedConfigurations.map(config => ({
        name: config.name || 'Bed',
        totalBeds: Number(config.totalBeds || 0),
        availableBeds: Number(config.availableBeds || 0)
      })) : []
    })) : [];

    const normalizedFacilities = Array.isArray(payload.facilities) ? payload.facilities.map(item => ({
      title: item.title || item.name || 'Facility',
      isHighlighted: Boolean(item.isHighlighted)
    })) : [];

    const normalizedImages = Array.isArray(payload.images)
      ? payload.images.map(item => typeof item === 'string' ? { url: item } : (item && item.url ? { url: item.url } : item)).filter(Boolean)
      : [];

    const hostel = await Hostel.create({
      name: payload.name,
      owner: owner ? owner._id : null,
      type: normalizedType,
      hostelCode,
      description: payload.description,
      location: {
        addressText: location.addressText || payload.addressText || 'Address not provided',
        googleMapLink: location.googleMapLink || payload.googleMapLink || '',
        coordinates: {
          type: 'Point',
          coordinates
        }
      },
      phone: payload.phone,
      email: payload.email || (owner ? owner.email : undefined),
      whatsappNumber: payload.whatsappNumber || payload.phone,
      roomTypes: normalizedRoomTypes,
      foodMenuDescription: payload.foodMenuDescription || '',
      facilities: normalizedFacilities,
      images: normalizedImages,
      isApproved: Boolean(owner),
      isPending: !owner,
      isVerified: Boolean(owner),
      isLive: Boolean(owner),
      isActive: true,
      verificationStatus: {
        status: owner ? 'verified' : 'pending',
        verifiedBy: owner ? actor._id : undefined,
        verificationDate: owner ? new Date() : undefined
      }
    });

    if (owner) {
      owner.associatedHostels = owner.associatedHostels || [];
      if (!owner.associatedHostels.includes(hostel._id)) owner.associatedHostels.push(hostel._id);
      owner.role = owner.role === 'student' ? 'hostelowner' : owner.role;
      await owner.save();
    }

    await Log.create({
      user: actor._id,
      userRole: actor.role,
      action: 'hostel_created',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: owner ? `Hostel created and linked to owner ${owner.email}` : `Hostel created pending owner validation`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(201).json({
      success: true,
      message: owner ? 'Hostel created successfully' : 'Hostel created successfully without an assigned owner. Contact details are saved for follow-up.',
      hostel
    });
  } catch (error) {
    logger.error('Create hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating hostel' });
  }
};

exports.getHostels = async (req, res) => {
  try {
    const { ownerId, status, verificationStatus, search, rankMin, rankMax, createdAfter, createdBefore, isActive, sortBy = 'createdAt', order = 'desc', type } = req.query;
    const query = {};

    if (ownerId) query.owner = ownerId;
    if (verificationStatus || status) query['verificationStatus.status'] = verificationStatus || status;
    if (type) {
      const normalizedType = normalizeHostelType(type);
      if (normalizedType) query.type = normalizedType;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { hostelCode: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (rankMin !== undefined || rankMax !== undefined) {
      query.rank = {};
      if (rankMin !== undefined) query.rank.$gte = Number(rankMin);
      if (rankMax !== undefined) query.rank.$lte = Number(rankMax);
    }
    if (createdAfter || createdBefore) {
      query.createdAt = {};
      if (createdAfter) query.createdAt.$gte = new Date(createdAfter);
      if (createdBefore) query.createdAt.$lte = new Date(createdBefore);
    }
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const sort = {};
    sort[sortBy] = order === 'asc' ? 1 : -1;

    const hostels = await Hostel.find(query).populate('owner', 'firstName lastName email role phone').sort(sort);
    res.status(200).json({ success: true, count: hostels.length, hostels });
  } catch (error) {
    logger.error('Get hostels error:', error);
    res.status(500).json({ success: false, message: 'Error fetching hostels' });
  }
};

exports.getHostelById = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId).populate('owner', 'firstName lastName email role phone');
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    res.status(200).json({ success: true, hostel });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Error fetching hostel' });
  }
};

exports.updateHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });

    const { isOwner, isAdmin, canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) {
      return res.status(403).json({ success: false, message: 'You cannot edit this hostel' });
    }

    const ownerUpdatable = ['name', 'type', 'description', 'phone', 'email', 'whatsappNumber', 'foodMenuDescription', 'location', 'roomTypes', 'facilities', 'images'];
    const adminOnlyUpdatable = ['hostelCode', 'rank', 'isSponsored', 'isSponsorFeatured', 'sponsorPackage', 'isApproved', 'isVerified', 'isLive', 'isPending', 'verificationStatus', 'isActive', 'expiryDate', 'activeDate'];
    const before = hostel.toObject();
    const changedFields = [];

    for (const field of ownerUpdatable) {
      if (req.body[field] !== undefined) {
        if (field === 'type') {
          const normalizedType = normalizeHostelType(req.body[field]);
          if (!normalizedType) {
            return res.status(400).json({ success: false, message: 'Type must be one of BOYS, GIRLS or PG' });
          }
          hostel[field] = normalizedType;
        } else {
          hostel[field] = req.body[field];
        }
        changedFields.push(field);
      }
    }

    for (const field of adminOnlyUpdatable) {
      if (req.body[field] !== undefined) {
        if (!isAdmin) {
          return res.status(403).json({ success: false, message: `Only admins can change ${field}` });
        }
        hostel[field] = req.body[field];
        changedFields.push(field);
      }
    }

    if (req.body.ownerId !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: 'Only admins can change hostel ownership' });
      }
      const owner = await User.findById(req.body.ownerId);
      if (!owner) return res.status(400).json({ success: false, message: 'Owner not found' });
      hostel.owner = owner._id;
      changedFields.push('owner');
    }

    if (req.body.rank !== undefined && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can change hostel rank' });
    }

    if (req.body.isSponsored !== undefined && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can change sponsorship status' });
    }

    if (req.body.verificationStatus !== undefined && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can change verification status' });
    }

    if (req.body.expiryDate !== undefined && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can change expiry date' });
    }

    await hostel.save();
    await Log.create({
      user: req.user._id,
      userRole: req.user.role,
      action: 'hostel_updated',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      changes: { before, after: hostel.toObject(), fieldsChanged: changedFields },
      description: `Hostel updated by ${req.user.role}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });
    res.status(200).json({ success: true, message: 'Hostel updated successfully', hostel });
  } catch (error) {
    logger.error('Update hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating hostel' });
  }
};

exports.deleteHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!['superadmin', 'founder'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only superadmins and founders can delete hostels' });
    }
    await hostel.deleteOne();
    await Log.create({
      user: req.user._id,
      userRole: req.user.role,
      action: 'hostel_deleted',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: `Hostel deleted by ${req.user.role}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });
    res.status(200).json({ success: true, message: 'Hostel deleted successfully' });
  } catch (error) {
    logger.error('Delete hostel error:', error);
    res.status(500).json({ success: false, message: 'Error deleting hostel' });
  }
};

exports.updateHostelSeats = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { isOwner, isAdmin, canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot update seats for this hostel' });

    const { roomTypeIndex, bedsAvailable, bedConfigurationIndex, availableBeds } = req.body;
    if (roomTypeIndex === undefined || bedsAvailable === undefined) {
      return res.status(400).json({ success: false, message: 'roomTypeIndex and bedsAvailable are required' });
    }
    const room = hostel.roomTypes[roomTypeIndex];
    if (!room) return res.status(404).json({ success: false, message: 'Room type not found' });

    const totalBeds = Number(room.totalBeds || room.capacity || 0);
    const nextAvailable = Number(bedsAvailable);
    if (nextAvailable < 0 || (totalBeds && nextAvailable > totalBeds)) {
      return res.status(400).json({ success: false, message: 'Cannot have more available beds than total beds' });
    }

    room.bedsAvailable = nextAvailable;
    if (bedConfigurationIndex !== undefined && room.bedConfigurations?.[bedConfigurationIndex]) {
      room.bedConfigurations[bedConfigurationIndex].availableBeds = Number(availableBeds ?? nextAvailable);
    }

    await hostel.save();
    res.status(200).json({ success: true, message: 'Seat availability updated', hostel });
  } catch (error) {
    logger.error('Update hostel seats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating seat availability' });
  }
};

exports.createReview = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { rating, reviewText } = req.body;
    if (!rating) return res.status(400).json({ success: false, message: 'rating is required' });

    const existing = await Review.findOne({ hostel: hostel._id, user: req.user._id });
    if (existing) {
      return res.status(400).json({ success: false, message: "You've already reviewed this hostel." });
    }

    const review = await Review.create({ hostel: hostel._id, user: req.user._id, rating: Number(rating), reviewText: reviewText || '' });
    const reviews = await Review.find({ hostel: hostel._id });
    const total = reviews.reduce((sum, item) => sum + item.rating, 0);
    const average = Number((total / reviews.length).toFixed(1));
    hostel.ratings = { average, total, count: reviews.length };
    hostel.averageRating = average;
    hostel.ratingCount = reviews.length;
    await hostel.save();

    await Log.create({
      user: req.user._id,
      userRole: req.user.role,
      action: 'rating_created',
      resourceType: 'rating',
      resourceId: review._id,
      resourceName: hostel.name,
      description: `Review added for ${hostel.name}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(201).json({ success: true, message: 'Review added successfully', review, hostel });
  } catch (error) {
    logger.error('Create review error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating review' });
  }
};

exports.getHostelReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const reviews = await Review.find({ hostel: req.params.hostelId }).populate('user', 'firstName lastName email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    const total = await Review.countDocuments({ hostel: req.params.hostelId });
    res.status(200).json({ success: true, page: Number(page), limit: Number(limit), total, reviews });
  } catch (error) {
    logger.error('Get hostel reviews error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching reviews' });
  }
};

exports.mergeHostels = async (req, res) => {
  try {
    const { sourceHostelId, targetHostelId } = req.body;
    if (!['superadmin', 'founder'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only superadmins and founders can merge hostels' });
    }
    if (!sourceHostelId || !targetHostelId) {
      return res.status(400).json({ success: false, message: 'sourceHostelId and targetHostelId are required' });
    }
    const [source, target] = await Promise.all([Hostel.findById(sourceHostelId), Hostel.findById(targetHostelId)]);
    if (!source || !target) return res.status(404).json({ success: false, message: 'One or both hostels were not found' });

    const bookingUpdate = await Booking.updateMany({ hostel: source._id }, { hostel: target._id });
    const reviewUpdate = await Review.updateMany({ hostel: source._id }, { hostel: target._id });

    if (source.owner) {
      const owner = await User.findById(source.owner);
      if (owner) {
        owner.associatedHostels = (owner.associatedHostels || []).filter((id) => id.toString() !== source._id.toString());
        await owner.save();
      }
    }

    await source.deleteOne();
    await Log.create({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_merged',
      resourceType: 'hostel',
      resourceId: target._id,
      resourceName: target.name,
      description: `Merged hostel ${source.name} into ${target.name}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(200).json({ success: true, message: 'Hostels merged successfully', stats: { bookingsTransferred: bookingUpdate.modifiedCount, reviewsTransferred: reviewUpdate.modifiedCount } });
  } catch (error) {
    logger.error('Merge hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error merging hostels' });
  }
};

exports.getHostelBookings = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { isOwner, isAdmin, canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot view bookings for this hostel' });

    const { status, page = 1, limit = 20 } = req.query;
    const query = { hostel: hostel._id };
    if (status) query.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const bookings = await Booking.find(query).populate('student', 'firstName lastName email phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    const total = await Booking.countDocuments(query);
    res.status(200).json({ success: true, page: Number(page), limit: Number(limit), total, count: bookings.length, bookings });
  } catch (error) {
    logger.error('Get hostel bookings error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching bookings' });
  }
};

exports.getHostelBookingStats = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { isOwner, isAdmin, canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot view booking stats for this hostel' });

    const statuses = ['pending', 'confirmed', 'cancelled', 'completed'];
    const stats = {};
    await Promise.all(statuses.map(async (item) => {
      stats[item] = await Booking.countDocuments({ hostel: hostel._id, status: item });
    }));
    res.status(200).json({ success: true, hostelId: hostel._id, stats });
  } catch (error) {
    logger.error('Get hostel booking stats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching booking stats' });
  }
};

exports.activateHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can activate hostels' });
    hostel.isActive = true;
    hostel.activeDate = new Date();
    hostel.isLive = true;
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel activated successfully', hostel });
  } catch (error) {
    logger.error('Activate hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error activating hostel' });
  }
};

exports.deactivateHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can deactivate hostels' });
    hostel.isActive = false;
    hostel.isLive = false;
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel deactivated successfully', hostel });
  } catch (error) {
    logger.error('Deactivate hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deactivating hostel' });
  }
};

exports.setHostelExpiry = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can set hostel expiry' });
    const { expiryDate } = req.body;
    if (!expiryDate) return res.status(400).json({ success: false, message: 'expiryDate is required' });
    hostel.expiryDate = new Date(expiryDate);
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel expiry date updated', hostel });
  } catch (error) {
    logger.error('Set hostel expiry error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error setting expiry date' });
  }
};

exports.changeHostelOwner = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can change hostel ownership' });
    const { newOwnerId } = req.body;
    if (!newOwnerId) return res.status(400).json({ success: false, message: 'newOwnerId is required' });

    const newOwner = await User.findById(newOwnerId);
    if (!newOwner) return res.status(404).json({ success: false, message: 'New owner not found' });
    if (['agent', 'admin', 'superadmin', 'founder'].includes(newOwner.role)) {
      return res.status(400).json({ success: false, message: 'Selected user cannot be assigned as hostel owner' });
    }

    if (hostel.owner) {
      const previousOwner = await User.findById(hostel.owner);
      if (previousOwner) {
        previousOwner.associatedHostels = (previousOwner.associatedHostels || []).filter((id) => id.toString() !== hostel._id.toString());
        await previousOwner.save();
      }
    }

    newOwner.associatedHostels = newOwner.associatedHostels || [];
    if (!newOwner.associatedHostels.includes(hostel._id)) newOwner.associatedHostels.push(hostel._id);
    newOwner.role = newOwner.role === 'student' ? 'hostelowner' : newOwner.role;
    await newOwner.save();

    hostel.owner = newOwner._id;
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel owner changed successfully', hostel });
  } catch (error) {
    logger.error('Change hostel owner error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error changing ownership' });
  }
};

exports.associateHostelToUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { hostelId } = req.body;
    if (!hostelId) return res.status(400).json({ success: false, message: 'hostelId is required' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can associate hostels' });

    const hostel = await Hostel.findById(hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (hostel.owner) return res.status(400).json({ success: false, message: 'This hostel already has an owner' });
    if (['agent', 'admin', 'superadmin', 'founder'].includes(user.role)) return res.status(400).json({ success: false, message: 'Selected user cannot be assigned as hostel owner' });

    user.associatedHostels = user.associatedHostels || [];
    if (!user.associatedHostels.includes(hostel._id)) user.associatedHostels.push(hostel._id);
    user.role = user.role === 'student' ? 'hostelowner' : user.role;
    await user.save();

    hostel.owner = user._id;
    hostel.isPending = false;
    hostel.isApproved = true;
    hostel.isLive = true;
    hostel.isVerified = true;
    hostel.isActive = true;
    hostel.verificationStatus = { status: 'verified', verifiedBy: req.user._id, verificationDate: new Date() };
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel associated with owner successfully', hostel, user });
  } catch (error) {
    logger.error('Associate hostel to user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error associating hostel' });
  }
};

exports.getUserHostels = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const hostels = await Hostel.find({ owner: user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: hostels.length, hostels });
  } catch (error) {
    logger.error('Get user hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching user hostels' });
  }
};

exports.bulkUpdateHostels = async (req, res) => {
  try {
    const { hostelIds, updates } = req.body;
    if (!Array.isArray(hostelIds) || !hostelIds.length) return res.status(400).json({ success: false, message: 'hostelIds array is required' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can bulk update hostels' });

    const allowedFields = ['rank', 'isActive', 'isSponsored', 'isSponsorFeatured', 'sponsorPackage', 'isApproved', 'isPending', 'isVerified', 'isLive', 'expiryDate', 'verificationStatus'];
    const payload = {};
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (allowedFields.includes(key)) payload[key] = value;
    });

    const result = await Hostel.updateMany({ _id: { $in: hostelIds } }, { $set: payload });
    res.status(200).json({ success: true, message: 'Bulk update completed', updatedCount: result.modifiedCount });
  } catch (error) {
    logger.error('Bulk update hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error bulk updating hostels' });
  }
};

exports.validateUserHostelLink = async (req, res) => {
  try {
    const { hostelId, ownerId, email, phone } = req.body;

    if (!hostelId || (!ownerId && !email && !phone)) {
      return res.status(400).json({ success: false, message: 'hostelId and either ownerId, email, or phone are required' });
    }

    const hostel = await Hostel.findById(hostelId).populate('owner', 'firstName lastName email phone role');
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });

    let user = null;
    if (ownerId) {
      user = await User.findById(ownerId);
    } else if (email) {
      user = await User.findOne({ email: String(email).trim().toLowerCase() });
    } else if (phone) {
      user = await User.findOne({ phone: String(phone).trim() });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found for the provided email/phone/id', hostel: { id: hostel._id, name: hostel.name, hostelCode: hostel.hostelCode, location: hostel.location } });
    }

    const isValidOwnerCandidate = ['student', 'hostelowner'].includes(user.role) || user.role === 'founder';
    if (!isValidOwnerCandidate) {
      return res.status(400).json({ success: false, message: 'This user role cannot be assigned as hostel owner', user: { id: user._id, name: `${user.firstName} ${user.lastName}`, email: user.email, phone: user.phone, role: user.role } });
    }

    const alreadyOwned = hostel.owner && hostel.owner.toString() === user._id.toString();
    if (hostel.owner && !alreadyOwned) {
      return res.status(400).json({ success: false, message: 'This hostel already has an assigned owner', hostel: { id: hostel._id, name: hostel.name, hostelCode: hostel.hostelCode, owner: hostel.owner.name || hostel.owner.email || 'assigned' }, user: { id: user._id, name: `${user.firstName} ${user.lastName}`, email: user.email, phone: user.phone, role: user.role } });
    }

    res.status(200).json({
      success: true,
      message: 'Validation successful. This user can be merged as owner of the hostel.',
      hostel: {
        id: hostel._id,
        name: hostel.name,
        hostelCode: hostel.hostelCode,
        location: hostel.location,
        ownerCurrent: hostel.owner ? { id: hostel.owner._id, name: `${hostel.owner.firstName} ${hostel.owner.lastName}`, email: hostel.owner.email, phone: hostel.owner.phone } : null
      },
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        displayName: `${user.firstName} ${user.lastName}`
      }
    });
  } catch (error) {
    logger.error('Validate user hostel link error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error validating ownership link' });
  }
};