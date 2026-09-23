const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
  appName: { type: String, enum: ['stayinhostel-app', 'stayinhostel-landing'] },
  authState: { type: String, enum: ['anonymous', 'authenticated'] },
  authTokenPresent: Boolean,
  deviceType: { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'] },
  event: String,
  eventType: String,
  identifier: { type: String, required: true },
  locationType: { type: String, required: true },
  message: { type: String, maxlength: 500 },
  operatingSystem: String,
  platform: String,
  userAgent: String,
  pagePath: String,
  pageTitle: String,
  pageUrl: String,
  path: { type: String, required: true },
  screen: { width: Number, height: Number, pixelRatio: Number },
  viewport: { width: Number, height: Number, pixelRatio: Number },
  sessionId: String,
  eventTimestamp: Date,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  hourBucket: { type: Date, required: true },
  visitKey: { type: String, required: true, unique: true }
}, { timestamps: true, collection: 'visits' });

visitSchema.index({ hourBucket: -1 });
visitSchema.index({ eventTimestamp: -1 });
visitSchema.index({ appName: 1, deviceType: 1, hourBucket: -1 });

module.exports = mongoose.model('Visit', visitSchema);