const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true }
}, { timestamps: true, collection: 'subscribed' });

subscriberSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Subscriber', subscriberSchema);