const User = require('../models/User');
const Hostel = require('../models/Hostel');
const logger = require('../config/logger');
const { createAuditLog, canDeactivateUser, canActivateUser, canDeleteUser } = require('../utils/adminHelpers');
const { sendTemplateEmail } = require('../utils/emailService');
const emailTemplates = require('../utils/emailTemplates');

const generateShortPassword = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  result += Math.floor(10 + Math.random() * 90);
  return result;
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
      isActive: false,
      forcePasswordChange: true,
      createdBy: actor._id
    });

    const roleLabel = role === 'hostelowner' ? 'Hostel Owner' : role.charAt(0).toUpperCase() + role.slice(1);
    await sendTemplateEmail(normalizedEmail, emailTemplates.adminAccountCreated(firstName, normalizedEmail, tempPassword, roleLabel));

    if (role === 'hostelowner' && hostelCode) {
      const hostel = await Hostel.findOne({ hostelCode: String(hostelCode).trim() });
      if (hostel) {
        if (hostel.owner) {
          return res.status(400).json({ success: false, message: 'This hostel code already belongs to an owner.' });
        }
        hostel.owner = user._id;
        hostel.isApproved = true;
        hostel.isLive = true;
        hostel.isVerified = true;
        hostel.verificationStatus = { status: 'verified', verifiedBy: actor._id, verificationDate: new Date() };
        await hostel.save();
        user.associatedHostels = user.associatedHostels || [];
        if (!user.associatedHostels.includes(hostel._id)) {
          user.associatedHostels.push(hostel._id);
        }
        await user.save();
        await sendTemplateEmail(user.email, emailTemplates.hostelOwnerMerged(user.firstName, user.email, hostel.name, hostel.hostelCode));
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

    res.status(201).json({ success: true, message: `${roleLabel} account created successfully`, user: { id: user._id, email: user.email, role: user.role } });
  } catch (error) {
    logger.error('Create user account error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating account' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, active, verified, provider, search } = req.query;
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const query = {};

    if (role) query.role = role;
    if (active !== undefined) query.isActive = active === 'true';
    if (verified !== undefined) query.isVerified = verified === 'true';
    if (provider) query.authProvider = provider;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query).select('firstName lastName email phone role isVerified isActive associatedHostels studentInfo hostelOwnerInfo emailNotificationsEnabled authProvider profilePicture lastPasswordChangeAt lastLogin forcePasswordChange tokenVersion loginCount createdAt updatedAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(query)
    ]);
    res.status(200).json({ success: true, count: users.length, total, users, pagination: { page, limit, pages: Math.ceil(total / limit) } });
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

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('firstName lastName email phone role isVerified isActive associatedHostels savedHostels studentInfo hostelOwnerInfo emailNotificationsEnabled authProvider googleId profilePicture lastPasswordChangeAt lastLogin forcePasswordChange tokenVersion loginCount createdAt updatedAt')
      .populate('associatedHostels', 'name hostelCode type');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Error fetching user' });
  }
};

exports.updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const allowedFields = ['firstName', 'lastName', 'phone', 'emailNotificationsEnabled', 'studentInfo', 'hostelOwnerInfo', 'profilePicture'];
    const before = {};
    const fieldsChanged = [];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        before[field] = user[field];
        user[field] = req.body[field];
        fieldsChanged.push(field);
      }
    }
    if (req.body.email !== undefined) {
      before.email = user.email;
      user.email = String(req.body.email).trim().toLowerCase();
      fieldsChanged.push('email');
    }
    if (!fieldsChanged.length) return res.status(400).json({ success: false, message: 'No editable fields supplied' });
    await user.save();
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'user_updated', resourceType: 'user', resourceId: user._id, description: `Updated user ${user.email}`, changes: { before, after: Object.fromEntries(fieldsChanged.map((field) => [field, user[field]])), fieldsChanged }, ipAddress: req.ip, userAgent: req.get('user-agent') });
    res.json({ success: true, message: 'User updated successfully', data: user.toJSON() });
  } catch (error) {
    logger.error('Update user profile error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating user' });
  }
};

