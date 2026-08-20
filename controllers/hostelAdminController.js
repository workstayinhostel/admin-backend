const mongoose = require('mongoose');
const axios = require('axios');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const User = require('../models/User');
const { sendTemplateEmail } = require('../utils/emailService');
const emailTemplates = require('../utils/emailTemplates');
const logger = require('../config/logger');
const { deleteFile, uploadMultipleFiles } = require('../config/supabase');
const { normalizeHostelType, getHostelPermission, createAuditLog, isAdminRole } = require('../utils/adminHelpers');
const { generateHostelCode } = require('../utils/hostelHelpers');

const resolveHostelByIdentifier = async (identifier) => {
  if (!identifier) return null;

  const value = String(identifier).trim();
  if (!value) return null;

  if (mongoose.Types.ObjectId.isValid(value)) {
    return await Hostel.findById(value);
  }

  return await Hostel.findOne({
    hostelCode: {
      $regex: `^${escapeRegex(value)}$`,
      $options: 'i'
    }
  });
};

/**
 * Extract coordinates from a Google Maps URL, including short URLs and the common
 * Google Maps patterns that encode coordinates as query params or !3d / !4d markers.
 */
const extractCoordinatesFromGoogleMaps = async (link) => {
  if (!link) return [0, 0];

  let targetUrl = String(link).trim();
  if (!targetUrl) return [0, 0];
  let responseBody = '';

  const isShortGoogleLink = /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(targetUrl);

  if (isShortGoogleLink) {
    try {
      const response = await axios.get(targetUrl, {
        maxRedirects: 10,
        validateStatus: (status) => status >= 200 && status < 400,
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      targetUrl = response.request?.res?.responseUrl || response.request?.responseUrl || targetUrl;
      responseBody = typeof response.data === 'string' ? response.data : '';
    } catch (error) {
      logger.warn(`Unable to resolve shortened Google Maps link: ${error.message}`);
    }
  }

  // Mobile Maps pages often keep coordinates in URL-encoded !2d/!3d markers
  // in the response body instead of putting them in the final URL.
  const patterns = [
    { regex: /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' },
    { regex: /!2d(-?\d{1,3}(?:\.\d+)?)(?:![^!]+)*?!3d(-?\d{1,3}(?:\.\d+)?)/i, order: 'lng-lat' },
    { regex: /!3d(-?\d{1,3}(?:\.\d+)?)(?:![^!]+)*?!2d(-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' },
    { regex: /[?&](?:q|query|ll|center)=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' },
    { regex: /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,[-\d.]+)?(?:[/?#]|$)/i, order: 'lat-lng' },
    { regex: /(?:lat|latitude)[=,:](-?\d{1,3}(?:\.\d+)?)[^\d-]*?(?:lng|lon|longitude)[=,:](-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' }
  ];

  for (const searchableText of [targetUrl, responseBody]) {
    const normalizedText = searchableText.replace(/%21/g, '!').replace(/%2C/gi, ',');

    for (const { regex, order } of patterns) {
      const match = normalizedText.match(regex);
      if (!match) continue;

      const lat = Number(order === 'lng-lat' ? match[2] : match[1]);
      const lng = Number(order === 'lng-lat' ? match[1] : match[2] || match[1]);

      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
      ) {
        // GeoJSON expects [longitude, latitude]
        return [lng, lat];
      }
    }
  }

  return [0, 0];
};

const hasValidCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;

  const [longitude, latitude] = coordinates.map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    (longitude !== 0 || latitude !== 0) &&
    longitude >= -180 && longitude <= 180 &&
    latitude >= -90 && latitude <= 90;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const normalizeMapLink = (value) => {
  if (!value) return '';

  return String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '')
    .toLowerCase();
};

const normalizePhone = (value) => String(value ?? '')
  .replace(/\D/g, '')
  .trim();

const buildFoodItems = (payload) => {
  const foodItems = Array.isArray(payload?.foodItems) ? payload.foodItems : [];
  if (foodItems.length) {
    return foodItems
      .map(item => ({
        name: String(item?.name || item?.foodName || 'Food').trim(),
        daysServing: Array.isArray(item?.daysServing) ? item.daysServing.map(day => String(day).trim()).filter(Boolean) : []
      }))
      .filter(item => item.name);
  }

  if (Array.isArray(payload?.foodMenu)) {
    return payload.foodMenu
      .map(item => ({
        name: String(item?.name || item?.foodName || 'Food').trim(),
        daysServing: Array.isArray(item?.daysServing) ? item.daysServing.map(day => String(day).trim()).filter(Boolean) : []
      }))
      .filter(item => item.name);
  }

  return [];
};

const normalizeRoomTypes = (roomTypes) => {
  if (!Array.isArray(roomTypes)) return [];

  return roomTypes.map(item => ({
    roomType: String(item?.roomType || item?.name || 'Room').trim(),
    price: Number(item?.price ?? 0),
    capacity: Number(item?.capacity ?? item?.totalBeds ?? 1),
    totalBeds: Number(item?.totalBeds ?? item?.capacity ?? 1),
    bedsAvailable: Number(item?.bedsAvailable ?? item?.availableBeds ?? item?.capacity ?? 1),
    bedConfigurations: Array.isArray(item?.bedConfigurations)
      ? item.bedConfigurations.map(config => ({
          name: String(config?.name || 'Bed').trim(),
          totalBeds: Number(config?.totalBeds ?? 0),
          availableBeds: Number(config?.availableBeds ?? 0)
        }))
      : []
  })).filter(item => item.roomType);
};

const buildFacilities = (payload) => {
  return Array.isArray(payload?.facilities)
    ? payload.facilities
        .map(item => ({
          title: String(item?.title || item?.name || 'Facility').trim(),
          isHighlighted: Boolean(item?.isHighlighted)
        }))
        .filter(item => item.title)
    : [];
};

const buildImages = (payload) => {
  if (!payload?.images) {
    logger.debug('[BUILD IMAGES] No images in payload');
    return [];
  }

  const images = Array.isArray(payload.images) ? payload.images : [];

  if (!Array.isArray(images) || images.length === 0) {
    logger.warn(`[BUILD IMAGES] Invalid images format: ${typeof payload.images}`);
    return [];
  }

  const processed = [];

  images.forEach((item) => {
    let imageObj = null;

    if (typeof item === 'string' && item.trim()) {
      imageObj = { url: item.trim() };
    } else if (typeof item === 'object' && item !== null && item.url && typeof item.url === 'string') {
      imageObj = { url: item.url.trim() };
    } else if (typeof item === 'object' && item !== null && item.url === undefined) {
      imageObj = item;
    } else {
      logger.warn('[BUILD IMAGES] Invalid image entry skipped');
      return;
    }

    if (imageObj && imageObj.url) {
      processed.push(imageObj);
    }
  });

  logger.info(`[BUILD IMAGES] Prepared ${processed.length}/${images.length} image(s) for database`);
  return processed;
};

const deleteSupabaseImageByUrl = async (imageUrl) => {
  if (!imageUrl) return false;

  try {
    await deleteFile(imageUrl);
    return true;
  } catch (error) {
    logger.warn(`Unable to delete Supabase image ${imageUrl}: ${error.message}`);
    return false;
  }
};

const collectDeletedImageUrls = (previousImages, incomingImages, explicitDeletedImages = []) => {
  const previousUrls = (previousImages || []).map(img => img?.url).filter(Boolean);
  const incomingUrls = (incomingImages || []).map(img => img?.url).filter(Boolean);
  const deletedExplicit = Array.isArray(explicitDeletedImages)
    ? explicitDeletedImages.map(item => typeof item === 'string' ? item : item?.url).filter(Boolean)
    : [];

  const removed = previousUrls.filter(url => !incomingUrls.includes(url));
  return Array.from(new Set([...deletedExplicit, ...removed]));
};

const findDuplicateHostel = async (payload) => {
  const name = normalizeText(payload?.name);
  const address = normalizeText(payload?.location?.addressText || payload?.addressText);
  const mapLink = normalizeMapLink(payload?.location?.googleMapLink || payload?.googleMapLink);
  const phone = normalizePhone(payload?.phone || payload?.whatsappNumber || payload?.contactNumber);
  const email = normalizeText(payload?.email || payload?.ownerEmail);

  if (!name && !address && !mapLink && !phone && !email) return null;

  const orConditions = [];

  if (name) {
    orConditions.push({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
  }

  if (address) {
    orConditions.push({ 'location.addressText': { $regex: `^${escapeRegex(address)}$`, $options: 'i' } });
  }

  if (mapLink) {
    orConditions.push({ 'location.googleMapLink': { $regex: escapeRegex(mapLink), $options: 'i' } });
  }

  if (phone) {
    orConditions.push(
      { phone: { $regex: `^${escapeRegex(phone)}$`, $options: 'i' } },
      { whatsappNumber: { $regex: `^${escapeRegex(phone)}$`, $options: 'i' } }
    );
  }

  if (email) {
    orConditions.push({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
  }

  if (!orConditions.length) return null;

  const possibleMatches = await Hostel.find({ $or: orConditions })
    .select('name location hostelCode phone whatsappNumber email')
    .lean();

  const currentName = name;
  const currentAddress = address;
  const currentMapLink = mapLink;
  const currentPhone = phone;
  const currentEmail = email;

  return possibleMatches.find((hostel) => {
    const hostelName = normalizeText(hostel?.name);
    const hostelAddress = normalizeText(hostel?.location?.addressText);
    const hostelPhone = normalizePhone(hostel?.phone || hostel?.whatsappNumber);

    const matchesName = currentName && hostelName && hostelName === currentName;
    const matchesAddress = currentAddress && hostelAddress && hostelAddress === currentAddress;
    const matchesPhone = currentPhone && hostelPhone && hostelPhone === currentPhone;

    // Only consider as duplicate if: (name AND phone) OR (name AND address) OR (address AND phone)
    const isDuplicate = (matchesName && matchesPhone) || (matchesName && matchesAddress) || (matchesAddress && matchesPhone);
    return isDuplicate;
  }) || null;
};

const enrichHostelWithMetrics = async (hostel) => {
  const [bookingCount, reviewStats] = await Promise.all([
    Booking.countDocuments({ hostel: hostel._id }),
    Review.aggregate([
      { $match: { hostel: hostel._id } },
      { $group: { _id: '$hostel', average: { $avg: '$rating' }, total: { $sum: '$rating' }, count: { $sum: 1 } } }
    ])
  ]);

  const reviewSummary = reviewStats?.[0] || null;
  const average = Number(reviewSummary?.average ?? hostel.averageRating ?? 0).toFixed(1);
  const total = Number(reviewSummary?.total ?? hostel.ratings?.total ?? 0);
  const count = Number(reviewSummary?.count ?? hostel.ratings?.count ?? hostel.ratingCount ?? 0);
  const data = hostel.toObject ? hostel.toObject() : hostel;

  return {
    ...data,
    averageRating: Number(average),
    ratings: {
      average: Number(average),
      total,
      count
    },
    totalBookings: bookingCount
  };
};

const uploadHostelImages = async (req, res) => {
  try {
    if (!req.files || !req.files.length) {
      logger.warn('No files received in request');
      return res.status(200).json({ success: true, images: [], message: 'No images uploaded' });
    }

    const uniqueFiles = req.files;
    const hostelName = String(req.body?.hostelName || req.body?.name || '').trim();

    logger.info(`Uploading ${uniqueFiles.length} image(s)${hostelName ? ` for "${hostelName}"` : ''}`);

    const uploadResult = await uploadMultipleFiles(
      uniqueFiles.map(file => ({ buffer: file.buffer, originalname: file.originalname })),
      'hostels',
      hostelName
    );

    const { successful = [], failed = [] } = uploadResult;
    const imageUrls = successful.map(result => result.secure_url || result.url || '').filter(Boolean);

    logger.info(`Upload complete: ${imageUrls.length}/${uniqueFiles.length} successful, ${failed.length} failed`);

    if (failed.length > 0) {
      logger.warn(`Image upload failures: ${failed.length}`);
    }

    const response = {
      success: imageUrls.length > 0,
      images: imageUrls,
      uploadedCount: imageUrls.length,
      failedCount: failed.length,
      totalRequested: req.files.length,
      message: imageUrls.length > 0
        ? `Uploaded ${imageUrls.length}/${uniqueFiles.length} image(s). ${failed.length > 0 ? `${failed.length} failed.` : 'All images uploaded.'}`
        : 'Image upload failed. Please try again.'
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error('Upload hostel images error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error uploading hostel images' });
  }
};

exports.uploadHostelImages = uploadHostelImages;

exports.createHostel = async (req, res) => {
  try {
    const actor = req.user;
    const payload = req.body;

    logger.info(`Creating hostel: "${payload.name}" (${payload.type})`);

    if (!payload.name || !payload.type || !payload.description || !payload.location || !payload.phone) {
      return res.status(400).json({ success: false, message: 'name, type, description, location and phone are required' });
    }

    // ===== STEP 2: CHECK FOR DUPLICATE HOSTEL FIRST (BEFORE ANY OTHER PROCESSING) =====
    const duplicateHostel = await findDuplicateHostel(payload);
    if (duplicateHostel && payload.confirmDuplicate !== true) {
      return res.status(409).json({
        success: false,
        message: `Similar hostel already exists: ${duplicateHostel.name} (Hostel code: ${duplicateHostel.hostelCode}). Please check before adding another one.`,
        requiresConfirmation: true,
        duplicateHostel: {
          id: duplicateHostel._id,
          name: duplicateHostel.name,
          hostelCode: duplicateHostel.hostelCode,
          location: duplicateHostel.location
        }
      });
    }

    // ===== STEP 3: Validate type =====
    const normalizedType = normalizeHostelType(payload.type);
    if (!normalizedType) {
      return res.status(400).json({ success: false, message: 'Type must be one of boys, girls or pg' });
    }

    // ===== STEP 4: Validate and process owner =====
    const ownerId = payload.ownerId || payload.owner || payload.ownerEmail || null;
    let owner = null;
    if (ownerId) {
      owner = await User.findOne({
        $or: [
          { _id: mongoose.Types.ObjectId.isValid(String(ownerId)) ? String(ownerId) : null },
          { email: String(ownerId).trim().toLowerCase() }
        ].filter(Boolean)
      });

      if (!owner) {
        return res.status(400).json({ success: false, message: 'Provide a valid hostel owner user id or email when an owner is supplied' });
      }

      if (!['hostelowner', 'founder'].includes(owner.role) && actor.role !== 'founder') {
        return res.status(400).json({ success: false, message: 'Selected user is not a valid hostel owner.' });
      }
    }

    const isAdminActor = ['founder', 'superadmin', 'admin'].includes(actor.role);
    const isExplicitlyVerified = payload.isVerified === true || payload.isVerified === 'true' || payload.isVerified === 1 || payload.verificationStatus?.status === 'verified';
    const existingCodes = await Hostel.find({}, { hostelCode: 1 }).lean();
    let hostelCode = payload.hostelCode || generateHostelCode(existingCodes.map(item => item.hostelCode), process.env.HOSTEL_CODE_PREFIX || 'SIH');
    let existingHostel = await Hostel.findOne({ hostelCode });
    while (existingHostel) {
      hostelCode = generateHostelCode([...existingCodes.map(item => item.hostelCode), hostelCode], process.env.HOSTEL_CODE_PREFIX || 'SIH');
      existingHostel = await Hostel.findOne({ hostelCode });
    }

    const location = payload.location || {};
    const mapLink = location.googleMapLink || payload.googleMapLink || '';
    const suppliedCoordinates = location.coordinates?.coordinates;
    const extractedCoordinates = await extractCoordinatesFromGoogleMaps(mapLink);
    const coordinates = hasValidCoordinates(extractedCoordinates)
      ? extractedCoordinates
      : hasValidCoordinates(suppliedCoordinates)
        ? suppliedCoordinates.map(Number)
        : [0, 0];

    const normalizedRoomTypes = Array.isArray(payload.roomTypes) ? payload.roomTypes.map(item => ({
      roomType: item.roomType || item.name || 'Room',
      price: Number(item.price || 0),
      capacity: Number(item.capacity || 1),
      totalBeds: Number(item.totalBeds || item.capacity || 1),
      bedsAvailable: Number(item.bedsAvailable || item.capacity || 1),
      bedConfigurations: Array.isArray(item.bedConfigurations) ? item.bedConfigurations.map(config => ({
        name: config.name || 'Bed',
        totalBeds: Number(config.totalBeds || 0),
        availableBeds: Number(config.availableBeds || 0)
      })) : []
    })) : [];

    const foodItems = buildFoodItems(payload);
    const normalizedFacilities = buildFacilities(payload);
    const images = buildImages(payload);

    logger.info(`Saving hostel "${payload.name}" with ${images.length} image(s); code: ${hostelCode}`);
    if (images.length === 0) {
      logger.warn('[CREATE HOSTEL] No images provided for this hostel');
    }

    const hostel = await Hostel.create({
      name: payload.name,
      owner: owner ? owner._id : null,
      type: normalizedType,
      hostelCode,
      description: payload.description,
      location: {
        addressText: location.addressText || payload.addressText || 'Address not provided',
        googleMapLink: mapLink,
        coordinates: { type: 'Point', coordinates }
      },
      phone: payload.phone,
      email: payload.email || (owner ? owner.email : undefined),
      whatsappNumber: payload.whatsappNumber || payload.phone,
      roomTypes: normalizedRoomTypes,
      foodItems,
      foodMenuDescription: payload.foodMenuDescription || (foodItems.length ? foodItems.map(item => `${item.name}: ${item.daysServing.join(', ')}`).join(' | ') : ''),
      facilities: normalizedFacilities,
      images,
      isApproved: true,
      isVerified: false,
      isLive: true,
      verificationStatus: {
        status: 'pending'
      }
    });

    logger.info(`Hostel created successfully: ${hostel.name} (${hostel.type}) | code: ${hostel.hostelCode} | images: ${hostel.images.length}`);

    if (owner) {
      owner.associatedHostels = owner.associatedHostels || [];
      if (!owner.associatedHostels.includes(hostel._id)) owner.associatedHostels.push(hostel._id);
      owner.role = owner.role === 'student' ? 'hostelowner' : owner.role;
      await owner.save();
    }

    await createAuditLog({
      user: actor._id,
      userRole: actor.role,
      action: 'hostel_created',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: owner ? `Hostel created and linked to owner ${owner.email}` : `Hostel created pending owner validation`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    const successMessage = owner
      ? `Hostel (${hostel.hostelCode}) named ${hostel.name} created successfully with ${hostel.images.length} image${hostel.images.length !== 1 ? 's' : ''}.`
      : `Hostel (${hostel.hostelCode}) named ${hostel.name} created successfully with ${hostel.images.length} image${hostel.images.length !== 1 ? 's' : ''} without an assigned owner.`;

    res.status(201).json({ 
      success: true, 
      message: successMessage, 
      hostel: {
        ...hostel.toObject(),
        imageCount: hostel.images.length
      }
    });
  } catch (error) {
    logger.error('Create hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating hostel' });
  }
};

exports.getHostels = async (req, res) => {
  try {
    const {
      search,
      type,
      verificationStatus,
      isLive,
      isVerified,
      isApproved,
      minRating,
      page = '1',
      limit = '25',
      sort = 'rank:desc'
    } = req.query;

    const query = {};

    const normalizedType = type ? normalizeHostelType(String(type)) : null;
    if (type && !normalizedType) {
      return res.status(400).json({ success: false, message: 'Type must be one of boys, girls or pg' });
    }
    if (normalizedType) query.type = normalizedType;

    const normalizedVerificationStatus = verificationStatus ? String(verificationStatus).trim().toLowerCase() : '';
    if (verificationStatus && !['verified', 'pending', 'rejected'].includes(normalizedVerificationStatus)) {
      return res.status(400).json({ success: false, message: 'verificationStatus must be one of verified, pending or rejected' });
    }
    if (normalizedVerificationStatus) query['verificationStatus.status'] = normalizedVerificationStatus;

    if (isLive !== undefined) {
      const value = String(isLive).trim().toLowerCase();
      if (!['true', 'false'].includes(value)) {
        return res.status(400).json({ success: false, message: 'isLive must be true or false' });
      }
      query.isLive = value === 'true';
    }

    if (isVerified !== undefined) {
      const value = String(isVerified).trim().toLowerCase();
      if (!['true', 'false'].includes(value)) {
        return res.status(400).json({ success: false, message: 'isVerified must be true or false' });
      }
      query.isVerified = value === 'true';
    }

    if (isApproved !== undefined) {
      const value = String(isApproved).trim().toLowerCase();
      if (!['true', 'false'].includes(value)) {
        return res.status(400).json({ success: false, message: 'isApproved must be true or false' });
      }
      query.isApproved = value === 'true';
    }

    if (search) {
      const text = String(search).trim();
      if (text) {
        query.$or = [
          { name: { $regex: text, $options: 'i' } },
          { hostelCode: { $regex: text, $options: 'i' } },
          { 'location.addressText': { $regex: text, $options: 'i' } },
          { 'location.googleMapLink': { $regex: text, $options: 'i' } }
        ];
      }
    }

    if (minRating !== undefined) {
      const ratingValue = Number(minRating);
      if (!Number.isFinite(ratingValue) || ratingValue < 1 || ratingValue > 5) {
        return res.status(400).json({ success: false, message: 'minRating must be a number between 1 and 5' });
      }
      query.$and = [
        ...(Array.isArray(query.$and) ? query.$and : []),
        {
          $or: [
            { 'ratings.average': { $gte: ratingValue } },
            { averageRating: { $gte: ratingValue } }
          ]
        }
      ];
    }

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ success: false, message: 'page must be a positive integer' });
    }
    if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
      return res.status(400).json({ success: false, message: 'limit must be an integer between 1 and 100' });
    }

    const allowedSortFields = new Map([
      ['rank', 'rank'],
      ['rating', 'averageRating'],
      ['name', 'name'],
      ['createdAt', 'createdAt'],
      ['isLive', 'isLive'],
      ['isVerified', 'isVerified'],
      ['isApproved', 'isApproved']
    ]);

    const sortEntry = String(sort).trim();
    const [sortField, sortOrder = 'desc'] = sortEntry.split(':');
    const sortKey = allowedSortFields.get(sortField);
    if (!sortKey) {
      return res.status(400).json({ success: false, message: 'sort must be one of rank, rating, name, createdAt, isLive, isVerified, isApproved' });
    }
    if (!['asc', 'desc'].includes(String(sortOrder).toLowerCase())) {
      return res.status(400).json({ success: false, message: 'sort order must be asc or desc' });
    }

    const sortQuery = {};
    sortQuery[sortKey] = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;

    if (sortKey === 'averageRating') {
      sortQuery.averageRating = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
    }

    const total = await Hostel.countDocuments(query);
    const skip = (pageNumber - 1) * limitNumber;
    const hostels = await Hostel.find(query)
      .populate('owner', 'firstName lastName email role phone')
      .sort(sortQuery)
      .skip(skip)
      .limit(limitNumber);

    const enrichedHostels = await Promise.all(hostels.map(enrichHostelWithMetrics));

    res.status(200).json({
      success: true,
      hostels: enrichedHostels,
      total,
      page: pageNumber,
      limit: limitNumber
    });
  } catch (error) {
    logger.error('Get hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching hostels' });
  }
};

exports.getHostelById = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId).populate('owner', 'firstName lastName email role phone');
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const enrichedHostel = await enrichHostelWithMetrics(hostel);
    res.status(200).json({ success: true, hostel: enrichedHostel });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Error fetching hostel' });
  }
};

exports.getPendingHostels = async (req, res) => {
  try {
    const hostels = await Hostel.find({ isApproved: false }).populate('owner', 'firstName lastName email phone').sort('-createdAt');
    res.status(200).json({ success: true, count: hostels.length, hostels });
  } catch (error) {
    logger.error('Get pending hostels error:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending hostels' });
  }
};

exports.updateHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });

    const { isOwner, isAdmin, canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot edit this hostel' });

    const before = hostel.toObject();
    const changedFields = [];
    const ownerUpdatable = new Set([
      'name', 'type', 'description', 'phone', 'email', 'whatsappNumber', 'foodItems', 'foodMenuDescription',
      'location', 'roomTypes', 'facilities', 'images', 'addressText', 'googleMapLink', 'coordinates',
      'averageRating', 'ratingCount', 'totalBookings', 'viewCount', 'foodMenu', 'foodMenuDescription'
    ]);
    const adminOnlyUpdatable = new Set([
      'hostelCode', 'rank', 'isSponsored', 'isSponsorFeatured', 'sponsorPackage', 'isApproved', 'isVerified',
      'isLive', 'verificationStatus', 'expiryDate', 'activeDate', 'isDeleted',
      'sponsorExpiresAt', 'verificationStatus.status', 'verificationStatus.verifiedBy', 'verificationStatus.verificationDate', 'verificationStatus.rejectionReason'
    ]);
    const blockedFields = new Set(['_id', 'id', 'hostelCode', '__v', 'createdAt', 'updatedAt']);
    const incoming = req.body || {};

    const handleLocationUpdate = async (locationValue) => {
      const incomingLoc = locationValue || {};
      let mapCoordinatesApplied = false;
      if (incomingLoc.addressText) hostel.location.addressText = incomingLoc.addressText;
      if (incomingLoc.googleMapLink) {
        hostel.location.googleMapLink = incomingLoc.googleMapLink;
        const resolvedCoords = await extractCoordinatesFromGoogleMaps(incomingLoc.googleMapLink);
        if (resolvedCoords[0] !== 0 || resolvedCoords[1] !== 0) {
          hostel.location.coordinates = { type: 'Point', coordinates: resolvedCoords };
          mapCoordinatesApplied = true;
        }
      }
      if (!mapCoordinatesApplied && incomingLoc.coordinates && hasValidCoordinates(incomingLoc.coordinates.coordinates)) {
        hostel.location.coordinates = { type: 'Point', coordinates: incomingLoc.coordinates.coordinates.map(Number) };
      }
    };

    const handleImageUpdate = async (imageValue, deletedExplicit = []) => {
      const previousImages = hostel.images || [];
      const cleanedImages = buildImages({ images: imageValue });
      const removedUrls = collectDeletedImageUrls(previousImages, cleanedImages, deletedExplicit);

      for (const imageUrl of removedUrls) {
        await deleteSupabaseImageByUrl(imageUrl);
      }

      hostel.images = cleanedImages;
      changedFields.push('images');
    };

    for (const [field, value] of Object.entries(incoming)) {
      if (blockedFields.has(field)) continue;
      if (field === 'ownerId') {
        if (!isAdmin) return res.status(403).json({ success: false, message: 'Only admins can change hostel ownership' });
        const owner = await User.findById(value);
        if (!owner) return res.status(400).json({ success: false, message: 'Owner not found' });
        hostel.owner = owner._id;
        changedFields.push('owner');
        continue;
      }

      if (field === 'type') {
        const normalizedType = normalizeHostelType(value);
        if (!normalizedType) return res.status(400).json({ success: false, message: 'Type must be one of boys, girls or pg' });
        hostel[field] = normalizedType;
        changedFields.push(field);
        continue;
      }

      if (field === 'foodItems') {
        if (!ownerUpdatable.has(field) && !isAdmin) return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
        hostel.foodItems = buildFoodItems({ foodItems: value });
        changedFields.push(field);
        continue;
      }

      if (field === 'roomTypes') {
        if (!ownerUpdatable.has(field) && !isAdmin) return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
        hostel.roomTypes = normalizeRoomTypes(value);
        changedFields.push(field);
        continue;
      }

      if (field === 'facilities') {
        if (!ownerUpdatable.has(field) && !isAdmin) return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
        hostel.facilities = buildFacilities({ facilities: value });
        changedFields.push(field);
        continue;
      }

      if (field === 'images') {
        if (!ownerUpdatable.has(field) && !isAdmin) return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
        await handleImageUpdate(value, incoming.deletedImages || incoming.deletedImageUrls || []);
        continue;
      }

      if (field === 'location') {
        if (!ownerUpdatable.has(field) && !isAdmin) return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
        await handleLocationUpdate(value);
        changedFields.push(field);
        continue;
      }

      if (adminOnlyUpdatable.has(field)) {
        if (!isAdmin) return res.status(403).json({ success: false, message: `Only admins can change ${field}` });
        hostel[field] = value;
        changedFields.push(field);
        continue;
      }

      const isAllowedOwnerField = ownerUpdatable.has(field) || ['name', 'description', 'phone', 'email', 'whatsappNumber', 'foodMenuDescription'].includes(field);
      if (!isAllowedOwnerField && !isAdmin) {
        return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
      }

      if (!isAdmin && !isAllowedOwnerField) {
        return res.status(403).json({ success: false, message: `You cannot edit ${field}` });
      }

      hostel[field] = value;
      changedFields.push(field);
    }

    if (req.body.foodMenuDescription !== undefined && req.body.foodItems === undefined && Array.isArray(hostel.foodItems)) {
      hostel.foodMenuDescription = req.body.foodMenuDescription || hostel.foodItems.map(item => `${item.name}: ${item.daysServing.join(', ')}`).join(' | ');
    }

    await hostel.save();
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'hostel_updated',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      changes: { before, after: hostel.toObject(), fieldsChanged: changedFields },
      description: `Hostel updated by ${req.user.role}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(200).json({ success: true, message: 'Hostel updated successfully', hostel });
  } catch (error) {
    logger.error('Update hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating hostel' });
  }
};

exports.deleteHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!['superadmin', 'founder'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only superadmins and founders can delete hostels' });

    // Delete all associated images from Supabase Storage
    if (Array.isArray(hostel.images) && hostel.images.length > 0) {
      for (const image of hostel.images) {
        try {
          if (image?.url) {
            await deleteSupabaseImageByUrl(image.url);
          }
        } catch (error) {
          logger.warn(`Failed to delete image ${image?.url} for hostel ${hostel.name}:`, error.message);
        }
      }
    }

    await hostel.deleteOne();
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'hostel_deleted',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: `Hostel deleted by ${req.user.role}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });
    res.status(200).json({ success: true, message: 'Hostel deleted successfully' });
  } catch (error) {
    logger.error('Delete hostel error:', error);
    res.status(500).json({ success: false, message: 'Error deleting hostel' });
  }
};

