// src/middlewares/logger.js
// Request logging middleware

const logger = (metricsCollector) => {
  return (req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);

    // Track API request in metrics
    if (metricsCollector) {
      metricsCollector.increment('apiRequests');
    }

    next();
  };
};

module.exports = logger;
