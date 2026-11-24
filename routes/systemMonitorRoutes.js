const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const { protect, isAdminLevel, checkPasswordChange } = require('../middleware/auth');
const { supabase } = require('../config/supabase');
const DailyApiStats = require('../models/DailyApiStats');
const logger = require('../config/logger');

const router = express.Router();
const RENDER_API_URL = 'https://api.render.com/v1';
const STORAGE_LIMIT_MB = 1024;
const MONGODB_LIMIT_MB = 512;
const EGRESS_LIMIT_GB = 5;
const STORAGE_IMAGE_PREFIX = 'stayinhostel/hostels';
const OWNER_CACHE_TTL_MS = 60 * 60 * 1000;
const RENDER_METRICS_CACHE_TTL_MS = 20 * 1000;
const SYSTEM_USAGE_STREAM_INTERVAL_MS = 30 * 1000;
const LOG_TIMEFRAMES = { '30m': 30 * 60, '1h': 60 * 60, '24h': 24 * 60 * 60 };
const ownerCache = new Map();
const renderServiceCache = new Map();
const renderServiceRequests = new Map();
const adminOnly = [protect, checkPasswordChange, isAdminLevel];
const egressInfo = {
  monthlyLimitGb: EGRESS_LIMIT_GB,
  note: 'Monthly egress is not available through the free-tier API. Check usage in your Supabase dashboard.',
  dashboardUrl: 'https://supabase.com/dashboard'
};

const todayUtc = () => new Date().toISOString().slice(0, 10);
const mb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(2));
const getSafeError = (error) => ({
  message: String(
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'Request failed'
  ).slice(0, 300),
  ...(Number.isInteger(error?.response?.status) ? { status: error.response.status } : {}),
  ...(typeof error?.code === 'string' ? { code: error.code } : {})
});
const failure = (error) => ({ error: getSafeError(error).message });

const renderCredentials = (target) => {
  const isPublic = target === 'public';
  return {
    apiKey: process.env[isPublic ? 'RENDER_PUBLIC_API_KEY' : 'RENDER_ADMIN_API_KEY'],
    serviceId: process.env[isPublic ? 'RENDER_PUBLIC_SERVICE_ID' : 'RENDER_ADMIN_SERVICE_ID']
  };
};

const renderGet = (apiKey, path, params) => axios.get(`${RENDER_API_URL}${path}`, {
  headers: { Authorization: `Bearer ${apiKey}` },
  params,
  timeout: 10000
});

const normalizeMetric = (payload, name) => {
  const series = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.metrics) ? payload.metrics
      : Array.isArray(payload?.data) ? payload.data : [];
  const points = series.flatMap((item) => {
    if (Array.isArray(item?.values)) return item.values;
    return item && (item.timestamp !== undefined || item.value !== undefined) ? [item] : [];
  }).map((point) => {
    if (Array.isArray(point)) return { timestamp: point[0], value: Number(point[1]) };
    return { timestamp: point.timestamp, value: Number(point.value) };
  }).filter((point) => Number.isFinite(point.value));

  if (!points.length) return null;
  points.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const latest = points[points.length - 1];
  const isByteMetric = name === 'memory' || name === 'bandwidth';
  const toDisplayValue = (value) => isByteMetric ? mb(value) : Number(value.toFixed(2));
  return {
    value: toDisplayValue(latest.value),
    unit: isByteMetric ? 'MB' : '%',
    timestamp: latest.timestamp,
    points: points.map((point) => ({
      timestamp: point.timestamp,
      value: toDisplayValue(point.value)
    }))
  };
};