exports.verifyHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId).populate('owner');
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });

    const { status = 'verified', rejectionReason } = req.body;
    if (!['verified', 'rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Status must be verified or rejected' });

    if (status === 'verified') {
      hostel.verificationStatus = { status: 'verified', verifiedBy: req.user._id, verificationDate: new Date() };
      hostel.isApproved = true;
      hostel.isLive = true;
      hostel.isVerified = true;
      hostel.activeDate = hostel.activeDate || new Date();
      if (hostel.owner?.email) await sendTemplateEmail(hostel.owner.email, emailTemplates.hostelVerified(hostel.owner.firstName || hostel.owner.email, hostel.name, hostel.hostelCode));
    } else {
      hostel.verificationStatus = { status: 'rejected', verifiedBy: req.user._id, verificationDate: new Date(), rejectionReason };
      hostel.isApproved = false;
      hostel.isLive = false;
      hostel.isVerified = false;
      if (hostel.owner?.email) await sendTemplateEmail(hostel.owner.email, emailTemplates.hostelRejected(hostel.owner.firstName || hostel.owner.email, hostel.name, rejectionReason || 'No reason provided'));
    }

    await hostel.save();
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: status === 'verified' ? 'hostel_verified' : 'hostel_rejected',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: `Hostel ${status}: ${hostel.name}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(200).json({ success: true, message: `Hostel ${status} successfully`, hostel });
  } catch (error) {
    logger.error('Verify hostel error:', error);
    res.status(500).json({ success: false, message: 'Error verifying hostel' });
  }
};

exports.rejectHostel = async (req, res) => {
  req.body.status = 'rejected';
  return exports.verifyHostel(req, res);
};

exports.updateHostelSeats = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot update seats for this hostel' });

    const { roomTypeIndex, bedsAvailable, bedConfigurationIndex, availableBeds } = req.body;
    if (roomTypeIndex === undefined || bedsAvailable === undefined) return res.status(400).json({ success: false, message: 'roomTypeIndex and bedsAvailable are required' });

    const room = hostel.roomTypes[roomTypeIndex];
    if (!room) return res.status(404).json({ success: false, message: 'Room type not found' });

    const totalBeds = Number(room.totalBeds || room.capacity || 0);
    const nextAvailable = Number(bedsAvailable);
    if (nextAvailable < 0 || (totalBeds && nextAvailable > totalBeds)) return res.status(400).json({ success: false, message: 'Cannot have more available beds than total beds' });

    room.bedsAvailable = nextAvailable;
    if (bedConfigurationIndex !== undefined && room.bedConfigurations?.[bedConfigurationIndex]) {
      room.bedConfigurations[bedConfigurationIndex].availableBeds = Number(availableBeds ?? nextAvailable);
    }

    await hostel.save();
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'hostel_updated',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      description: `Seat availability updated by ${req.user.role}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });
    res.status(200).json({ success: true, message: 'Seat availability updated', hostel });
  } catch (error) {
    logger.error('Update hostel seats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating seat availability' });
  }
};

