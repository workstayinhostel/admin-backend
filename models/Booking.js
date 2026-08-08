const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  bookingCode: {
    type: String,
    unique: true,
    default: () => `BK${Date.now()}${Math.floor(Math.random() * 1000)}`
  },

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
  hostelOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  roomType: {
    type: String,
    required: true
  },
  roomNumber: String,
  numberOfRooms: {
    type: Number,
    default: 1
  },

  checkInDate: Date,
  checkOutDate: Date,
  numberOfNights: Number,

  status: {
    type: String,
    enum: ['pending', 'contacted', 'confirmed', 'cancelled', 'completed', 'no-show'],
    default: 'pending'
  },

  pricePerNight: Number,
  totalPrice: Number,
  deposit: Number,
  bookingFee: Number,
  discount: Number,
  finalAmount: Number,

  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
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
    default: 'call'
  },

  messages: [{
    sender: mongoose.Schema.Types.ObjectId,
    senderRole: String,
    message: String,
    timestamp: { type: Date, default: Date.now },
    attachments: [String]
  }],

  ownerResponse: {
    status: {
      type: String,
      enum: ['pending', 'interested', 'rejected'],
      default: 'pending'
    },
    responseMessage: String,
    respondedAt: Date
  },

  specialRequests: String,
  additionalInfo: String,

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