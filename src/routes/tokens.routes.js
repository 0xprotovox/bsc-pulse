// src/routes/tokens.routes.js
// Token routes for the Price Listener API

const express = require('express');
const config = require('../config/tokens.config');

/**
 * Create tokens routes
 * @param {Object} priceMonitor - Price monitor instance
 */
module.exports = function(priceMonitor) {
  const router = express.Router();

  // GET /api/tokens - List all configured tokens
  router.get('/', (req, res) => {
    const tokens = Object.entries(config.tokens).map(([address, tokenConfig]) => ({
      address,
      symbol: tokenConfig.symbol,
      name: tokenConfig.name,
      decimals: tokenConfig.decimals,
      poolCount: tokenConfig.pools?.length || 0
    }));

    res.json({
      success: true,
      tokens,
      count: tokens.length
    });
  });

  // GET /api/tokens/monitored - List actively monitored tokens
  router.get('/monitored', (req, res) => {
    const monitored = priceMonitor?.getMonitoredTokens() || [];

    res.json({
      success: true,
      tokens: monitored,
      count: monitored.length
    });
  });

  // GET /api/tokens/:address - Get token info
  router.get('/:address', (req, res) => {
    const { address } = req.params;
    const tokenConfig = config.tokens[address.toLowerCase()];

    if (!tokenConfig) {
      return res.status(404).json({
        success: false,
        error: 'Token not found in configuration'
      });
    }

    res.json({
      success: true,
      token: {
        address,
        ...tokenConfig
      }
    });
  });

  return router;
};