exports.createReview = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { rating, reviewText } = req.body;
    if (!rating) return res.status(400).json({ success: false, message: 'rating is required' });

    const existing = await Review.findOne({ hostel: hostel._id, user: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: "You've already reviewed this hostel." });

    const review = await Review.create({ hostel: hostel._id, user: req.user._id, rating: Number(rating), reviewText: reviewText || '' });
    const reviews = await Review.find({ hostel: hostel._id });
    const total = reviews.reduce((sum, item) => sum + item.rating, 0);
    const average = Number((total / reviews.length).toFixed(1));
    hostel.ratings = { average, total, count: reviews.length };
    hostel.averageRating = average;
    hostel.ratingCount = reviews.length;
    await hostel.save();

    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'rating_created',
      resourceType: 'rating',
      resourceId: review._id,
      resourceName: hostel.name,
      description: `Review added for ${hostel.name}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(201).json({ success: true, message: 'Review added successfully', review, hostel });
  } catch (error) {
    logger.error('Create review error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating review' });
  }
};

exports.getHostelReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const reviews = await Review.find({ hostel: req.params.hostelId }).populate('user', 'firstName lastName email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    const total = await Review.countDocuments({ hostel: req.params.hostelId });
    res.status(200).json({ success: true, page: Number(page), limit: Number(limit), total, reviews });
  } catch (error) {
    logger.error('Get hostel reviews error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching reviews' });
  }
};

exports.mergeHostels = async (req, res) => {
  try {
    const { sourceHostelId, targetHostelId } = req.body;
    if (!['superadmin', 'founder'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only superadmins and founders can merge hostels' });
    if (!sourceHostelId || !targetHostelId) return res.status(400).json({ success: false, message: 'sourceHostelId and targetHostelId are required' });

    const [source, target] = await Promise.all([
      resolveHostelByIdentifier(sourceHostelId),
      resolveHostelByIdentifier(targetHostelId)
    ]);
    if (!source || !target) return res.status(404).json({ success: false, message: 'One or both hostels were not found' });

    const bookingUpdate = await Booking.updateMany({ hostel: source._id }, { hostel: target._id });
    const reviewUpdate = await Review.updateMany({ hostel: source._id }, { hostel: target._id });

    if (source.owner) {
      const owner = await User.findById(source.owner);
      if (owner) {
        owner.associatedHostels = (owner.associatedHostels || []).filter((id) => id.toString() !== source._id.toString());
        await owner.save();
      }
    }

    await source.deleteOne();
    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_merged',
      resourceType: 'hostel',
      resourceId: target._id,
      resourceName: target.name,
      description: `Merged hostel ${source.name} into ${target.name}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(200).json({ success: true, message: 'Hostels merged successfully', stats: { bookingsTransferred: bookingUpdate.modifiedCount, reviewsTransferred: reviewUpdate.modifiedCount } });
  } catch (error) {
    logger.error('Merge hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error merging hostels' });
  }
};

