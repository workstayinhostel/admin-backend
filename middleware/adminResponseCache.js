const logger = require('../config/logger');

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();

const createCacheKey = (req) => `${req.user._id}:${req.user.role}:${req.originalUrl}`;

const removeExpiredEntries = () => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
};

const cacheResponse = (req, res, next) => {
  const key = createCacheKey(req);
  const cached = cache.get(key);

  res.set('Cache-Control', 'private, no-store');
  if (cached && cached.expiresAt > Date.now()) {
    res.set('X-Cache', 'HIT');
    logger.info(`${req.method} ${req.originalUrl} ${cached.statusCode} OK cache sent`);
    return res.status(cached.statusCode).json(cached.body);
  }
  if (cached) cache.delete(key);

  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) {
      removeExpiredEntries();
      if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
        cache.delete(cache.keys().next().value);
      }
      cache.delete(key);
      cache.set(key, { statusCode: res.statusCode, body, expiresAt: Date.now() + CACHE_TTL_MS });
      res.set('X-Cache', 'MISS');
    }
    return sendJson(body);
  };

  next();
};

const clearAllCache = () => {
  const clearedEntries = cache.size;
  cache.clear();
  return clearedEntries;
};

const invalidateCacheOnWrite = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.once('finish', clearAllCache);
  }
  next();
};

module.exports = { cacheResponse, clearAllCache, invalidateCacheOnWrite };
