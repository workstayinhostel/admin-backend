const winston = require('winston');
const { format } = winston;

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

winston.addColors(colors);

const sanitizeForLogging = (value, seen = new WeakSet()) => {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);

  if (value instanceof Error) {
    const result = { name: value.name, message: value.message };
    if (value.stack) result.stack = value.stack;
    if (value.code !== undefined) result.code = sanitizeForLogging(value.code, seen);
    if (value.response) {
      result.response = {
        status: value.response.status,
        data: sanitizeForLogging(value.response.data, seen)
      };
    }
    return result;
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogging(item, seen));
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['request', 'socket', 'agent', 'config'].includes(key.toLowerCase())) continue;
    result[key] = sanitizeForLogging(item, seen);
  }
  return result;
};

const safeObjects = format((info) => {
  for (const [key, value] of Object.entries(info)) {
    info[key] = sanitizeForLogging(value);
  }
  return info;
});

const logger = winston.createLogger({
  levels: logLevels,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    safeObjects(),
    winston.format.json()
  ),
  defaultMeta: { service: 'stayinhostel-backend' },
  transports: [
    // Clean console output without messy browser metadata strings
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
          let output = `${timestamp} [${level}]: ${message}`;
          
          // Filter out repetitive service tags and verbose browser/client fingerprints
          const filteredMeta = { ...meta };
          delete filteredMeta.service;
          delete filteredMeta.userAgent;
          
          if (Object.keys(filteredMeta).length > 0) {
            try {
              output += ` \nMetadata: ${JSON.stringify(filteredMeta, null, 2)}`;
            } catch (error) {
              output += ` \nMetadata: ${String(error.message || 'Unable to serialize log metadata')}`;
            }
          }
          
          if (stack) {
            output += `\n${stack}`;
          }
          
          return output;
        })
      )
    }),
    // Structured JSON error logs saved to file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    // Structured JSON combined logs saved to file
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

module.exports = logger;