exports.getHostelBookings = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot view bookings for this hostel' });

    const { status, page = 1, limit = 20 } = req.query;
    const query = { hostel: hostel._id };
    if (status) query.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const bookings = await Booking.find(query).populate('student', 'firstName lastName email phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    const total = await Booking.countDocuments(query);
    res.status(200).json({ success: true, page: Number(page), limit: Number(limit), total, count: bookings.length, bookings });
  } catch (error) {
    logger.error('Get hostel bookings error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching bookings' });
  }
};

exports.getHostelBookingStats = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    const { canManage } = getHostelPermission(req.user, hostel);
    if (!canManage) return res.status(403).json({ success: false, message: 'You cannot view booking stats for this hostel' });

    const statuses = ['pending', 'confirmed', 'cancelled', 'completed'];
    const stats = {};
    await Promise.all(statuses.map(async (item) => {
      stats[item] = await Booking.countDocuments({ hostel: hostel._id, status: item });
    }));
    res.status(200).json({ success: true, hostelId: hostel._id, stats });
  } catch (error) {
    logger.error('Get hostel booking stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching booking stats' });
  }
};

exports.activateHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can activate hostels' });
    hostel.activeDate = new Date();
    hostel.isLive = true;
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel activated successfully', hostel });
  } catch (error) {
    logger.error('Activate hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error activating hostel' });
  }
};

