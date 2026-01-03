// src/routes/index.js
// Route aggregator

const healthRoutes = require('./health.routes');
const tokensRoutes = require('./tokens.routes');
const pricesRoutes = require('./prices.routes');
const monitoringRoutes = require('./monitoring.routes');

module.exports = {
  healthRoutes,
  tokensRoutes,
  pricesRoutes,
  monitoringRoutes
};
