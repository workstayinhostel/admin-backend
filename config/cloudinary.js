let cloudinary;
const logger = require('./logger');

try {
  cloudinary = require('cloudinary').v2;
} catch (error) {
  logger.warn('Cloudinary package is not installed. Install it with npm install cloudinary to enable image uploads.');
  cloudinary = null;
}

const isConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isConfigured && cloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
} else {
  logger.warn('Cloudinary credentials not configured. Image uploads will be disabled until environment variables are set.');
}

/**
 * Upload single file to Cloudinary
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} folder - Cloudinary folder path
 * @param {string} fileName - File name
 * @returns {Promise}
 */
const uploadFile = async (fileBuffer, folder, fileName) => {
  if (!isConfigured || !cloudinary) {
    throw new Error('Cloudinary is not configured');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `stayinhostel/${folder}`,
        public_id: fileName,
        resource_type: 'auto',
        quality: 'auto',
        fetch_format: 'auto'
      },
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          logger.info(`File uploaded to Cloudinary: ${result.secure_url}`);
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

/**
 * Upload multiple files
 * @param {Array} files - Array of file buffers
 * @param {string} folder - Cloudinary folder path
 * @returns {Promise}
 */
const uploadMultipleFiles = async (files, folder) => {
  try {
    const uploadPromises = files.map((file, index) => {
      const baseName = file.originalname ? file.originalname.replace(/\.[^/.]+$/, '') : 'image';
      const safeName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 30);
      return uploadFile(file.buffer, folder, `${safeName}_${Date.now()}_${index}`);
    });

    const results = await Promise.all(uploadPromises);
    return results;
  } catch (error) {
    logger.error('Multiple file upload error:', error);
    throw error;
  }
};

/**
 * Delete file from Cloudinary
 * @param {string} publicId - File public ID
 * @returns {Promise}
 */
const deleteFile = async (publicId) => {
  if (!isConfigured || !cloudinary) {
    throw new Error('Cloudinary is not configured');
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    logger.info(`File deleted from Cloudinary: ${publicId}`);
    return result;
  } catch (error) {
    logger.error('Cloudinary delete error:', error);
    throw error;
  }
};

/**
 * Optimize image URL
 * @param {string} url - Original URL
 * @param {number} width - Width (optional)
 * @param {number} height - Height (optional)
 * @returns {string}
 */
const optimizeImageUrl = (url, width = null, height = null) => {
  if (!url || typeof url !== 'string') return null;

  let optimizedUrl = url;

  if (optimizedUrl.includes('/upload/')) {
    optimizedUrl = optimizedUrl.replace('/upload/', '/upload/c_limit,f_auto,q_auto/');
  }

  if (width || height) {
    const dimensions = `c_fill,w_${width || 'auto'},h_${height || 'auto'},q_auto,f_auto`;
    optimizedUrl = optimizedUrl.replace('/upload/', `/upload/${dimensions}/`);
  }

  return optimizedUrl;
};

module.exports = {
  cloudinary,
  uploadFile,
  uploadMultipleFiles,
  deleteFile,
  optimizeImageUrl
};