exports.deactivateHostel = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can deactivate hostels' });
    hostel.isLive = false;
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel deactivated successfully', hostel });
  } catch (error) {
    logger.error('Deactivate hostel error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deactivating hostel' });
  }
};

exports.setHostelExpiry = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can set hostel expiry' });
    const { expiryDate } = req.body;
    if (!expiryDate) return res.status(400).json({ success: false, message: 'expiryDate is required' });
    hostel.expiryDate = new Date(expiryDate);
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel expiry date updated', hostel });
  } catch (error) {
    logger.error('Set hostel expiry error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error setting expiry date' });
  }
};

exports.changeHostelOwner = async (req, res) => {
  try {
    const hostel = await resolveHostelByIdentifier(req.params.hostelId);
    if (!hostel) {
      return res.status(404).json({
        success: false,
        message: `Hostel lookup failed: '${req.params.hostelId}' could not be resolved as a hostel ID or hostel code.`
      });
    }

    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only an admin, superadmin, or founder can change hostel ownership.'
      });
    }

    const { newOwnerId, ownerId, email, phone } = req.body;
    const ownerReference = newOwnerId || ownerId || email || phone;

    if (!ownerReference) {
      return res.status(400).json({
        success: false,
        message: 'No owner target was supplied. Send a user ID, email, or phone in newOwnerId/ownerId/email/phone.',
        reason: 'missing_owner_identifier'
      });
    }

    const ownerQuery = mongoose.Types.ObjectId.isValid(String(ownerReference))
      ? { _id: ownerReference }
      : (typeof ownerReference === 'string' && ownerReference.includes('@'))
        ? { email: String(ownerReference).trim().toLowerCase() }
        : { phone: String(ownerReference).trim() };

    const newOwner = await User.findOne(ownerQuery);
    if (!newOwner) {
      return res.status(404).json({
        success: false,
        message: `Owner lookup failed: no user was found for '${ownerReference}'.`,
        reason: 'owner_not_found'
      });
    }

    if (['agent', 'admin', 'superadmin', 'founder'].includes(newOwner.role)) {
      return res.status(400).json({
        success: false,
        message: `This action failed because '${newOwner.email}' is a ${newOwner.role} account. Only student/hostelowner-style account types can be assigned as owners.`,
        reason: 'invalid_owner_role'
      });
    }

    if (hostel.owner) {
      const previousOwner = await User.findById(hostel.owner);
      if (previousOwner) {
        previousOwner.associatedHostels = (previousOwner.associatedHostels || []).filter((id) => id.toString() !== hostel._id.toString());
        await previousOwner.save();
      }
    }

    newOwner.associatedHostels = newOwner.associatedHostels || [];
    if (!newOwner.associatedHostels.includes(hostel._id)) newOwner.associatedHostels.push(hostel._id);
    newOwner.role = newOwner.role === 'student' ? 'hostelowner' : newOwner.role;
    await newOwner.save();

    hostel.owner = newOwner._id;
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel owner changed successfully', hostel });
  } catch (error) {
    logger.error('Change hostel owner error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error changing ownership' });
  }
};