const getMetric = async (apiKey, serviceId, name, target, cachedMetric) => {
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    const response = await renderGet(apiKey, `/metrics/${name}`, {
      resource: serviceId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      resolutionSeconds: 60
    });
    const metric = normalizeMetric(response.data, name);
    if (!metric) {
      if (process.env.NODE_ENV !== 'production') {
        let sample;
        try {
          sample = JSON.stringify(response.data).slice(0, 300);
        } catch (_) {
          sample = '[unserializable response]';
        }
        logger.warn('Render metric returned an unexpected payload', {
          target, metric: name, status: response.status, sample
        });
      }
      return {
        successful: true,
        value: cachedMetric?.available
          ? cachedMetric
          : { available: false, message: 'No metric samples returned by Render' }
      };
    }
    return { successful: true, value: { available: true, data: metric } };
  } catch (error) {
    const status = error.response?.status;
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Render metric request failed', {
        target, metric: name, ...getSafeError(error)
      });
    }
    if (status === 403 || status === 404) {
      return {
        successful: true,
        value: {
          available: false,
          message: status === 403 ? 'Requires Render Pro plan' : 'Available on Render Dashboard'
        }
      };
    }
    if (cachedMetric?.available && (!status || status === 429 || status >= 500)) {
      return { successful: false, value: cachedMetric };
    }
    return {
      successful: false,
      value: {
        available: false,
        message: status === 429 || !status || status >= 500
          ? 'Temporarily unavailable; showing the last successful metric when available'
          : 'Render metric unavailable'
      }
    };
  }
};

const fetchRenderService = async (target, apiKey, serviceId, cachedValue) => {
  const deployAndMetrics = await Promise.allSettled([
    renderGet(apiKey, `/services/${encodeURIComponent(serviceId)}`),
    renderGet(apiKey, `/services/${encodeURIComponent(serviceId)}/deploys`, { limit: 1 }),
    Promise.all([
      getMetric(apiKey, serviceId, 'cpu', target, cachedValue?.resources?.cpu),
      getMetric(apiKey, serviceId, 'memory', target, cachedValue?.resources?.memory),
      getMetric(apiKey, serviceId, 'bandwidth', target, cachedValue?.resources?.bandwidth)
    ])
  ]);
  const [serviceResult, deploymentResult, metricsResult] = deployAndMetrics;

  let service = null;
  if (serviceResult.status === 'fulfilled') {
    const response = serviceResult.value.data;
    const item = response.service || response;
    const serviceDetails = item.serviceDetails || {};
    service = {
      name: item.name,
      status: item.suspended === 'not_suspended' ? 'Online'
        : item.suspended === 'suspended' ? 'Suspended' : 'Unknown',
      region: serviceDetails.region || item.region || null,
      plan: serviceDetails.plan || item.plan || null,
      ownerId: item.ownerId || null,
      dashboardUrl: item.dashboardUrl || `https://dashboard.render.com/web/${encodeURIComponent(serviceId)}`
    };
  } else {
    service = cachedValue?.service || null;
  }

  const deploymentData = deploymentResult.status === 'fulfilled' ? deploymentResult.value.data : null;
  const deployments = Array.isArray(deploymentData) ? deploymentData : deploymentData?.deploys || [];
  const latest = deployments[0]?.deploy || deployments[0];
  const deployment = latest ? {
    status: latest.status,
    commitMessage: latest.commit?.message || null,
    finishedAt: latest.finishedAt || null
  } : cachedValue?.deployment || {
    status: null,
    error: deploymentResult.status === 'rejected' ? 'Deployment temporarily unavailable' : null
  };
  const metricResults = metricsResult.status === 'fulfilled' ? metricsResult.value : [];
  const resources = metricsResult.status === 'fulfilled'
    ? {
      cpu: metricResults[0].value,
      memory: metricResults[1].value,
      bandwidth: metricResults[2].value
    }
    : cachedValue?.resources || {
      cpu: { available: false, message: 'Metrics temporarily unavailable' },
      memory: { available: false, message: 'Metrics temporarily unavailable' },
      bandwidth: { available: false, message: 'Metrics temporarily unavailable' }
    };

  const value = {
    available: Boolean(service),
    ...(service ? { service } : { error: 'Render service details temporarily unavailable' }),
    deployment,
    resources
  };

  const successfulFetch = serviceResult.status === 'fulfilled'
    || deploymentResult.status === 'fulfilled'
    || metricResults.some((metric) => metric.successful);
  if (successfulFetch) {
    renderServiceCache.set(serviceId, { value, expiresAt: Date.now() + RENDER_METRICS_CACHE_TTL_MS });
  }
  return value;
};

