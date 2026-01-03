// src/routes/monitoring.routes.js
// Dynamic monitoring routes

const express = require('express');
const router = express.Router();
const { validateDynamicTokens, validateTokenAddress } = require('../middlewares/validator');
const config = require('../config/tokens.config');

module.exports = (priceMonitor) => {
  // Add token to monitoring (from config)
  router.post('/', validateTokenAddress, async (req, res) => {
    const { tokenAddress } = req.body;

    try {
      const price = await priceMonitor.addToken(tokenAddress);

      if (price) {
        res.json({
          success: true,
          message: 'Token added to monitoring',
          price
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Failed to add token. Check if it\'s configured in tokens.config.js'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Add tokens dynamically (with full configuration)
  router.post('/monitor-dynamic', validateDynamicTokens, async (req, res) => {
    const { tokens } = req.body;

    try {
      const results = await priceMonitor.addDynamicTokens(tokens);

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      res.json({
        success: true,
        message: `Added ${successful.length}/${tokens.length} tokens to monitoring`,
        results,
        summary: {
          total: tokens.length,
          successful: successful.length,
          failed: failed.length
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get system metrics
  router.get('/metrics', (req, res) => {
    const metrics = priceMonitor?.getMetrics() || {};

    res.json({
      success: true,
      metrics
    });
  });

  // Get configuration settings
  router.get('/settings', (req, res) => {
    res.json({
      success: true,
      settings: config.settings
    });
  });

  return router;
};