exports.changeUserRole = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    const targetRole = req.body.role;
    const hierarchy = { student: 1, hostelowner: 2, agent: 3, admin: 4, superadmin: 5, founder: 6 };
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!Object.prototype.hasOwnProperty.call(hierarchy, targetRole)) return res.status(400).json({ success: false, message: 'Invalid user role' });
    if (user.role === 'founder' || targetRole === 'founder') return res.status(403).json({ success: false, message: 'Founder role cannot be changed through this endpoint' });
    if ((hierarchy[targetRole] || 0) >= (hierarchy[req.user.role] || 0)) return res.status(403).json({ success: false, message: 'You cannot assign a role at or above your own level' });
    const before = user.role;
    user.role = targetRole;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.activeSessionToken = null;
    await user.save();
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'user_role_changed', resourceType: 'user', resourceId: user._id, description: `Changed role from ${before} to ${targetRole}`, changes: { before: { role: before }, after: { role: targetRole } }, ipAddress: req.ip, userAgent: req.get('user-agent') });
    res.json({ success: true, message: 'User role changed successfully', data: { id: user._id, role: user.role } });
  } catch (error) { res.status(500).json({ success: false, message: 'Error changing user role' }); }
};

exports.setUserActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder') return res.status(403).json({ success: false, message: 'Cannot change founder account status' });
    const isActive = req.body.isActive;
    if (typeof isActive !== 'boolean') return res.status(400).json({ success: false, message: 'isActive must be boolean' });
    user.isActive = isActive;
    if (!isActive) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.activeSessionToken = null;
    }
    await user.save();
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: isActive ? 'user_activated' : 'user_deactivated', resourceType: 'user', resourceId: user._id, description: `${isActive ? 'Activated' : 'Deactivated'} user ${user.email}`, ipAddress: req.ip, userAgent: req.get('user-agent') });
    res.json({ success: true, message: `User ${isActive ? 'activated' : 'deactivated'} successfully`, data: { id: user._id, isActive: user.isActive } });
  } catch (error) { res.status(500).json({ success: false, message: 'Error changing user status' }); }
};

exports.forcePasswordReset = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder' && req.user.role !== 'founder') return res.status(403).json({ success: false, message: 'Only founder can reset founder access' });
    user.forcePasswordChange = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.activeSessionToken = null;
    await user.save();
    await createAuditLog({ user: req.user._id, userRole: req.user.role, action: 'user_force_password_reset', resourceType: 'user', resourceId: user._id, description: `Forced password reset for ${user.email}`, ipAddress: req.ip, userAgent: req.get('user-agent') });
    res.json({ success: true, message: 'Password reset required on next login' });
  } catch (error) { res.status(500).json({ success: false, message: 'Error forcing password reset' }); }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder') return res.status(403).json({ success: false, message: 'Cannot delete founder account' });

    if (!canDeleteUser(req.user.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this account'
      });
    }

    const ownedHostels = await Hostel.find({ owner: user._id }).select('_id name hostelCode');
    const confirm = String(req.query.confirm).toLowerCase() === 'true';

    if (ownedHostels.length && !confirm) {
      return res.status(409).json({
        success: false,
        message: `This user owns ${ownedHostels.length} hostel(s). Confirm deletion with ?confirm=true to unlink these hostels and delete the user.`,
        linkedHostels: ownedHostels.map((hostel) => ({
          id: hostel._id,
          name: hostel.name,
          hostelCode: hostel.hostelCode
        }))
      });
    }

    if (ownedHostels.length && confirm) {
      await Hostel.updateMany(
        { owner: user._id },
        {
          $set: {
            owner: null,
            isApproved: true,
            isLive: true,
            isVerified: false,
            verificationStatus: { status: 'pending', verifiedBy: null, verificationDate: null }
          }
        }
      );
    }

    const deletedEmail = user.email;
    await User.deleteOne({ _id: user._id });

    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_deleted',
      resourceType: 'user',
      resourceId: user._id,
      description: `Deleted user ${deletedEmail}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting user' });
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder') return res.status(403).json({ success: false, message: 'Cannot deactivate founder' });

    if (!canDeactivateUser(req.user.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to deactivate this account'
      });
    }

    user.isActive = false;
    user.isVerified = false;
    user.forcePasswordChange = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.activeSessionToken = null;
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
    logger.error('Deactivate user error:', error);
    res.status(500).json({ success: false, message: 'Error deactivating user' });
  }
};

exports.activateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'founder') return res.status(403).json({ success: false, message: 'Cannot activate founder' });

    if (!canActivateUser(req.user.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to activate this account'
      });
    }

    user.isActive = true;
    user.isVerified = true;
    user.forcePasswordChange = false;
    await user.save();

    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_activated',
      resourceType: 'user',
      resourceId: user._id,
      description: `Activated user ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(200).json({ success: true, message: 'User activated successfully' });
  } catch (error) {
    logger.error('Activate user error:', error);
    res.status(500).json({ success: false, message: 'Error activating user' });
  }
};