const getRenderService = async (target) => {
  const { apiKey, serviceId } = renderCredentials(target);
  if (!apiKey || !serviceId) {
    return { available: false, error: 'Render credentials are not configured for this service' };
  }

  const cached = renderServiceCache.get(serviceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pendingRequest = renderServiceRequests.get(serviceId);
  if (pendingRequest) return pendingRequest;

  const request = fetchRenderService(target, apiKey, serviceId, cached?.value);
  renderServiceRequests.set(serviceId, request);
  try {
    return await request;
  } finally {
    if (renderServiceRequests.get(serviceId) === request) {
      renderServiceRequests.delete(serviceId);
    }
  }
};

const getSupabaseStorage = async () => {
  if (!supabase) return { available: false, error: 'Supabase credentials are not configured', egress: egressInfo };

  const { data, error } = await supabase.rpc('get_hostel_storage_metrics');
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] || {} : data || {};
  const usedMb = Number(row.used_mb || 0);
  return {
    available: true,
    total_images: Number(row.total_images || 0),
    used_mb: usedMb,
    remaining_mb: Number(row.remaining_mb ?? Math.max(STORAGE_LIMIT_MB - usedMb, 0)),
    limit_mb: Number(row.limit_mb || STORAGE_LIMIT_MB),
    percentage_used: Number(row.percentage_used ?? ((usedMb / STORAGE_LIMIT_MB) * 100)),
    average_image_kb: Number(row.average_image_kb || 0),
    largest_images: Array.isArray(row.largest_images) ? row.largest_images.slice(0, 5) : [],
    egress: egressInfo
  };
};

const getMongoStorage = async () => {
  const stats = await mongoose.connection.db.stats();
  return {
    available: true,
    data_size_mb: mb(stats.dataSize || 0),
    storage_size_mb: mb(stats.storageSize || 0),
    used_mb: mb(stats.dataSize || 0),
    limit_mb: MONGODB_LIMIT_MB
  };
};

const getDailyRequests = async () => {
  const entries = await DailyApiStats.find({ date: todayUtc() }).lean();
  const stats = Object.fromEntries(entries.map((entry) => [entry.service || 'admin', entry]));
  const makeSummary = (service) => ({
    totalRequests: stats[service]?.totalRequests || 0,
    errorCount: stats[service]?.errorCount || 0
  });
  return {
    date: todayUtc(),
    public: makeSummary('public'),
    admin: makeSummary('admin')
  };
};

const buildSystemUsage = async () => {
  const results = await Promise.allSettled([
    getSupabaseStorage(),
    getRenderService('public'),
    getRenderService('admin'),
    getMongoStorage(),
    getDailyRequests()
  ]);
  const valueOrError = (result) => result.status === 'fulfilled'
    ? result.value
    : { available: false, ...failure(result.reason) };

  return {
    generatedAt: new Date().toISOString(),
    supabase: results[0].status === 'fulfilled'
      ? results[0].value
      : { available: false, ...failure(results[0].reason), egress: egressInfo },
    render: {
      public: valueOrError(results[1]),
      admin: valueOrError(results[2])
    },
    mongodb: valueOrError(results[3]),
    dailyApi: valueOrError(results[4])
  };
};

router.get('/system-usage', ...adminOnly, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, usage: await buildSystemUsage() });
  } catch (error) {
    logger.error('System usage endpoint failed', getSafeError(error));
    res.status(500).json({ success: false, message: 'Unable to load system usage' });
  }
});

router.get('/system-images', ...adminOnly, async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, message: 'Supabase credentials are not configured' });
  }

  try {
    const { data, error } = await supabase.storage
      .from('STAYINHOSTEL-HOSTELIMAGES')
      .list(STORAGE_IMAGE_PREFIX, {
        limit: 25,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) throw error;

    const images = (data || [])
      .filter((file) => file.id || file.metadata)
      .map((file) => {
        const path = `${STORAGE_IMAGE_PREFIX}/${file.name}`;
        const { data: publicData } = supabase.storage
          .from('STAYINHOSTEL-HOSTELIMAGES')
          .getPublicUrl(path);
        return {
          name: file.name,
          path,
          url: publicData.publicUrl,
          size_bytes: Number(file.metadata?.size || 0),
          created_at: file.created_at || file.updated_at || null
        };
      });

    res.set('Cache-Control', 'no-store');
    res.json({ success: true, images });
  } catch (error) {
    logger.error('Recent Supabase images request failed', getSafeError(error));
    res.status(502).json({ success: false, message: 'Unable to load recent Supabase images' });
  }
});

