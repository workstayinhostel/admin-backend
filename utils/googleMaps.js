const axios = require('axios');
const logger = require('../config/logger');

const GOOGLE_MAPS_HOSTS = new Set([
  'goo.gl',
  'maps.app.goo.gl',
  'maps.google.com',
  'google.com',
  'www.google.com'
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

const isAllowedGoogleMapsHost = (hostname) => {
  const normalizedHost = hostname.toLowerCase();
  return GOOGLE_MAPS_HOSTS.has(normalizedHost)
    || /^www\.google\.[a-z]{2,}(?:\.[a-z]{2})?$/.test(normalizedHost)
    || /^maps\.google\.[a-z]{2,}(?:\.[a-z]{2})?$/.test(normalizedHost);
};

const validateGoogleMapsUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('googleMapsUrl must be a valid Google Maps link');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('googleMapsUrl must be a valid Google Maps link');
  }

  const hasMapsPath = /^\/maps(?:\/|$)/i.test(url.pathname);
  const isShortMapsLink = url.hostname.toLowerCase() === 'maps.app.goo.gl'
    || (url.hostname.toLowerCase() === 'goo.gl' && /^\/maps(?:\/|$)/i.test(url.pathname));
  const hasCoordinateQuery = ['q', 'query', 'll', 'center', 'destination']
    .some((key) => /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(url.searchParams.get(key) || ''));

  if (url.protocol !== 'https:' || !isAllowedGoogleMapsHost(url.hostname)
    || url.username || url.password || (url.port && url.port !== '443')
    || !(hasMapsPath || isShortMapsLink || hasCoordinateQuery
      || url.hostname.toLowerCase() === 'maps.google.com')) {
    throw new Error('googleMapsUrl must be a valid Google Maps link');
  }

  return url;
};

const resolveShortGoogleMapsLink = async (initialUrl) => {
  let targetUrl = initialUrl;
  let responseBody = '';

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response;
    try {
      response = await axios.get(targetUrl.href, {
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 400,
        timeout: 8000,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
    } catch (error) {
      logger.warn(`Unable to resolve shortened Google Maps link: ${error.message}`);
      break;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      responseBody = typeof response.data === 'string' ? response.data : '';
      break;
    }

    if (!response.headers.location || redirects === MAX_REDIRECTS) {
      break;
    }

    let redirectUrl;
    try {
      redirectUrl = new URL(response.headers.location, targetUrl);
    } catch {
      break;
    }

    if (redirectUrl.protocol !== 'https:' || !isAllowedGoogleMapsHost(redirectUrl.hostname)
      || redirectUrl.username || redirectUrl.password
      || (redirectUrl.port && redirectUrl.port !== '443')) {
      break;
    }
    targetUrl = redirectUrl;
  }

  return { targetUrl, responseBody };
};

const extractCoordinatesFromGoogleMaps = async (link) => {
  if (!link) return [0, 0];

  let targetUrl;
  try {
    targetUrl = new URL(String(link).trim());
  } catch {
    return [0, 0];
  }
  if (!/^https?:$/.test(targetUrl.protocol)) return [0, 0];

  let responseBody = '';
  const isShortGoogleLink = /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(targetUrl.href);
  if (isShortGoogleLink) {
    const resolved = await resolveShortGoogleMapsLink(targetUrl);
    targetUrl = resolved.targetUrl;
    responseBody = resolved.responseBody;
  }

  const patterns = [
    { regex: /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' },
    { regex: /!2d(-?\d{1,3}(?:\.\d+)?)(?:![^!]+)*?!3d(-?\d{1,3}(?:\.\d+)?)/i, order: 'lng-lat' },
    { regex: /!3d(-?\d{1,3}(?:\.\d+)?)(?:![^!]+)*?!2d(-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' },
    { regex: /[?&](?:q|query|ll|center)=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' },
    { regex: /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,[-\d.]+z?)?(?:[/?#]|$)/i, order: 'lat-lng' },
    { regex: /(?:lat|latitude)[=,:](-?\d{1,3}(?:\.\d+)?)[^\d-]*?(?:lng|lon|longitude)[=,:](-?\d{1,3}(?:\.\d+)?)/i, order: 'lat-lng' }
  ];

  for (const searchableText of [targetUrl.href, responseBody]) {
    const normalizedText = searchableText.replace(/%21/g, '!').replace(/%2C/gi, ',');

    for (const { regex, order } of patterns) {
      const match = normalizedText.match(regex);
      if (!match) continue;

      const latitude = Number(order === 'lng-lat' ? match[2] : match[1]);
      const longitude = Number(order === 'lng-lat' ? match[1] : match[2] || match[1]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= -90 && latitude <= 90
        && longitude >= -180 && longitude <= 180) {
        return [longitude, latitude];
      }
    }
  }

  return [0, 0];
};

module.exports = { extractCoordinatesFromGoogleMaps, validateGoogleMapsUrl };
