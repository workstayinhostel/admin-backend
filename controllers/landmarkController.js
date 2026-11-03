const mongoose = require('mongoose');
const Landmark = require('../models/Landmark');
const logger = require('../config/logger');
const { createAuditLog } = require('../utils/adminHelpers');
const { extractCoordinatesFromGoogleMaps, validateGoogleMapsUrl } = require('../utils/googleMaps');

const MAX_PAGE_SIZE = 100;
const MAX_PAGE_NUMBER = 1000000;

const getRequiredString = (value, field, maxLength) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    const error = new Error(`${field} is required and must be no more than ${maxLength} characters`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
};

const sendControllerError = (res, error, action) => {
  logger.error(`${action}:`, { message: error.message, stack: error.stack });
  const statusCode = error.statusCode || (error.code === 'ECONNABORTED' ? 502 : 500);
  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Unable to complete the landmark request' : error.message
  });
};

const validateLandmarkBody = (body, isUpdate = false) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('A landmark object is required');
    error.statusCode = 400;
    throw error;
  }

  const fields = {};
  if (!isUpdate || body.name !== undefined) {
    fields.name = getRequiredString(body.name, 'name', 120);
  }
  if (!isUpdate || body.googleMapsUrl !== undefined) {
    fields.googleMapsUrl = getRequiredString(body.googleMapsUrl, 'googleMapsUrl', 2048);
    try {
      validateGoogleMapsUrl(fields.googleMapsUrl);
    } catch (error) {
      error.statusCode = 400;
      throw error;
    }
  }
  if (!isUpdate || body.location !== undefined) {
    if (!body.location || typeof body.location !== 'object' || Array.isArray(body.location)) {
      const error = new Error('location must include city and country');
      error.statusCode = 400;
      throw error;
    }
    fields.location = {};
    if (!isUpdate || body.location.city !== undefined) {
      fields.location.city = getRequiredString(body.location.city, 'location.city', 120);
    }
    if (!isUpdate || body.location.country !== undefined) {
      fields.location.country = getRequiredString(body.location.country, 'location.country', 120);
    }
    if (isUpdate && Object.keys(fields.location).length === 0) {
      const error = new Error('Provide city or country when updating location');
      error.statusCode = 400;
      throw error;
    }
  }

  if (isUpdate && Object.keys(fields).length === 0) {
    const error = new Error('Provide at least one landmark field to update');
    error.statusCode = 400;
    throw error;
  }

  return fields;
};

const validateLandmarkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error('Invalid landmark id');
    error.statusCode = 400;
    throw error;
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createLandmarkAuditLog = (req, details) => createAuditLog({
  user: req.user._id,
  userRole: req.user.role,
  resourceType: 'landmark',
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
  ...details
});

exports.createLandmark = async (req, res) => {
  try {
    const fields = validateLandmarkBody(req.body);
    const coordinates = await extractCoordinatesFromGoogleMaps(fields.googleMapsUrl);
    if (coordinates[0] === 0 && coordinates[1] === 0) {
      const error = new Error('No coordinates could be extracted from this Google Maps link');
      error.statusCode = 422;
      throw error;
    }
    const landmark = await Landmark.create({
      ...fields,
      location: {
        ...fields.location,
        coordinates: { type: 'Point', coordinates }
      }
    });

    await createLandmarkAuditLog(req, {
      action: 'landmark_created',
      resourceId: landmark._id,
      resourceName: landmark.name,
      changes: { after: landmark.toObject() },
      description: `Created landmark ${landmark.name}`
    });

    res.status(201).json({ success: true, landmark });
  } catch (error) {
    sendControllerError(res, error, 'Create landmark error');
  }
};

exports.getLandmarks = async (req, res) => {
  try {
    const parsePositiveInteger = (value, defaultValue) => {
      if (value === undefined) {
        return defaultValue;
      }
      if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        return null;
      }
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const requestedPage = parsePositiveInteger(req.query.page, 1);
    const requestedLimit = parsePositiveInteger(req.query.limit, 25);
    if (!requestedPage || requestedPage > MAX_PAGE_NUMBER
      || !requestedLimit) {
      return res.status(400).json({ success: false, message: 'page and limit must be positive integers' });
    }

    const page = requestedPage;
    const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
    const filter = {};
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const search = new RegExp(escapeRegex(req.query.search.trim().slice(0, 120)), 'i');
      filter.$or = [
        { name: search },
        { 'location.city': search },
        { 'location.country': search }
      ];
    }

    const [landmarks, total] = await Promise.all([
      Landmark.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
      Landmark.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      landmarks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    sendControllerError(res, error, 'Get landmarks error');
  }
};

exports.getLandmarkById = async (req, res) => {
  try {
    validateLandmarkId(req.params.id);
    const landmark = await Landmark.findById(req.params.id);
    if (!landmark) {
      return res.status(404).json({ success: false, message: 'Landmark not found' });
    }
    res.status(200).json({ success: true, landmark });
  } catch (error) {
    sendControllerError(res, error, 'Get landmark error');
  }
};

exports.updateLandmark = async (req, res) => {
  try {
    validateLandmarkId(req.params.id);
    const fields = validateLandmarkBody(req.body, true);
    const landmark = await Landmark.findById(req.params.id);
    if (!landmark) {
      return res.status(404).json({ success: false, message: 'Landmark not found' });
    }

    const before = landmark.toObject();
    if (fields.googleMapsUrl && fields.googleMapsUrl !== landmark.googleMapsUrl) {
      const coordinates = await extractCoordinatesFromGoogleMaps(fields.googleMapsUrl);
      if (coordinates[0] === 0 && coordinates[1] === 0) {
        const error = new Error('No coordinates could be extracted from this Google Maps link');
        error.statusCode = 422;
        throw error;
      }
      landmark.location.coordinates = { type: 'Point', coordinates };
    }

    if (fields.name !== undefined) {
      landmark.name = fields.name;
    }
    if (fields.location) {
      if (fields.location.city !== undefined) {
        landmark.location.city = fields.location.city;
      }
      if (fields.location.country !== undefined) {
        landmark.location.country = fields.location.country;
      }
    }
    if (fields.googleMapsUrl !== undefined) {
      landmark.googleMapsUrl = fields.googleMapsUrl;
    }

    await landmark.save();
    const after = landmark.toObject();
    const changedFields = Object.keys(fields);
    if (fields.googleMapsUrl !== undefined && fields.googleMapsUrl !== before.googleMapsUrl) {
      changedFields.push('location.coordinates');
    }
    await createLandmarkAuditLog(req, {
      action: 'landmark_updated',
      resourceId: landmark._id,
      resourceName: landmark.name,
      changes: { before, after, fieldsChanged: changedFields },
      description: `Updated landmark ${landmark.name}`
    });

    res.status(200).json({ success: true, landmark });
  } catch (error) {
    sendControllerError(res, error, 'Update landmark error');
  }
};

exports.deleteLandmark = async (req, res) => {
  try {
    validateLandmarkId(req.params.id);
    const landmark = await Landmark.findByIdAndDelete(req.params.id);
    if (!landmark) {
      return res.status(404).json({ success: false, message: 'Landmark not found' });
    }
    const deletedLandmark = landmark.toObject();
    await createLandmarkAuditLog(req, {
      action: 'landmark_deleted',
      resourceId: landmark._id,
      resourceName: landmark.name,
      changes: { before: deletedLandmark },
      description: `Deleted landmark ${landmark.name}`
    });
    res.status(200).json({ success: true, message: 'Landmark deleted successfully' });
  } catch (error) {
    sendControllerError(res, error, 'Delete landmark error');
  }
};
