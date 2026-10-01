const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true },
  password: { type: String, required: true, select: false },
  role: { 
    type: String, 
    enum: ['student', 'hostelowner', 'agent', 'admin', 'superadmin', 'founder'], 
    default: 'student' 
  },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  associatedHostels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' }],
  savedHostels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' }],
  studentInfo: {
    institution: String,
    educationLevel: String
  },
  hostelOwnerInfo: { businessName: String },
  emailNotificationsEnabled: { type: Boolean, default: true },
  authProvider: { type: String, enum: ['email', 'google'], default: 'email' },
  googleId: String,
  profilePicture: String,
  // Token fields (OTPs are now handled via the Otp model collection)
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpiry: { type: Date, select: false },
  lastPasswordChangeAt: Date,
  forcePasswordChange: Boolean,
  remarks: { type: String, trim: true, maxlength: 1000, default: '' },
  activeSessionToken: { type: String, default: null },
  activeSessionTokens: { type: [String], default: [] },
  lastLogin: Date,
  loginCount: Number,
  ipAddress: String,
  tokenVersion: { type: Number, default: 0 }
}, { 
  timestamps: true,
  collection: 'users' 
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  try {
    if (typeof this.$locals.progress === 'function') {
      this.$locals.progress({ step: 'password-hashing', percentage: 80, message: 'Hashing Password' });
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    if (typeof this.$locals.progress === 'function') {
      this.$locals.progress({ step: 'database-save', percentage: 90, message: 'Saving User' });
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Match password method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// JWT Token generator
userSchema.methods.getSignedJwtToken = function () {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id: this._id, role: this.role, tokenVersion: this.tokenVersion || 0 }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

userSchema.methods.getSessionTokenHash = function (token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
};

userSchema.methods.addSessionToken = function (token) {
  const tokens = this.activeSessionTokens || [];
  const legacyToken = this.activeSessionToken;
  const tokenHash = this.getSessionTokenHash(token);
  this.activeSessionTokens = [...new Set([...tokens, ...(legacyToken ? [legacyToken] : []), tokenHash])].slice(-2);
  this.activeSessionToken = null;
};

module.exports = mongoose.model('User', userSchema);