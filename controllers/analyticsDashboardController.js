const Visit = require('../models/Visit');

const SUPPORTED_RANGES = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'all'];
const NEPAL_TIMEZONE = 'Asia/Kathmandu';
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const NEPAL_TIMEZONE_LABEL = 'Nepal Time (Kathmandu)';
const NEPAL_UTC_OFFSET = '+05:45';

const nepalParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NEPAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(new Date(date));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  };
};

const nepalDayStart = (date) => {
  const parts = nepalParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - NEPAL_OFFSET_MS);
};

const getPeriod = (range) => {
  const now = new Date();
  const today = nepalDayStart(now);
  const weekday = nepalParts(today).weekday;
  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));

  if (range === 'today') {
    const end = new Date(today); end.setUTCDate(end.getUTCDate() + 1);
    const previous = new Date(today); previous.setUTCDate(previous.getUTCDate() - 1);
    return { start: today, end, previousStart: previous, previousEnd: today, comparison: 'yesterday', bucket: 'hour' };
  }
  if (range === 'yesterday') {
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(today);
    const previousStart = new Date(start); previousStart.setUTCDate(previousStart.getUTCDate() - 1);
    return { start, end, previousStart, previousEnd: start, comparison: 'day_before_yesterday', bucket: 'hour' };
  }
  if (range === 'this_week' || range === 'last_week') {
    const start = new Date(weekStart);
    if (range === 'last_week') start.setUTCDate(start.getUTCDate() - 7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    const previousStart = new Date(start); previousStart.setUTCDate(previousStart.getUTCDate() - 7);
    return { start, end, previousStart, previousEnd: start, comparison: 'last_week', bucket: 'day' };
  }
  if (range === 'this_month' || range === 'last_month') {
    const offset = range === 'last_month' ? -1 : 0;
    const parts = nepalParts(now);
    const startParts = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1));
    const endParts = new Date(Date.UTC(startParts.getUTCFullYear(), startParts.getUTCMonth() + 1, 1));
    const previousParts = new Date(Date.UTC(startParts.getUTCFullYear(), startParts.getUTCMonth() - 1, 1));
    const start = new Date(startParts.getTime() - NEPAL_OFFSET_MS);
    const end = new Date(endParts.getTime() - NEPAL_OFFSET_MS);
    const previousStart = new Date(previousParts.getTime() - NEPAL_OFFSET_MS);
    return { start, end, previousStart, previousEnd: start, comparison: 'last_month', bucket: 'day' };
  }
  if (range === 'this_year') {
    const year = nepalParts(now).year;
    const start = new Date(Date.UTC(year, 0, 1) - NEPAL_OFFSET_MS);
    const end = new Date(Date.UTC(year + 1, 0, 1) - NEPAL_OFFSET_MS);
    const previousStart = new Date(Date.UTC(year - 1, 0, 1) - NEPAL_OFFSET_MS);
    return { start, end, previousStart, previousEnd: start, comparison: 'last_year', bucket: 'month' };
  }
  return { start: null, end: null, comparison: null, bucket: 'day' };
};

const eventValue = { $toLower: { $ifNull: ['$event', ''] } };
const eventTime = { $ifNull: ['$createdAt', '$hourBucket'] };
const isVisit = { $in: [eventValue, ['page_visit', 'app_visit']] };
const isHeartbeat = { $in: [eventValue, ['page_heartbeat', 'app_heartbeat']] };
const operatingSystem = { $toLower: { $ifNull: ['$operatingSystem', ''] } };
const platform = { $toLower: { $ifNull: ['$platform', ''] } };
const deviceClass = {
  $cond: [
    {
      $or: [
        { $regexMatch: { input: operatingSystem, regex: 'windows|mac|macos|linux|ubuntu|chrome os' } },
        { $regexMatch: { input: platform, regex: 'win|mac|linux|x11' } }
      ]
    },
    'desktop',
    'mobile'
  ]
};
const heartbeatSeconds = {
  $convert: {
    input: { $ifNull: ['$heartbeatDuration', { $ifNull: ['$durationSeconds', { $ifNull: ['$duration', { $ifNull: ['$engagementTime', { $divide: [{ $ifNull: ['$heartbeatDurationMs', 0] }, 1000] }] }] }] }] },
    to: 'double', onError: 0, onNull: 0
  }
};

