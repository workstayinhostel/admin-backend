const rateStore = new Map();
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // one hour

const trimKey = (key) => key.replace(/\s+/g, '').toLowerCase();
const now = () => Date.now();

const getBucket = (id, windowMs) => {
  const bucket = rateStore.get(id);
  if (!bucket || now() - bucket.start >= windowMs) {
    const fresh = { count: 0, start: now() };
    rateStore.set(id, fresh);
    return fresh;
  }
  return bucket;
};

const recordAttempt = (id, max, windowMs) => {
  const bucket = getBucket(id, windowMs);
  bucket.count += 1;
  const remaining = Math.max(0, max - bucket.count);
  const retryAfterMs = Math.max(0, bucket.start + windowMs - now());
  return {
    count: bucket.count,
    remaining,
    retryAfterMs,
    limitExceeded: bucket.count > max
  };
};

const buildError = (max, retryAfterMs) => {
  const retrySeconds = Math.ceil(retryAfterMs / 1000);
  const hours = Math.floor(retryAfterMs / 3600000);
  const minutes = Math.ceil((retryAfterMs % 3600000) / 60000) || 1;
  const retryText = hours > 0 ? `${hours} hour(s)` : `${minutes} minute(s)`;

  return {
    success: false,
    message: `Max attempts reached. Try again after ${retryText}.`,
    retryAfter: retrySeconds,
    status: 429
  };
};

const createRateLimiter = ({ name, max, windowMs, getIdentifier }) => {
  return (req, res, next) => {
    const email = String(getIdentifier(req) || 'unknown_email').trim().toLowerCase();
    const emailKey = trimKey(`${name}:email:${email}`);

    const emailResult = recordAttempt(emailKey, max, windowMs);

    if (emailResult.limitExceeded) {
      const error = buildError(max, emailResult.retryAfterMs);
      res.setHeader('Retry-After', Math.ceil(emailResult.retryAfterMs / 1000));
      return res.status(429).json(error);
    }

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', emailResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((now() + emailResult.retryAfterMs) / 1000));
    next();
  };
};

const loginLimiter = createRateLimiter({
  name: 'login',
  max: 4,
  windowMs: 60 * 60 * 1000,
  getIdentifier: (req) => req.body?.email || req.query?.email || req.headers['x-user-email'] || req.user?.email
});

const forgotPasswordLimiter = createRateLimiter({
  name: 'forgot_password',
  max: 4,
  windowMs: 60 * 60 * 1000,
  getIdentifier: (req) => req.body?.email || req.query?.email || req.headers['x-user-email']
});

const resetPasswordLimiter = createRateLimiter({
  name: 'reset_password',
  max: 3,
  windowMs: 60 * 60 * 1000,
  getIdentifier: (req) => req.body?.email || req.body?.emailAddress || req.query?.email || req.headers['x-user-email']
});

setInterval(() => {
  const cutoff = now() - CLEANUP_INTERVAL_MS;
  for (const [key, bucket] of rateStore.entries()) {
    if (bucket.start < cutoff) {
      rateStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

module.exports = {
  loginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter
};
