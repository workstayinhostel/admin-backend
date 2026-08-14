const crypto = require('crypto');
const User = require('../models/User');
const Otp = require('../models/Otp');
const Log = require('../models/Log');
const { sendEmail, sendTemplateEmail } = require('../utils/emailService');
const emailTemplates = require('../utils/emailTemplates');
const logger = require('../config/logger');
const { roleHierarchy, createAuditLog } = require('../utils/adminHelpers');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateShortPassword = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  result += Math.floor(10 + Math.random() * 90);
  return result;
};

const sendAdminOtpToEmail = async (email, purpose, otp) => {
  const template = emailTemplates.adminOtpEmail(email, otp, purpose);

  try {
    const result = await sendTemplateEmail(email, template);
    return { success: true, otp, ...result };
  } catch (error) {
    logger.warn(`Admin OTP email could not be delivered to ${email}: ${error.message}`);
    return { success: false, otp };
  }
};

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
      return res.status(403).json({ success: false, message: 'Access denied. Students and hostel owners must log in via the public website.' });
    }

    if (!user.isActive && !user.forcePasswordChange) {
      const message = user.isVerified
        ? 'Account is deactivated. Please contact a higher role for reactivation.'
        : 'Account is not verified. Please contact a higher role for verification.';
      return res.status(401).json({ success: false, message });
    }

    const token = user.getSignedJwtToken();
    user.activeSessionToken = user.getSessionTokenHash(token);
    user.lastLogin = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    user.ipAddress = req.ip;
    await user.save();

    await createAuditLog({
      user: user._id,
      userRole: user.role,
      action: 'admin_login',
      resourceType: 'user',
      resourceId: user._id,
      description: `Admin portal login: ${email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

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

    if (!user.isVerified || (!user.isActive && !user.forcePasswordChange)) {
      return res.status(401).json({ success: false, message: 'User not verified. Please contact the above role.' });
    }

    if (!otp) {
      const otpValue = generateOtp();
      await Otp.findOneAndUpdate(
        { email: normalizedEmail, purpose: 'admin-password-reset' },
        { otp: otpValue, createdAt: new Date() },
        { upsert: true, new: true }
      );
      const otpResult = await sendAdminOtpToEmail(normalizedEmail, 'admin-password-reset', otpValue);
      return res.status(200).json({ success: true, message: otpResult.success ? 'OTP sent to your email.' : 'OTP generated.', otp: otpResult.otp });
    }

    const otpRecord = await Otp.findOne({ email: normalizedEmail, purpose: 'admin-password-reset' });
    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (!user.isVerified || (!user.isActive && !user.forcePasswordChange)) {
      return res.status(401).json({ success: false, message: 'User not verified. Please contact the above role.' });
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

    if (!user.isVerified || (!user.isActive && !user.forcePasswordChange)) {
      return res.status(401).json({ success: false, message: 'User not verified. Please contact the above role.' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    user.lastPasswordChangeAt = new Date();
    user.forcePasswordChange = false;
    user.isActive = true;
    user.isVerified = true;
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
    user.isActive = true;
    user.isVerified = true;
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
      isActive: false,
      forcePasswordChange: true, createdBy: creator._id
    });

    await sendTemplateEmail(normalizedEmail, emailTemplates.adminAccountCreated(firstName, normalizedEmail, tempPassword, targetRole));
    await createAuditLog({
      user: creator._id,
      userRole: creator.role,
      action: 'user_created',
      resourceType: 'admin',
      resourceId: user._id,
      description: `Created ${targetRole}: ${normalizedEmail}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json({ success: true, message: `${targetRole.toUpperCase()} created successfully`, user: { id: user._id, email: user.email, role: user.role } });
  } catch (error) {
    logger.error('Create admin error:', error);
    res.status(500).json({ success: false, message: 'Error creating account' });
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

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const tempPassword = (password && password.trim()) || generateShortPassword();
    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      phone,
      password: tempPassword,
      role,
      isVerified: true,
      isActive: true,
      forcePasswordChange: true,
      createdBy: actor._id
    });

    const roleLabel = role === 'hostelowner' ? 'Hostel Owner' : role.charAt(0).toUpperCase() + role.slice(1);
    await sendTemplateEmail(normalizedEmail, emailTemplates.adminAccountCreated(firstName, normalizedEmail, tempPassword, roleLabel));

    if (role === 'hostelowner' && hostelCode) {
      const hostel = await require('../models/Hostel').findOne({ hostelCode: String(hostelCode).trim() });
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

    await createAuditLog({
      user: actor._id,
      userRole: actor.role,
      action: 'user_created',
      resourceType: 'user',
      resourceId: user._id,
      description: `Created ${role}: ${normalizedEmail}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json({ success: true, message: `${roleLabel} account created successfully`, user: { id: user._id, email: user.email, role: user.role, tempPassword } });
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
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_updated',
      resourceType: 'user',
      resourceId: user._id,
      description: `Updated user ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(200).json({ success: true, message: 'User updated successfully', user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, role: user.role, isActive: user.isActive } });
  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating user' });
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder') return res.status(403).json({ success: false, message: 'Cannot deactivate founder' });

    user.isActive = false;
    await user.save();
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_deactivated',
      resourceType: 'user',
      resourceId: user._id,
      description: `Deactivated user ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(200).json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deactivating user' });
  }
};