exports.associateHostelToUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { hostelId } = req.body;
    if (!hostelId) return res.status(400).json({ success: false, message: 'hostelId is required' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can associate hostels' });

    const hostel = await resolveHostelByIdentifier(hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: `Hostel not found: ${hostelId}` });
    if (hostel.owner) return res.status(400).json({ success: false, message: 'This hostel already has an owner' });
    if (['agent', 'admin', 'superadmin', 'founder'].includes(user.role)) return res.status(400).json({ success: false, message: 'Selected user cannot be assigned as hostel owner' });

    user.associatedHostels = user.associatedHostels || [];
    if (!user.associatedHostels.includes(hostel._id)) user.associatedHostels.push(hostel._id);
    user.role = user.role === 'student' ? 'hostelowner' : user.role;
    await user.save();

    hostel.owner = user._id;
    hostel.isApproved = true;
    hostel.isLive = true;
    hostel.isVerified = true;
    hostel.verificationStatus = { status: 'verified', verifiedBy: req.user._id, verificationDate: new Date() };
    await hostel.save();
    res.status(200).json({ success: true, message: 'Hostel associated with owner successfully', hostel, user });
  } catch (error) {
    logger.error('Associate hostel to user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error associating hostel' });
  }
};

exports.getUserHostels = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const hostels = await Hostel.find({ owner: user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: hostels.length, hostels });
  } catch (error) {
    logger.error('Get user hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching user hostels' });
  }
};

