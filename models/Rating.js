const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema({
  hostel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },

  overallRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },

  categoryRatings: {
    cleanliness: { type: Number, min: 1, max: 5 },
    amenities: { type: Number, min: 1, max: 5 },
    staff: { type: Number, min: 1, max: 5 },
    location: { type: Number, min: 1, max: 5 },
    value: { type: Number, min: 1, max: 5 },
    safety: { type: Number, min: 1, max: 5 }
  },

  title: String,
  review: {
    type: String,
    maxlength: 2000
  },

  images: [String],
  videos: [String],

  stayDuration: String,
  roomType: String,
  visitType: {
    type: String,
    enum: ['solo', 'family', 'friends', 'group']
  },

  isVerified: {
    type: Boolean,
    default: false
  },
  isPublished: {
    type: Boolean,
    default: true
  },

  helpfulCount: {
    type: Number,
    default: 0
  },
  unhelpfulCount: {
    type: Number,
    default: 0
  },

  ownerResponse: {
    message: String,
    respondedAt: Date
  }
}, {
  timestamps: true,
  collection: 'ratings'
});

module.exports = mongoose.model('Rating', RatingSchema);
