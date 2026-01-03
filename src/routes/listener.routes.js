// src/routes/listener.routes.js
// API endpoints for swap confirmation listening

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');

module.exports = (priceMonitor, swapClient) => {

  // POST /api/listener/start - Start monitoring a pool for swap confirmations
  router.post('/start', async (req, res) => {
    try {
      const { tokenAddress, poolAddress, protocol, pairType, userAddress } = req.body;

      // Validate required fields
      if (!tokenAddress || !poolAddress || !protocol) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: tokenAddress, poolAddress, protocol'
        });
      }

      // Validate addresses
      if (!ethers.isAddress(tokenAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tokenAddress'
        });
      }

      if (!ethers.isAddress(poolAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid poolAddress'
        });
      }

      if (userAddress && !ethers.isAddress(userAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid userAddress'
        });
      }

      // Validate protocol
      const validProtocols = ['uniswapv2', 'uniswapv3', 'aerodromev2', 'aerodromev3', 'slipstream'];
      if (!validProtocols.includes(protocol.toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: `Invalid protocol. Must be one of: ${validProtocols.join(', ')}`
        });
      }

      // Check if already listening
      const existingListener = priceMonitor.getSwapListener(tokenAddress);
      if (existingListener) {
        return res.json({
          success: true,
          message: 'Already listening to this token',
          data: existingListener
        });
      }

      // Start listening with user-specific configuration
      const result = await priceMonitor.startSwapListener({
        tokenAddress,
        poolAddress,
        protocol: protocol.toLowerCase(),
        pairType: pairType || 'weth',
        userAddress: userAddress || null
      });

      if (result) {
        res.json({
          success: true,
          message: 'Price listener started successfully',
          data: {
            tokenAddress,
            poolAddress,
            protocol: protocol.toLowerCase(),
            status: 'listening',
            startedAt: Date.now(),
            userAddress: userAddress || null
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to start listener'
        });
      }

    } catch (error) {
      console.error('Error starting listener:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // POST /api/listener/stop - Stop monitoring a token
  router.post('/stop', async (req, res) => {
    try {
      const { tokenAddress } = req.body;

      if (!tokenAddress) {
        return res.status(400).json({
          success: false,
          error: 'tokenAddress is required'
        });
      }

      if (!ethers.isAddress(tokenAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tokenAddress'
        });
      }

      const stopped = priceMonitor.stopSwapListener(tokenAddress);

      if (stopped) {
        res.json({
          success: true,
          message: 'Price listener stopped successfully',
          data: {
            tokenAddress,
            status: 'stopped',
            stoppedAt: Date.now()
          }
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'No active listener found for this token'
        });
      }

    } catch (error) {
      console.error('Error stopping listener:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/listener/active - Get all active listeners
  router.get('/active', (req, res) => {
    try {
      const activeListeners = priceMonitor.getActiveSwapListeners();

      res.json({
        success: true,
        activeListeners,
        totalActive: activeListeners.length
      });

    } catch (error) {
      console.error('Error getting active listeners:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/listener/health - Health check
  router.get('/health', (req, res) => {
    try {
      const swapClientStatus = swapClient ? swapClient.getStatus() : { connected: false };
      const activeListeners = priceMonitor.getActiveSwapListeners();
      const uptime = process.uptime();

      res.json({
        success: true,
        status: 'healthy',
        websocketConnected: swapClientStatus.connected,
        swapMicroserviceUrl: swapClientStatus.url,
        activeListeners: activeListeners.length,
        uptime: Math.floor(uptime)
      });

    } catch (error) {
      console.error('Error in health check:', error);
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: error.message
      });
    }
  });

  return router;
};