const timelineKey = (bucket) => ({
  $dateToString: {
    date: eventTime,
    format: bucket === 'hour' ? '%Y-%m-%dT%H' : bucket === 'month' ? '%Y-%m' : '%Y-%m-%d',
    timezone: NEPAL_TIMEZONE
  }
});

const javascriptTimelineKey = (date, bucket) => {
  const parts = nepalParts(date);
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (bucket === 'month') return dateKey.slice(0, 7);
  if (bucket === 'hour') {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: NEPAL_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(date));
    return `${dateKey}T${hour}`;
  }
  return dateKey;
};

const aggregatePeriod = async (period) => {
  const match = {};
  if (period.start) {
    match.$expr = { $and: [{ $gte: [eventTime, period.start] }, { $lt: [eventTime, period.end] }] };
  }

  const [result] = await Visit.aggregate([
    { $match: match },
    { $project: { identifier: 1, deviceType: 1, deviceClass, event: eventValue, timelineKey: timelineKey(period.bucket), isVisit, isHeartbeat, heartbeatSeconds } },
    { $facet: {
      timeline: [
        { $match: { isVisit: true } },
        { $group: { _id: { identifier: '$identifier', event: '$event', timelineKey: '$timelineKey' } } },
        { $project: { _id: 0, event: '$_id.event', timelineKey: '$_id.timelineKey' } },
        { $group: { _id: '$timelineKey', pageVisits: { $sum: { $cond: [{ $eq: ['$event', 'page_visit'] }, 1, 0] } }, appVisits: { $sum: { $cond: [{ $eq: ['$event', 'app_visit'] }, 1, 0] } } } },
        { $project: { _id: 0, timeKey: '$_id', pageVisits: 1, appVisits: 1 } }
      ],
      devices: [
        { $match: { isVisit: true } },
        { $group: { _id: '$identifier', deviceClass: { $first: '$deviceClass' } } },
        { $group: { _id: '$deviceClass', count: { $sum: 1 } } },
        { $project: { _id: 0, deviceType: '$_id', count: 1 } }
      ],
      summary: [
        { $match: { isVisit: true } },
        { $group: { _id: '$identifier', events: { $addToSet: '$event' }, deviceClass: { $first: '$deviceClass' } } },
        { $group: { _id: null, totalVisits: { $sum: 1 }, phoneVisits: { $sum: { $cond: [{ $eq: ['$deviceClass', 'mobile'] }, 1, 0] } }, desktopVisits: { $sum: { $cond: [{ $eq: ['$deviceClass', 'desktop'] }, 1, 0] } }, totalPageVisits: { $sum: { $cond: [{ $in: ['page_visit', '$events'] }, 1, 0] } }, totalAppVisits: { $sum: { $cond: [{ $in: ['app_visit', '$events'] }, 1, 0] } } } }
      ],
      heartbeat: [
        { $match: { isHeartbeat: true } },
        { $group: { _id: null, pageHeartbeatTotal: { $sum: { $cond: [{ $eq: ['$event', 'page_heartbeat'] }, '$heartbeatSeconds', 0] } }, appHeartbeatTotal: { $sum: { $cond: [{ $eq: ['$event', 'app_heartbeat'] }, '$heartbeatSeconds', 0] } } } }
      ]
    } }
  ]);

  const summary = result?.summary?.[0] || {};
  const heartbeat = result?.heartbeat?.[0] || {};
  return {
    timeline: result?.timeline || [],
    devices: result?.devices || [],
    summary: {
      totalVisits: summary.totalVisits || 0,
      phoneVisits: summary.phoneVisits || 0,
      desktopVisits: summary.desktopVisits || 0,
      totalPageVisits: summary.totalPageVisits || 0,
      totalAppVisits: summary.totalAppVisits || 0,
      pageHeartbeatTotal: heartbeat.pageHeartbeatTotal || 0,
      appHeartbeatTotal: heartbeat.appHeartbeatTotal || 0
    }
  };
};

