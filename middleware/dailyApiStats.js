const DailyApiStats = require('../models/DailyApiStats');
const logger = require('../config/logger');

const trackDailyApiStats = (req, res, next) => {
  res.once('finish', () => {
    const date = new Date().toISOString().slice(0, 10);
    const update = { $inc: { totalRequests: 1 } };
    if (res.statusCode >= 400) update.$inc.errorCount = 1;

    const filter = { date, service: 'admin' };
    DailyApiStats.updateOne(filter, update, { upsert: true }).catch(async (error) => {
      if (error.code === 11000) {
        try {
          await DailyApiStats.updateOne(filter, update);
          return;
        } catch (retryError) {
          logger.error('Daily API stats update retry failed:', retryError);
          return;
        }
      }
      logger.error('Daily API stats update failed:', error);
    });
  });

  next();
};

module.exports = trackDailyApiStats;
