// src/routes/prices.routes.js
// Price query routes

const express = require('express');
const router = express.Router();

module.exports = (priceMonitor) => {
  // Get all cached prices
  router.get('/', (req, res) => {
    const prices = priceMonitor?.getCachedPrices() || [];

    res.json({
      success: true,
      count: prices.length,
      prices,
      cacheInfo: {
        message: 'These are the latest cached prices',
        updateFrequency: 'Real-time via blockchain events'
      }
    });
  });

  // Get specific token price (from cache)
  router.get('/:token', (req, res) => {
    const tokenAddress = req.params.token;

    try {
      const price = priceMonitor?.getTokenPrice(tokenAddress);

      if (price) {
        res.json({
          success: true,
          cached: true,
          ...price
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Token not found or not monitored'
        });
      }
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};