const labelsFor = (period, timeline) => {
  if (!period.start) return timeline.map((item) => ({ key: item.timeKey, timeLabel: item.timeKey }));
  const labels = [];
  const cursor = new Date(period.start);
  while (cursor < period.end) {
    const key = javascriptTimelineKey(cursor, period.bucket);
    labels.push({ key, timeLabel: period.bucket === 'hour' ? `${key.slice(11, 13)}:00` : key });
    if (period.bucket === 'hour') cursor.setUTCHours(cursor.getUTCHours() + 1);
    else if (period.bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return labels;
};

const percentageChange = (current, previous) => ({
  current,
  previous,
  changePercent: previous === 0 ? (current === 0 ? 0 : 100) : Number((((current - previous) / previous) * 100).toFixed(2)),
  direction: current > previous ? 'up' : current < previous ? 'down' : 'unchanged'
});

const deviceBreakdown = (aggregate) => {
  const values = new Map(aggregate.devices.map((item) => [item.deviceType, item.count]));
  return { desktopCount: values.get('desktop') || 0, mobileCount: values.get('mobile') || 0, tabletCount: values.get('tablet') || 0, unknownCount: values.get('unknown') || 0 };
};

exports.getAnalyticsDashboard = async (req, res) => {
  const range = String(req.query.range || 'today').toLowerCase();
  if (!SUPPORTED_RANGES.includes(range)) return res.status(400).json({ success: false, message: `range must be one of: ${SUPPORTED_RANGES.join(', ')}` });

  try {
    const period = getPeriod(range);
    const current = await aggregatePeriod(period);
    const map = new Map(current.timeline.map((item) => [item.timeKey, item]));
    const lineChart = labelsFor(period, current.timeline).map(({ key, timeLabel }) => {
      const item = map.get(key) || {};
      return { timeLabel, pageVisits: item.pageVisits || 0, appVisits: item.appVisits || 0 };
    });
    let comparison = null;
    if (period.comparison) {
      const previous = await aggregatePeriod({ ...period, start: period.previousStart, end: period.previousEnd });
      comparison = {
        period: period.comparison,
        totalVisits: percentageChange(current.summary.totalVisits, previous.summary.totalVisits),
        totalPageVisits: percentageChange(current.summary.totalPageVisits, previous.summary.totalPageVisits),
        totalAppVisits: percentageChange(current.summary.totalAppVisits, previous.summary.totalAppVisits),
        pageHeartbeatTotal: percentageChange(current.summary.pageHeartbeatTotal, previous.summary.pageHeartbeatTotal),
        appHeartbeatTotal: percentageChange(current.summary.appHeartbeatTotal, previous.summary.appHeartbeatTotal)
      };
    }

    return res.json({
      success: true,
      data: {
        range,
        timezone: NEPAL_TIMEZONE,
        timezoneLabel: NEPAL_TIMEZONE_LABEL,
        utcOffset: NEPAL_UTC_OFFSET,
        filters: [
          { value: 'today', label: 'Today', comparison: 'Yesterday' },
          { value: 'yesterday', label: 'Yesterday', comparison: 'Day Before Yesterday' },
          { value: 'this_week', label: 'This Week', comparison: 'Last Week' },
          { value: 'last_week', label: 'Last Week', comparison: 'Previous Week' },
          { value: 'this_month', label: 'This Month', comparison: 'Last Month' },
          { value: 'last_month', label: 'Last Month', comparison: 'Previous Month' },
          { value: 'this_year', label: 'This Year', comparison: 'Last Year' },
          { value: 'all', label: 'All Time', comparison: null }
        ],
        lineChart,
        deviceBreakdown: deviceBreakdown(current),
        summary: current.summary,
        comparison
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching analytics dashboard' });
  }
};
