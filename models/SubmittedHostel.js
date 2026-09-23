const mongoose = require('mongoose');

const submittedHostelSchema = new mongoose.Schema({
  hostelName: { type: String, required: true, minlength: 5, maxlength: 100, trim: true },
  address: { type: String, required: true, minlength: 5, maxlength: 300, trim: true },
  mapLink: { type: String, required: true, maxlength: 2048, trim: true },
  whatsapp: { type: String, required: true, maxlength: 16, trim: true },
  listerEmail: { type: String, required: true, lowercase: true, trim: true },
  type: { type: String, enum: ['boys', 'girls', 'pg'] }
}, { timestamps: true, collection: 'submitted-hostels' });

submittedHostelSchema.index({ createdAt: -1 });
submittedHostelSchema.index({ type: 1, listerEmail: 1 });

module.exports = mongoose.model('SubmittedHostel', submittedHostelSchema);