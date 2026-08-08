const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  hostel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  reviewText: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'reviews'
});

reviewSchema.index({ hostel: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
