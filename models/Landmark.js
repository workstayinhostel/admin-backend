const mongoose = require('mongoose');

const landmarkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  googleMapsUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  location: {
    city: { type: String, required: true, trim: true, maxlength: 120 },
    country: { type: String, required: true, trim: true, maxlength: 120 },
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
  }
}, {
  timestamps: true,
  collection: 'landmarks'
});

landmarkSchema.index({ 'location.coordinates': '2dsphere' });
landmarkSchema.index({ name: 1 });
landmarkSchema.index({ 'location.city': 1, 'location.country': 1 });

landmarkSchema.statics.initializeGeoIndex = async function initializeGeoIndex() {
  const collection = this.collection;
  const indexes = await collection.indexes().catch((error) => {
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) {
      return [];
    }
    throw error;
  });

  for (const index of indexes) {
    const keys = Object.keys(index.key || {});
    const hasObsoleteGeoIndex = keys.length === 1
      && ((index.key.location === '2dsphere') || (index.key.coordinates === '2dsphere'));
    if (hasObsoleteGeoIndex) {
      await collection.dropIndex(index.name);
    }
  }

  await collection.updateMany(
    {
      coordinates: { $exists: true },
      'location.coordinates': { $exists: false }
    },
    [
      { $set: { 'location.coordinates': '$coordinates' } },
      { $unset: 'coordinates' }
    ]
  );

  await collection.createIndex(
    { 'location.coordinates': '2dsphere' },
    { name: 'location.coordinates_2dsphere' }
  );
};

module.exports = mongoose.model('Landmark', landmarkSchema);
