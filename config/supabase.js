const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const crypto = require('crypto');
const logger = require('./logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isConfigured = Boolean(supabaseUrl && supabaseKey);

let supabase = null;
if (isConfigured) {
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  logger.warn('Supabase credentials not configured. Image uploads will be disabled until environment variables are set.');
}

const BUCKET_NAME = 'STAYINHOSTEL-HOSTELIMAGES';

const slugifyForStorage = (value) => {
  return String(value || 'hostel')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'hostel';
};

/**
 * Compresses image buffer targeting 100KB - 200KB with quality compression only (no ratio scaling)
 * @param {Buffer} buffer - Original image buffer
 * @returns {Promise<Buffer>} - Compressed image buffer
 */
const compressImageToTargetSize = async (buffer) => {
  try {
    if (!buffer || buffer.length <= 200 * 1024) {
      return buffer;
    }

    let quality = 80;
    let compressedBuffer = buffer;

    while (quality >= 30) {
      compressedBuffer = await sharp(buffer)
        .webp({ quality, nearLossless: false, effort: 4 })
        .toBuffer();

      if (compressedBuffer.length <= 200 * 1024) {
        return compressedBuffer;
      }

      quality -= 10;
    }

    return compressedBuffer;
  } catch (error) {
    logger.error('Image compression error:', error);
    return buffer;
  }
};

/**
 * Upload single file to Supabase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} folder - Storage folder path
 * @param {string} fileName - File name
 * @returns {Promise<Object>} - Result object matching structure
 */
const uploadFile = async (fileBuffer, folder, fileName) => {
  if (!isConfigured || !supabase) {
    throw new Error('Supabase is not configured');
  }

  // Compress image to target 100KB - 200KB range
  const compressedBuffer = await compressImageToTargetSize(fileBuffer);
  const filePath = `stayinhostel/${folder}/${fileName}.webp`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, compressedBuffer, {
      contentType: 'image/webp',
      upsert: true
    });

  if (uploadError) {
    logger.error('Supabase upload error:', uploadError);
    throw uploadError;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  logger.info(`File uploaded to Supabase: ${publicUrl}`);
  return { secure_url: publicUrl, url: publicUrl, path: filePath };
};

/**
 * Upload multiple files with unique collision-free naming
 * @param {Array} files - Array of files from multer
 * @param {string} folder - Storage folder path
 * @returns {Promise<Array>}
 */
const uploadMultipleFiles = async (files, folder, hostelName = '') => {
  try {
    const slug = slugifyForStorage(hostelName);
    const uploadPromises = files.map((file, index) => {
      const originalBaseName = file.originalname ? file.originalname.replace(/\.[^/.]+$/, '') : 'image';
      const safeOriginal = originalBaseName.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 30) || 'image';

      let uniqueFileName;
      if (slug && slug !== 'hostel') {
        const isFirstFile = index === 0;
        uniqueFileName = isFirstFile ? `${slug}` : `${slug}-${index + 1}`;
      } else {
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        uniqueFileName = `${safeOriginal}_${uniqueSuffix}`;
      }

      return uploadFile(file.buffer, folder, uniqueFileName);
    });

    return await Promise.all(uploadPromises);
  } catch (error) {
    logger.error('Multiple file upload error:', error);
    throw error;
  }
};

/**
 * Delete file from Supabase Storage using public URL or file path
 * @param {string} fileUrlOrPath - Public URL or file storage path
 * @returns {Promise<boolean>}
 */
const deleteFile = async (fileUrlOrPath) => {
  if (!isConfigured || !supabase) {
    throw new Error('Supabase is not configured');
  }

  try {
    let filePath = fileUrlOrPath;
    if (fileUrlOrPath.includes(`/storage/v1/object/public/${BUCKET_NAME}/`)) {
      filePath = fileUrlOrPath.split(`/storage/v1/object/public/${BUCKET_NAME}/`)[1];
    }

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) throw error;
    logger.info(`File deleted from Supabase: ${filePath}`);
    return true;
  } catch (error) {
    logger.error('Supabase delete error:', error);
    throw error;
  }
};

/**
 * Helper to match old helper function naming for frontend URLs
 */
const optimizeImageUrl = (url) => {
  return url; // Supabase handles compression at upload time, so URL passes through cleanly
};

module.exports = {
  supabase,
  uploadFile,
  uploadMultipleFiles,
  deleteFile,
  optimizeImageUrl
};