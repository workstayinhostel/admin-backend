const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  // User Information
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userRole: String,
  userName: String,
  userEmail: String,
  
  // Action Details
  action: {
    type: String,
    enum: [
      'hostel_created',
      'hostel_updated',
      'hostel_deleted',
      'hostel_published',
      'hostel_unpublished',
      'hostel_verified',
      'hostel_rejected',
      'booking_created',
      'booking_confirmed',
      'booking_cancelled',
      'user_created',
      'user_updated',
      'user_deleted',
      'user_activated',
      'user_deactivated',
      'user_merged',
      'user_role_changed',
      'rating_created',
      'rating_updated',
      'rating_deleted',
      'admin_login',
      'admin_logout',
      'password_reset',
      'email_verification',
      'account_verification',
      'admin_user_creation',
      'user_login'
    ],
    required: true
  },
  
  // Resource Information
  resourceType: {
    type: String,
    enum: ['user', 'hostel', 'booking', 'rating', 'admin', 'system'],
    required: true
  },
  resourceId: mongoose.Schema.Types.ObjectId,
  resourceName: String,
  
  // Change Details
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    fieldsChanged: [String]
  },
  
  // Additional Details
  description: String,
  ipAddress: String,
  userAgent: String,
  
  // Impact & Status tracking
  affectedUsers: [mongoose.Schema.Types.ObjectId],
  status: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: 'success'
  },
  errorMessage: String,
  
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false,
  collection: 'logs',
  // Automatically format output for clean dashboard viewing and inspection
  toJSON: {
    transform: function (doc, ret) {
      return {
        id: ret._id,
        timestamp: ret.createdAt,
        performedBy: {
          name: ret.userName || (ret.user && ret.user.firstName ? `${ret.user.firstName} ${ret.user.lastName || ''}`.trim() : 'System'),
          email: ret.userEmail || ret.user?.email || 'N/A',
          role: ret.userRole || 'N/A'
        },
        action: ret.action,
        description: ret.description || `${ret.action} executed`,
        resourceType: ret.resourceType,
        resourceName: ret.resourceName || null,
        status: ret.status,
        errorMessage: ret.errorMessage || null,
        ipAddress: ret.ipAddress
      };
    }
  }
});

// Create index for quick querying and sorting
LogSchema.index({ createdAt: -1 });
LogSchema.index({ user: 1, createdAt: -1 });
LogSchema.index({ resourceType: 1, resourceId: 1 });
LogSchema.index({ action: 1 });
LogSchema.index({ status: 1 });

module.exports = mongoose.model('Log', LogSchema);