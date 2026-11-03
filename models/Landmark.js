const mongoose = require('mongoose');

const landmarkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  googleMapsUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  location: {
    city: { type: String, required: true, trim: true, maxlength: 120 },
    country: { type: String, required: true, trim: true, maxlength: 120 }
  },
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (coordinates) => coordinates.length === 2
          && coordinates[0] >= -180
          && coordinates[0] <= 180
          && coordinates[1] >= -90
          && coordinates[1] <= 90,
        message: 'Coordinates must contain longitude and latitude within valid ranges'
      }
    }
  }
}, {
  timestamps: true,
  collection: 'landmarks'
});

landmarkSchema.index({ coordinates: '2dsphere' });
landmarkSchema.index({ name: 1 });
landmarkSchema.index({ 'location.city': 1, 'location.country': 1 });

module.exports = mongoose.model('Landmark', landmarkSchema);
