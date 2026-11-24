const mongoose = require('mongoose');

const dailyApiStatsSchema = new mongoose.Schema({
  date: { type: String, required: true },
  service: { type: String, enum: ['public', 'admin'], default: 'admin' },
  totalRequests: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 }
}, { timestamps: true, collection: 'dailyapistats' });

dailyApiStatsSchema.index({ date: 1, service: 1 }, { unique: true });

module.exports = mongoose.model('DailyApiStats', dailyApiStatsSchema);
