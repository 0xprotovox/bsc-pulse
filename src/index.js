// src/index.js
// Main application entry point

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Services
const PriceMonitor = require('./services/PriceMonitor');
const ConnectionManager = require('./services/ConnectionManager');
const SwapMicroserviceClient = require('./services/SwapMicroserviceClient');

// Middlewares
const { rateLimiter } = require('./middlewares/rateLimiter');
const errorHandler = require('./middlewares/errorHandler');
const logger = require('./middlewares/logger');

// Routes
const { healthRoutes, tokensRoutes, pricesRoutes, monitoringRoutes } = require('./routes');
const listenerRoutes = require('./routes/listener.routes');

// Config
const config = require('./config/tokens.config');
const { SERVICE, HTTP_STATUS, DEFAULTS } = require('./utils/constants');

class PriceListenerApp {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.priceMonitor = null;
    this.startTime = Date.now();
    this.connectionManager = new ConnectionManager();

    // Swap Microservice integration (optional - only connects if URL is provided)
    const swapMicroserviceUrl = process.env.SWAP_MICROSERVICE_URL || process.env.SWAP_MICROSERVICE_WS;
    const swapMicroservicePath = process.env.WS_PATH || '/ws';

    if (swapMicroserviceUrl) {
      this.swapClient = new SwapMicroserviceClient(swapMicroserviceUrl, swapMicroservicePath);
    } else {
      this.swapClient = null;
      console.log('ℹ️  Swap Microservice URL not configured, swap confirmation disabled');
    }
  }

  // ==================== MIDDLEWARE ====================

  setupBasicMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());

    // Apply rate limiting to API routes
    this.app.use('/api/', rateLimiter());
  }

  setupAdvancedMiddleware() {
    // Request logging (needs metrics collector)
    this.app.use(logger(this.priceMonitor?.metrics));

    // Error handling (must be last, needs metrics collector)
    this.app.use(errorHandler(this.priceMonitor?.metrics));
  }

  // ==================== ROUTES ====================

  setupRoutes() {
    // Mount routes
    this.app.use('/health', healthRoutes(this.priceMonitor, this.connectionManager, this.startTime));
    this.app.use('/api/tokens', tokensRoutes(this.priceMonitor));
    this.app.use('/api/prices', pricesRoutes(this.priceMonitor));
    this.app.use('/api', monitoringRoutes(this.priceMonitor));

    // Swap confirmation listener routes (for Swap Microservice integration)
    this.app.use('/api/listener', listenerRoutes(this.priceMonitor, this.swapClient));
  }

  // ==================== WEBSOCKET WITH CONNECTION MANAGEMENT ====================

  setupWebSocket() {
    this.io.on('connection', (socket) => {
      const clientId = socket.id.slice(0, 8);
      console.log(`✅ Client connected: ${clientId}`);

      // Add to connection manager
      this.connectionManager.add(socket);

      // Track WebSocket connections in metrics
      if (this.priceMonitor) {
        this.priceMonitor.metrics.increment('wsConnections');
      }

      // Send welcome message
      socket.emit('welcome', {
        message: `Connected to ${SERVICE.NAME}`,
        socketId: socket.id,
        service: `${SERVICE.NAME} v${SERVICE.VERSION}`,
        features: {
          v2Support: true,
          v3Support: true,
          pancakeswapSupport: true,
          multiPoolSupport: true,
          dynamicBnbPrice: true,
          caching: true,
          metricsTracking: true,
          buySellDetection: true
        }
      });

      // Handle subscription
      socket.on('subscribe', async (data) => {
        try {
          const { tokenAddress } = data;

          if (!tokenAddress) {
            socket.emit('error', { message: 'Token address required' });
            return;
          }

          console.log(`📡 Subscribe request from ${clientId}: ${tokenAddress}`);

          // Join room for this token
          const room = `token:${tokenAddress.toLowerCase()}`;
          socket.join(room);

          // Track subscription
          this.connectionManager.addSubscription(socket.id, tokenAddress);

          // Add token to monitoring if not already
          const price = await this.priceMonitor.addToken(tokenAddress);

          // Send subscription confirmation with current price
          socket.emit('subscribed', {
            tokenAddress,
            currentPrice: price,
            room
          });

          // Send current price if available
          if (price && price.priceUSD > 0) {
            socket.emit('price-update', price);
          }

        } catch (error) {
          socket.emit('error', {
            message: 'Subscription failed',
            error: error.message
          });
        }
      });

      // Handle unsubscribe - Stop listener when no clients remain
      socket.on('unsubscribe', async (data) => {
        const { tokenAddress } = data;

        if (tokenAddress) {
          const normalizedAddress = tokenAddress.toLowerCase();
          const room = `token:${normalizedAddress}`;
          socket.leave(room);
          this.connectionManager.removeSubscription(socket.id, tokenAddress);
          console.log(`Client ${clientId} unsubscribed from ${tokenAddress}`);

          socket.emit('unsubscribed', { tokenAddress });

          // Check if any clients are still subscribed to this token
          // If not, stop the listener to save resources
          try {
            const sockets = await this.io.in(room).allSockets();
            if (sockets.size === 0) {
              console.log(`No clients left for ${tokenAddress}, removing from monitoring`);
              this.priceMonitor.removeDynamicToken(tokenAddress);
            } else {
              console.log(`${sockets.size} client(s) still subscribed to ${tokenAddress}`);
            }
          } catch (error) {
            console.error('Error checking room:', error.message);
          }
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${clientId}`);
        this.connectionManager.remove(socket.id);
      });

      // Ping/pong for connection health
      socket.on('ping', () => {
        this.connectionManager.updateActivity(socket.id);
        socket.emit('pong', { time: Date.now() });
      });

      // Get all prices
      socket.on('get-all-prices', () => {
        const prices = this.priceMonitor?.getCachedPrices() || [];
        socket.emit('all-prices', { prices });
      });
    });

    // Start connection health checks
    this.connectionManager.startHealthCheck(this.io);

    // Periodic heartbeat with cached prices
    setInterval(() => {
      const tokens = this.priceMonitor?.getMonitoredTokens() || [];
      const metrics = this.priceMonitor?.getMetrics() || {};

      this.io.emit('heartbeat', {
        timestamp: Date.now(),
        monitoredTokens: tokens.length,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        metrics: {
          priceUpdates: metrics.priceUpdates,
          cacheHits: metrics.cacheHits,
          eventsReceived: metrics.eventsReceived
        }
      });
    }, DEFAULTS.HEARTBEAT_INTERVAL);
  }

  // ==================== STARTUP ====================

  async start() {
    try {
      console.log('\n');
      console.log('╔════════════════════════════════════════════╗');
      console.log(`║  ${SERVICE.NAME.toUpperCase().padEnd(42)}║`);
      console.log(`║  v${SERVICE.VERSION.padEnd(40)} ║`);
      console.log('╚════════════════════════════════════════════╝');
      console.log('\n');

      // Validate configuration first
      this.validateConfiguration();

      // Setup basic middleware (cors, json, rate limiting)
      this.setupBasicMiddleware();

      // Setup WebSocket server
      this.setupWebSocket();

      // Initialize price monitor (with swap client for confirmations)
      this.priceMonitor = new PriceMonitor(this.io, this.swapClient);
      await this.priceMonitor.initialize();

      // Connect to Swap Microservice (if configured)
      if (this.swapClient) {
        this.swapClient.connect();
      }

      // Setup routes AFTER priceMonitor is initialized
      this.setupRoutes();

      // Setup advanced middleware AFTER routes (logging, error handling)
      this.setupAdvancedMiddleware();

      // Auto-add configured tokens (DISABLED - use API endpoint instead)
      // await this.autoAddTokens();

      // Start server
      const PORT = process.env.PORT || DEFAULTS.PORT;
      this.server.listen(PORT, () => {
        console.log('\n' + '═'.repeat(50));
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🌐 HTTP: http://localhost:${PORT}`);
        console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
        console.log('═'.repeat(50));
        console.log('\nEndpoints:');
        console.log(`  GET  /health                      - Health check with metrics`);
        console.log(`  GET  /api/tokens                  - List all configured tokens`);
        console.log(`  GET  /api/tokens/monitored        - List monitored tokens`);
        console.log(`  GET  /api/prices                  - Get all cached prices`);
        console.log(`  GET  /api/prices/:token           - Get token price from cache`);
        console.log(`  GET  /api/metrics                 - Get system metrics`);
        console.log(`  GET  /api/settings                - Get configuration settings`);
        console.log(`  POST /api/monitor                 - Add token to monitoring`);
        console.log(`  POST /api/monitor-dynamic         - Add multiple tokens with config`);
        console.log('');
        console.log('Swap Confirmation (Swap Microservice Integration):');
        console.log(`  POST /api/listener/start          - Start swap confirmation listener`);
        console.log(`  POST /api/listener/stop           - Stop swap confirmation listener`);
        console.log(`  GET  /api/listener/active         - Get active swap listeners`);
        console.log(`  GET  /api/listener/health         - Swap listener health check`);
        console.log('═'.repeat(50));
        console.log('\n📊 Ready to track prices!');
        console.log('💡 Use /api/monitor-dynamic to add tokens dynamically');
        if (this.swapClient) {
          console.log('🔗 Swap Microservice integration: ENABLED');
        } else {
          console.log('ℹ️  Swap Microservice integration: DISABLED (set SWAP_MICROSERVICE_URL to enable)');
        }
        console.log('');
      });

    } catch (error) {
      console.error('❌ Failed to start application:', error);
      process.exit(1);
    }
  }

  validateConfiguration() {
    console.log('🔍 Validating configuration...');

    const errors = [];
    const seen = new Set();

    // Validate tokens
    Object.entries(config.tokens).forEach(([address, tokenConfig]) => {
      if (!tokenConfig.pools || tokenConfig.pools.length === 0) {
        errors.push(`Token ${address} has no pools configured`);
      }

      tokenConfig.pools.forEach((pool, i) => {
        const poolKey = `${address}-${pool.address}`;
        if (seen.has(poolKey)) {
          errors.push(`Duplicate pool configuration: ${poolKey}`);
        }
        seen.add(poolKey);

        if (!pool.address) {
          errors.push(`Token ${address} pool ${i} missing address`);
        }

        if (!pool.type) {
          errors.push(`Token ${address} pool ${i} missing type`);
        }

        if (pool.type === 'V3' && !pool.fee) {
          errors.push(`Token ${address} V3 pool ${i} missing fee`);
        }
      });
    });

    // Validate agent tokens
    Object.entries(config.agentTokens || {}).forEach(([address, agent]) => {
      if (!agent.priceSources || agent.priceSources.length === 0) {
        errors.push(`Agent ${agent.symbol} has no price sources`);
      }
    });

    if (errors.length > 0) {
      console.error('Configuration errors found:');
      errors.forEach(err => console.error(`  ❌ ${err}`));
      throw new Error('Configuration validation failed');
    }

    console.log('✅ Configuration validated successfully');
  }

  async autoAddTokens() {
    console.log('\n📄 Auto-adding configured tokens...');

    const tokens = Object.keys(config.tokens);
    let successCount = 0;

    for (const tokenAddress of tokens) {
      try {
        const result = await this.priceMonitor.addToken(tokenAddress);
        if (result) {
          successCount++;
        }
      } catch (error) {
        console.error(`Failed to add ${tokenAddress}: ${error.message}`);
      }
    }

    console.log(`✅ Added ${successCount}/${tokens.length} tokens to monitoring\n`);
  }

  // ==================== SHUTDOWN ====================

  async stop() {
    console.log('\n🛑 Shutting down gracefully...');

    this.connectionManager.stop();

    if (this.priceMonitor) {
      await this.priceMonitor.stop();
    }

    if (this.swapClient) {
      this.swapClient.disconnect();
    }

    if (this.io) {
      this.io.close();
    }

    if (this.server) {
      this.server.close();
    }

    console.log('✅ Shutdown complete\n');
  }
}

// ==================== MAIN ====================

if (require.main === module) {
  const app = new PriceListenerApp();

  // Start application
  app.start().catch(console.error);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await app.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await app.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
    process.exit(1);
  });
}

module.exports = PriceListenerApp;
