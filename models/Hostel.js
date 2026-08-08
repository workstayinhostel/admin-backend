const mongoose = require('mongoose');

const hostelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: ['boys', 'girls', 'pg'], required: true },
  hostelCode: { type: String, unique: true, immutable: true },
  description: { type: String, required: true },

  location: {
    addressText: { type: String, required: true },
    googleMapLink: { type: String }
  },

  phone: { type: String, required: true },
  email: String,
  whatsappNumber: String,

  roomTypes: [{
    roomType: { type: String, required: true },
    price: { type: Number, required: true },
    capacity: Number,
    bedsAvailable: { type: Number, default: 0 },
    totalBeds: { type: Number, default: 0 },
    bedConfigurations: [{
      name: String,
      totalBeds: Number,
      availableBeds: Number
    }]
  }],

  foodItems: [{
    name: { type: String, required: true },
    daysServing: [{ type: String }]
  }],
  foodMenuDescription: { type: String },

  facilities: [{
    title: { type: String, required: true },
    isHighlighted: { type: Boolean, default: false }
  }],

  images: [{ url: String }],

  verificationStatus: {
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verificationDate: Date,
    rejectionReason: String
  },

  isVerified: { type: Boolean, default: false },
  isLive: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false },
  isPending: { type: Boolean, default: true },

  isSponsored: { type: Boolean, default: false },
  isSponsorFeatured: { type: Boolean, default: false },
  sponsorPackage: { type: String, enum: ['none', 'basic', 'featured', 'premium'], default: 'none' },
  sponsorExpiresAt: { type: Date, default: null },
  rank: { type: Number, default: 60, min: 0, max: 100 },
  isActive: { type: Boolean, default: true },
  activeDate: { type: Date, default: Date.now },
  expiryDate: { type: Date, default: null },
  averageRating: { type: Number, default: 0 },
  ratings: {
    average: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  totalBookings: { type: Number, default: 0 },
  viewCount: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 }
}, {
  timestamps: true,
  collection: 'hostels'
});

hostelSchema.index({ name: 1, 'location.addressText': 1 });

module.exports = mongoose.model('Hostel', hostelSchema);