router.get('/system-usage/stream', ...adminOnly, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 60000\n\n');

  let inFlight = false;
  let closed = false;
  let interval;
  const sendUsage = async () => {
    if (inFlight || closed || res.destroyed || res.writableEnded) return;
    inFlight = true;
    try {
      const payload = JSON.stringify(await buildSystemUsage());
      if (!closed && !res.destroyed && !res.writableEnded) {
        res.write(`event: usage\ndata: ${payload}\n\n`);
      }
    } catch (error) {
      logger.error('System usage stream update failed', getSafeError(error));
      if (!closed && !res.destroyed && !res.writableEnded) {
        try {
          res.write(`event: error\ndata: ${JSON.stringify({ message: 'Unable to refresh system usage' })}\n\n`);
        } catch (writeError) {
          logger.warn('System usage stream write failed', getSafeError(writeError));
        }
      }
    } finally {
      inFlight = false;
    }
  };

  const disconnect = () => {
    if (closed) return;
    closed = true;
    if (interval) clearInterval(interval);
  };
  interval = setInterval(() => {
    sendUsage().catch((error) => {
      logger.error('System usage stream interval failed', getSafeError(error));
    });
  }, SYSTEM_USAGE_STREAM_INTERVAL_MS);
  req.on('aborted', disconnect);
  res.on('close', disconnect);
  sendUsage().catch((error) => {
    logger.error('Initial system usage stream update failed', getSafeError(error));
  });
});

const getOwnerId = async (target, apiKey, serviceId) => {
  const cached = ownerCache.get(target);
  if (cached && cached.serviceId === serviceId && cached.expiresAt > Date.now()) return cached.ownerId;

  const { data } = await renderGet(apiKey, `/services/${encodeURIComponent(serviceId)}`);
  const ownerId = data.service?.ownerId || data.ownerId;
  if (!ownerId) throw new Error('Render service response did not include ownerId');
  ownerCache.set(target, { serviceId, ownerId, expiresAt: Date.now() + OWNER_CACHE_TTL_MS });
  return ownerId;
};

router.get('/render-logs', ...adminOnly, async (req, res) => {
  const target = req.query.target;
  if (!['public', 'admin'].includes(target)) {
    return res.status(400).json({ success: false, message: 'target must be public or admin' });
  }

  const timeframe = req.query.timeframe || '30m';
  if (!Object.prototype.hasOwnProperty.call(LOG_TIMEFRAMES, timeframe)) {
    return res.status(400).json({ success: false, message: 'timeframe must be 30m, 1h, or 24h' });
  }
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 25) : 25;
  const { apiKey, serviceId } = renderCredentials(target);
  if (!apiKey || !serviceId) {
    return res.status(503).json({ success: false, message: `Render credentials are not configured for ${target}` });
  }

  try {
    const ownerId = await getOwnerId(target, apiKey, serviceId);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - LOG_TIMEFRAMES[timeframe] * 1000);
    const { data } = await renderGet(apiKey, '/logs', {
      ownerId,
      resource: serviceId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      direction: 'backward',
      limit
    });
    const rawEntries = Array.isArray(data) ? data : data?.logs || data?.entries || [];
    const entries = rawEntries.map((entry) => entry?.log || entry).filter(Boolean);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      target,
      timeframe,
      logs: entries.map((entry) => ({
        timestamp: entry.timestamp || entry.time || null,
        message: entry.message || entry.text || '',
        level: entry.level || entry.type || 'info'
      }))
    });
  } catch (error) {
    const safeError = getSafeError(error);
    logger.error(`Render log fetch failed for ${target}`, safeError);
    res.status(error.response?.status === 403 ? 403 : 502).json({
      success: false,
      message: error.response?.status === 403
        ? 'Render log access is unavailable for this API key or plan'
        : safeError.status
          ? `Render rejected the log request (${safeError.status})${safeError.message ? `: ${safeError.message}` : ''}`
          : 'Unable to fetch Render logs'
    });
  }
});

module.exports = router;
