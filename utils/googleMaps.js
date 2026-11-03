const axios = require('axios');

const GOOGLE_MAPS_HOSTS = new Set([
  'goo.gl',
  'maps.app.goo.gl',
  'maps.google.com',
  'google.com',
  'www.google.com'
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

class GoogleMapsLinkError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'GoogleMapsLinkError';
    this.statusCode = statusCode;
  }
}

const hasCoordinates = (value) => {
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
};

const validateGoogleMapsUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new GoogleMapsLinkError('googleMapsUrl must be a valid Google Maps link');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new GoogleMapsLinkError('googleMapsUrl must be a valid Google Maps link');
  }

  const isAllowedHost = GOOGLE_MAPS_HOSTS.has(url.hostname.toLowerCase());
  const hasMapsPath = /^\/maps(?:\/|$)/i.test(url.pathname);
  const hasCoordinateQuery = ['q', 'query', 'll', 'center', 'destination']
    .some((key) => hasCoordinates(url.searchParams.get(key) || ''));
  const isMapsHost = url.hostname.toLowerCase() === 'maps.google.com'
    || url.hostname.toLowerCase() === 'maps.app.goo.gl'
    || (url.hostname.toLowerCase() === 'goo.gl' && /^\/maps(?:\/|$)/i.test(url.pathname));

  if (url.protocol !== 'https:' || !isAllowedHost || url.username || url.password
    || (url.port && url.port !== '443')
    || !(isMapsHost || hasMapsPath || hasCoordinateQuery)) {
    throw new GoogleMapsLinkError('googleMapsUrl must be a valid Google Maps link');
  }

  return url;
};

const extractCoordinates = (url) => {
  let decodedPathAndQuery;
  try {
    decodedPathAndQuery = decodeURIComponent(`${url.pathname}${url.search}`);
  } catch {
    decodedPathAndQuery = `${url.pathname}${url.search}`;
  }

  const dataCoordinates = decodedPathAndQuery.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (dataCoordinates) {
    const coordinates = hasCoordinates(`${dataCoordinates[1]},${dataCoordinates[2]}`);
    if (coordinates) {
      return coordinates;
    }
  }

  const pathCoordinates = decodedPathAndQuery.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (pathCoordinates) {
    const coordinates = hasCoordinates(`${pathCoordinates[1]},${pathCoordinates[2]}`);
    if (coordinates) {
      return coordinates;
    }
  }

  for (const key of ['q', 'query', 'll', 'center', 'destination']) {
    const coordinates = hasCoordinates(url.searchParams.get(key) || '');
    if (coordinates) {
      return coordinates;
    }
  }

  return null;
};

const resolveGoogleMapsCoordinates = async (value) => {
  let currentUrl = validateGoogleMapsUrl(value);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const coordinates = extractCoordinates(currentUrl);
    if (coordinates) {
      return coordinates;
    }

    if (redirects === MAX_REDIRECTS) {
      break;
    }

    let response;
    try {
      response = await axios.get(currentUrl.href, {
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        timeout: 5000,
        responseType: 'text',
        validateStatus: () => true
      });
    } catch {
      throw new GoogleMapsLinkError('Unable to resolve the Google Maps link', 422);
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      break;
    }

    if (!response.headers.location) {
      throw new GoogleMapsLinkError('Google Maps link returned an invalid redirect', 422);
    }

    let redirectUrl;
    try {
      redirectUrl = new URL(response.headers.location, currentUrl);
    } catch {
      throw new GoogleMapsLinkError('Google Maps link returned an invalid redirect', 422);
    }
    currentUrl = validateGoogleMapsUrl(redirectUrl.href);
  }

  throw new GoogleMapsLinkError('No coordinates could be extracted from this Google Maps link', 422);
};

module.exports = { resolveGoogleMapsCoordinates };