exports.bulkUpdateHostels = async (req, res) => {
  try {
    const { hostelIds, updates } = req.body;
    if (!Array.isArray(hostelIds) || !hostelIds.length) return res.status(400).json({ success: false, message: 'hostelIds array is required' });
    if (!isAdminRole(req.user.role)) return res.status(403).json({ success: false, message: 'Only admins can bulk update hostels' });

    const allowedFields = ['rank', 'isSponsored', 'isSponsorFeatured', 'sponsorPackage', 'isApproved', 'isVerified', 'isLive', 'expiryDate', 'verificationStatus'];
    const payload = {};
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (allowedFields.includes(key)) payload[key] = value;
    });

    const result = await Hostel.updateMany({ _id: { $in: hostelIds } }, { $set: payload });
    res.status(200).json({ success: true, message: 'Bulk update completed', updatedCount: result.modifiedCount });
  } catch (error) {
    logger.error('Bulk update hostels error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error bulk updating hostels' });
  }
};

exports.validateUserHostelLink = async (req, res) => {
  try {
    const { hostelId, ownerId, email, phone } = req.body;
    if (!hostelId || (!ownerId && !email && !phone)) {
      return res.status(400).json({ success: false, message: 'hostelId and either ownerId, email, or phone are required' });
    }

    const hostel = await resolveHostelByIdentifier(hostelId);
    if (!hostel) return res.status(404).json({ success: false, message: `Hostel not found: ${hostelId}` });

    const populatedHostel = await Hostel.findById(hostel._id).populate('owner', 'firstName lastName email phone role');

    const user = ownerId
      ? await User.findById(ownerId)
      : await User.findOne({ $or: [{ email: String(email).trim().toLowerCase() }, { phone: String(phone).trim() }] });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.status(200).json({ success: true, valid: true, hostel: populatedHostel, user });
  } catch (error) {
    logger.error('Validate user hostel link error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error validating link' });
  }
};

