const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  otp: { type: String, required: true },
  purpose: {
    type: String,
    required: true,
    enum: ['registration', 'password-reset', 'admin-password-reset']
  },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  password: { type: String },
  role: { type: String, enum: ['student', 'hostelowner', 'agent', 'admin', 'superadmin', 'founder'], default: 'student' },
  studentInfo: {
    institution: String,
    educationLevel: String
  },
  createdAt: { type: Date, default: Date.now, expires: 600 }
}, {
  collection: 'otps'
});

module.exports = mongoose.model('Otp', otpSchema);