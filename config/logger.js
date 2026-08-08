const winston = require('winston');

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

const logger = winston.createLogger({
  levels: logLevels,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
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
            output += ` \nMetadata: ${JSON.stringify(filteredMeta, null, 2)}`;
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