exports.assignHostelOwner = async (req, res) => {
  try {
    const { ownerId, studentId, hostelId, hostelCode } = req.body;
    const targetIdentifier = ownerId || studentId;

    if (!targetIdentifier || (!hostelId && !hostelCode)) {
      return res.status(400).json({ success: false, message: 'User identifier (ID/email/phone) and hostelId or hostelCode are required' });
    }

    if (typeof targetIdentifier === 'string' && targetIdentifier.includes('@')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
      if (!emailRegex.test(targetIdentifier.trim())) {
        return res.status(400).json({ success: false, message: 'Invalid email address provided for user lookup.' });
      }
    }

    const userQuery = mongoose.Types.ObjectId.isValid(targetIdentifier)
      ? { _id: targetIdentifier }
      : (typeof targetIdentifier === 'string' && targetIdentifier.includes('@'))
        ? { email: targetIdentifier.trim().toLowerCase() }
        : { phone: String(targetIdentifier).trim() };

    const owner = await User.findOne(userQuery);

    let hostel = null;
    const hostelReference = hostelId || hostelCode;

    if (hostelId && mongoose.Types.ObjectId.isValid(String(hostelId))) {
      hostel = await Hostel.findById(hostelId);
    } else if (hostelCode) {
      hostel = await Hostel.findOne({ hostelCode: String(hostelCode).trim().toUpperCase() });
    } else if (hostelId) {
      hostel = await Hostel.findOne({ hostelCode: String(hostelId).trim().toUpperCase() });
    }

    if (!owner) return res.status(404).json({ success: false, message: 'User not found with provided identifier.' });
    if (!hostel) return res.status(404).json({ success: false, message: `Hostel not found: ${hostelReference}` });

    if (['agent', 'admin', 'superadmin', 'founder'].includes(owner.role)) {
      return res.status(400).json({ success: false, message: `Validation Error: Account with role '${owner.role.toUpperCase()}' cannot be assigned as a hostel owner.` });
    }

    if (hostel.owner) {
      const errMsg = hostel.owner.toString() === owner._id.toString()
        ? `Conflict: Hostel "${hostel.name}" is already attached to this owner account.`
        : `Conflict: Hostel already has an assigned owner. Detach owner first.`;
      return res.status(400).json({ success: false, message: errMsg });
    }

    if (owner.role === 'student') owner.role = 'hostelowner';
    owner.associatedHostels = owner.associatedHostels || [];
    if (!owner.associatedHostels.includes(hostel._id)) owner.associatedHostels.push(hostel._id);
    await owner.save();

    hostel.owner = owner._id;
    await hostel.save();

    await createAuditLog({
      user: req.user._id,
      userRole: req.user.role,
      action: 'user_merged',
      resourceType: 'hostel',
      resourceId: hostel._id,
      resourceName: hostel.name,
      status: 'success',
      description: `Hostel "${hostel.name}" successfully assigned to owner ${owner.email}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return res.status(200).json({ success: true, message: 'Hostel successfully associated with owner!', data: { hostel, owner } });
  } catch (error) {
    logger.error('Assign hostel owner error:', error);
    res.status(500).json({ success: false, message: 'Server error while assigning owner: ' + error.message });
  }
};

exports.mergeStudentToHostel = exports.assignHostelOwner;

exports.lookupUserByEmail = async (req, res) => {
  try {
    const { email, phone } = req.query;
    if (!email && !phone) {
      return res.status(400).json({ success: false, message: 'Email or phone query parameter is required' });
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
      if (!emailRegex.test(String(email).trim())) {
        return res.status(400).json({ success: false, message: 'Invalid email address provided.' });
      }
    }

    const query = {};
    if (email) query.email = String(email).trim().toLowerCase();
    if (phone) query.phone = String(phone).trim();

    const user = await User.findOne(query).select('firstName lastName email phone role associatedHostels');
    if (!user) {
      const identifier = email || phone;
      return res.status(404).json({ success: false, message: `User with identifier "${identifier}" does not exist in the system.` });
    }

    return res.status(200).json({ success: true, user });
  } catch (error) {
    logger.error('Error looking up user:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};