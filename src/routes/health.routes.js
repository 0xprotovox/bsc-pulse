// src/routes/health.routes.js
// Health check routes

const express = require('express');
const router = express.Router();
const { SERVICE } = require('../utils/constants');

module.exports = (priceMonitor, connectionManager, startTime) => {
  // Health check with metrics
  router.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const metrics = priceMonitor?.getMetrics() || {};
    const connections = connectionManager.getStats();

    res.json({
      status: 'healthy',
      uptime: `${uptime}s`,
      service: SERVICE.NAME,
      version: SERVICE.VERSION,
      metrics: {
        ...metrics,
        activeSockets: connections.totalConnections,
        monitoredTokens: priceMonitor?.getMonitoredTokens()?.length || 0,
      },
      timestamp: new Date().toISOString()
    });
  });

  return router;
};
