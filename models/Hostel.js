const mongoose = require('mongoose');
const { normalizeMealSchedule } = require('../utils/mealSchedule');

const mealSlotSchema = new mongoose.Schema({
  from: { type: String, required: true, trim: true, match: /^(0?[1-9]|1[0-2]):[0-5]\d (AM|PM)$/ },
  to: { type: String, required: true, trim: true, match: /^(0?[1-9]|1[0-2]):[0-5]\d (AM|PM)$/ },
  dishes: { type: [{ type: String, trim: true }], default: [] }
}, { _id: false });

const mealScheduleDaySchema = new mongoose.Schema({
  breakfast: { type: mealSlotSchema, required: true },
  mealLunch: { type: mealSlotSchema, required: true },
  snacks: { type: mealSlotSchema, required: true },
  dinner: { type: mealSlotSchema, required: true }
}, { _id: false });

const mealScheduleSchema = new mongoose.Schema({
  Sunday: { type: mealScheduleDaySchema, required: true },
  Monday: { type: mealScheduleDaySchema, required: true },
  Tuesday: { type: mealScheduleDaySchema, required: true },
  Wednesday: { type: mealScheduleDaySchema, required: true },
  Thursday: { type: mealScheduleDaySchema, required: true },
  Friday: { type: mealScheduleDaySchema, required: true },
  Saturday: { type: mealScheduleDaySchema, required: true }
}, { _id: false });

const hostelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: ['boys', 'girls', 'pg'], required: true },
  hostelCode: { type: String, unique: true, immutable: true },
  description: { type: String, required: true },

  location: {
    addressText: { type: String, required: true },
    googleMapLink: { type: String },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      // GeoJSON standard format: [longitude, latitude]
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    }
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
    }],
    availableRooms: { type: Number, default: 0 }
  }],

  mealSchedule: {
    type: mealScheduleSchema,
    default: () => normalizeMealSchedule()
  },

  foodItems: [{
    name: { type: String, required: true },
    daysServing: [{ type: String }]
  }],
  foodMenuDescription: { type: String },

  feeStructure: {
    bookingFee: { type: Number, default: 0 },
    monthlyFee: { type: Number, default: 0 },
    deposit: { type: Number, default: 0 }
  },

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
  isLive: { type: Boolean, default: true },
  isApproved: { type: Boolean, default: true },
  isPending: { type: Boolean, default: false },

  isSponsored: { type: Boolean, default: false },
  isSponsorFeatured: { type: Boolean, default: false },
  sponsorPackage: { type: String, enum: ['none', 'basic', 'featured', 'premium'], default: 'none' },
  sponsorExpiresAt: { type: Date, default: null },
  rank: { type: Number, default: 60, min: 0, max: 100 },
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

// Indexes for query performance and geospatial searches
hostelSchema.index({ name: 1, 'location.addressText': 1 });
hostelSchema.index({ 'location.coordinates': '2dsphere' });
hostelSchema.index({ type: 1, rank: -1 });
hostelSchema.index({ type: 1, createdAt: -1 });
hostelSchema.index({ type: 1, isLive: 1, rank: -1 });

module.exports = mongoose.model('Hostel', hostelSchema);