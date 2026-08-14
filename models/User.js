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
  studentInfo: {
    institution: String,
    educationLevel: String
  },
  // Token fields (OTPs are now handled via the Otp model collection)
  resetPasswordToken: String,
  resetPasswordExpiry: Date,
  lastPasswordChangeAt: Date,
  forcePasswordChange: Boolean,
  activeSessionToken: { type: String, default: null },
  lastLogin: Date,
  loginCount: Number,
  ipAddress: String
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
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
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
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

userSchema.methods.getSessionTokenHash = function (token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
};

module.exports = mongoose.model('User', userSchema);