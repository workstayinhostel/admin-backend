const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  bookingCode: {
    type: String,
    unique: true,
    required: true
  },

  hostel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 254,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  hostelOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  contactName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  contactNumber: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30
  },

  roomType: {
    type: String,
    trim: true,
    maxlength: 100,
    default: 'N/A'
  },
  people: {
    type: Number,
    required: true,
    min: 1,
    max: 50
  },
  roomNumber: String,
  numberOfRooms: {
    type: Number,
    default: 1
  },

  checkInDate: Date,

  status: {
    type: String,
    enum: ['pending', 'contacted', 'confirmed', 'cancelled', 'completed', 'no-show', 'success'],
    default: 'pending'
  },

  studentDetails: {
    name: String,
    email: String,
    phone: String,
    institution: String,
    educationLevel: String
  },

  preferredContact: {
    type: String,
    enum: ['call', 'whatsapp', 'email'],
    default: 'whatsapp'
  },
  method: {
    type: String,
    enum: ['whatsapp'],
    default: 'whatsapp'
  },

  specialRequests: String,
  additionalInfo: String,
  frontendDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },

  cancellationReason: String,
  cancelledBy: {
    type: String,
    enum: ['student', 'owner', 'admin']
  },
  cancelledAt: Date,
  refundAmount: Number,
  refundStatus: String,

  approvedBy: mongoose.Schema.Types.ObjectId,
  approvedAt: Date,

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'bookings'
});

module.exports = mongoose.model('Booking', BookingSchema);
