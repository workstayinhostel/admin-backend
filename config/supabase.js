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

const getStorageBaseName = (hostelName, originalName, index) => {
  const explicitName = String(hostelName || '').trim();
  const fromOriginalName = String(originalName || '')
    .replace(/\.[^/.]+$/, '')
    .trim();

  if (explicitName && explicitName.toLowerCase() !== 'hostel') {
    return slugifyForStorage(explicitName);
  }

  if (fromOriginalName) {
    return slugifyForStorage(fromOriginalName || `image-${index + 1}`);
  }

  return `image-${index + 1}`;
};

/**
 * Compresses image buffer targeting 100KB - 200KB with quality compression only (no ratio scaling)
 * @param {Buffer} buffer - Original image buffer
 * @returns {Promise<Buffer>} - Compressed image buffer
 */
const compressImageToTargetSize = async (buffer) => {
  try {
    if (!buffer || buffer.length <= 150 * 1024) {
      return buffer;
    }

    let quality = 75;
    let compressedBuffer = buffer;

    while (quality >= 30) {
      compressedBuffer = await sharp(buffer)
        .webp({ quality, nearLossless: false, effort: 6 })
        .toBuffer();

      if (compressedBuffer.length <= 150 * 1024) {
        return compressedBuffer;
      }

      quality -= 8;
    }

    return compressedBuffer;
  } catch (error) {
    logger.error('Image compression error:', error);
    return buffer;
  }
};

/**
 * Upload single file to Supabase Storage with aggressive retry logic
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} folder - Storage folder path
 * @param {string} fileName - File name
 * @param {number} retries - Number of retry attempts (default: 5)
 * @returns {Promise<Object>} - Result object matching structure
 */
const uploadFile = async (fileBuffer, folder, fileName, retries = 5) => {
  if (!isConfigured || !supabase) {
    throw new Error('Supabase is not configured');
  }

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Compress image to target 100KB - 150KB range
      const compressedBuffer = await compressImageToTargetSize(fileBuffer);
      const filePath = `stayinhostel/${folder}/${fileName}.webp`;

      logger.debug(`[UPLOAD ATTEMPT ${attempt}/${retries}] Uploading ${filePath} (${(compressedBuffer.length / 1024).toFixed(2)}KB)`);

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, compressedBuffer, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '3600'
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      logger.info(`✓ File uploaded successfully on attempt ${attempt}: ${publicUrl}`);
      return { secure_url: publicUrl, url: publicUrl, path: filePath };
    } catch (error) {
      lastError = error;
      logger.warn(`✗ Upload attempt ${attempt}/${retries} failed for ${fileName}: ${error.message}`);
      
      if (attempt < retries) {
        // Longer exponential backoff: 800ms, 1.6s, 3.2s, 6.4s, 12.8s
        const delay = Math.pow(2, attempt - 1) * 800;
        logger.debug(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(`✗ Upload FAILED for ${fileName} after ${retries} attempts: ${lastError?.message}`);
  throw new Error(`Failed to upload ${fileName} after ${retries} attempts: ${lastError?.message}`);
};

/**
 * Upload multiple files sequentially with AGGRESSIVE retry logic
 * Saves images with hostel name + numbered format: hostelname(1).webp, hostelname(2).webp, etc.
 * Continues uploading ALL images even if some fail
 * @param {Array} files - Array of files from multer
 * @param {string} folder - Storage folder path
 * @param {string} hostelName - Hostel name for folder organization & file naming
 * @returns {Promise<Object>} - { successful: [], failed: [] }
 */
const uploadMultipleFiles = async (files, folder, hostelName = '') => {
  try {
    const successful = [];
    const failed = [];

    logger.info(`Starting image upload: ${files.length} file(s)${hostelName ? ` for "${hostelName}"` : ''}`);

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const imageNumber = index + 1;
      const baseName = getStorageBaseName(hostelName, file.originalname, index);
      const uniqueFileName = `${baseName}(${imageNumber})`;

      try {
        const result = await uploadFile(file.buffer, folder, uniqueFileName, 5);
        successful.push(result);
        logger.info(`Image ${imageNumber}/${files.length} uploaded successfully`);
      } catch (error) {
        logger.warn(`Image ${imageNumber}/${files.length} failed: ${file.originalname} - ${error.message}`);
        failed.push({
          fileName: uniqueFileName,
          originalName: file.originalname,
          error: error.message,
          fileIndex: imageNumber,
          totalFiles: files.length
        });
        // CONTINUE WITH NEXT FILE instead of throwing
      }
    }

    logger.info(`Image upload summary: ${successful.length}/${files.length} successful, ${failed.length} failed`);

    return { successful, failed };
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