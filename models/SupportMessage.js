const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
  name: { type: String, required: true, minlength: 2, maxlength: 100, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  topic: { type: String, required: true, minlength: 3, maxlength: 120, trim: true },
  message: { type: String, required: true, minlength: 10, maxlength: 5000, trim: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['new', 'in-progress', 'resolved'], default: 'new' }
}, { timestamps: true, collection: 'support' });

supportMessageSchema.index({ status: 1, createdAt: -1 });
supportMessageSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);