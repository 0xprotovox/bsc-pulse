// src/services/PriceMonitor.js
// Production-ready price monitoring service

const { ethers } = require('ethers');
const config = require('../config/tokens.config');
const MempoolMonitor = require('./MempoolMonitor');

// Cache for last prices only
class LastPriceCache {
  constructor() {
    this.prices = new Map();
  }
  
  set(tokenAddress, priceData) {
    this.prices.set(tokenAddress.toLowerCase(), {
      ...priceData,
      cachedAt: Date.now()
    });
  }
  
  get(tokenAddress) {
    return this.prices.get(tokenAddress.toLowerCase()) || null;
  }
  
  getAll() {
    return Array.from(this.prices.entries()).map(([address, data]) => ({
      address,
      ...data
    }));
  }
  
  clear() {
    this.prices.clear();
  }
}

// Metrics collection
class MetricsCollector {
  constructor() {
    this.stats = {
      priceUpdates: 0,
      cacheHits: 0,
      cacheMisses: 0,
      apiRequests: 0,
      wsConnections: 0,
      eventsReceived: 0,
      errors: [],
      startTime: Date.now()
    };
  }
  
  increment(metric) {
    if (this.stats[metric] !== undefined) {
      this.stats[metric]++;
    }
  }
  
  addError(error) {
    this.stats.errors.push({
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack
    });
    // Keep only last 100 errors
    if (this.stats.errors.length > 100) {
      this.stats.errors.shift();
    }
  }
  
  getStats() {
    const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    return {
      ...this.stats,
      uptime,
      errorCount: this.stats.errors.length,
      lastError: this.stats.errors[this.stats.errors.length - 1] || null
    };
  }
}

class PriceMonitor {
  constructor(io, swapClient = null) {
    this.io = io;
    this.provider = null;
    this.monitoredTokens = new Map();
    this.poolContracts = new Map();
    this.activeListeners = new Map(); // Track listeners for cleanup
    this.bnbPrice = config.settings.defaultBnbPrice;
    this.lastBnbPriceUpdate = 0;
    this.agentTokenPrices = new Map();
    this.agentPriceUpdates = new Map();
    this.reconnectAttempts = 0;
    this.isConnected = false;

    // New additions
    this.priceCache = new LastPriceCache();
    this.metrics = new MetricsCollector();

    // Swap confirmation tracking
    this.swapClient = swapClient;
    this.swapListeners = new Map(); // Track user-specific swap listeners

    // Mempool monitoring for instant swap detection (0-100ms)
    this.mempoolMonitor = null; // Initialize after provider is ready
  }
  
  // ==================== INITIALIZATION ====================
  
  async initialize() {
    try {
      console.log('🚀 Initializing Price Monitor Service with All Improvements');
      console.log('=' .repeat(50));
      
      await this.connectWebSocket();

      // Initialize mempool monitor for instant swap detection (if swap client available)
      if (this.swapClient) {
        this.mempoolMonitor = new MempoolMonitor(this.provider, this.swapClient);
        console.log('⚡ Mempool monitor initialized (instant detection: 0-100ms)');
      }

      await this.updateBNBPrice();
      await this.updateAllAgentPrices();

      // Setup periodic updates
      this.bnbPriceInterval = setInterval(() => {
        this.updateBNBPrice().catch(err => {
          console.error('BNB price update error:', err);
          this.metrics.addError(err);
        });
      }, config.settings.updateBnbPriceInterval);
      
      this.agentPriceInterval = setInterval(() => {
        this.updateAllAgentPrices().catch(err => {
          console.error('Agent price update error:', err);
          this.metrics.addError(err);
        });
      }, config.settings.updateAgentPriceInterval);
      
      console.log('✅ Price Monitor initialized successfully\n');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize:', error.message);
      this.metrics.addError(error);
      throw error;
    }
  }
  
  async connectWebSocket() {
    try {
      const wssUrl = process.env.WSS_URL;
      if (!wssUrl || wssUrl.includes('YOUR_')) {
        throw new Error('Please configure WSS_URL in .env file with your Alchemy key');
      }
      
      console.log('🌐 Connecting to WebSocket...');
      this.provider = new ethers.WebSocketProvider(wssUrl);
      
      // Setup event handlers
      this.provider.on('block', (blockNumber) => {
        if (config.settings.enableDebugLogs && blockNumber % 10 === 0) {
          console.log(`⛓️ Block ${blockNumber}`);
        }
      });
      
      this.provider.websocket.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('✅ WebSocket connected');
      });
      
      this.provider.websocket.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        this.metrics.addError(error);
      });
      
      this.provider.websocket.on('close', () => {
        this.isConnected = false;
        console.log('❌ WebSocket disconnected');
        this.handleReconnection();
      });
      
      // Verify connection
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      console.log(`✅ Connected to ${network.name} (Chain ID: ${network.chainId})`);
      console.log(`📦 Current block: ${blockNumber}`);
      
    } catch (error) {
      console.error('Connection failed:', error.message);
      this.metrics.addError(error);
      throw error;
    }
  }
  
  async handleReconnection() {
    if (this.reconnectAttempts >= config.settings.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Please restart the service.');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`Reconnection attempt ${this.reconnectAttempts}/${config.settings.maxReconnectAttempts}...`);
    
    setTimeout(async () => {
      try {
        await this.connectWebSocket();
        await this.resubscribeAllTokens();
      } catch (error) {
        console.error('Reconnection failed:', error.message);
        this.handleReconnection();
      }
    }, config.settings.reconnectDelay);
  }
  
  async resubscribeAllTokens() {
    for (const [tokenAddress, tokenData] of this.monitoredTokens) {
      for (const pool of tokenData.pools) {
        await this.setupPoolListener(pool, tokenAddress);
      }
    }
    console.log('✅ Resubscribed to all tokens');
  }
  
  // ==================== AGENT TOKEN PRICING WITH CIRCULAR PROTECTION ====================
  
  async updateAllAgentPrices() {
    if (!config.agentTokens) return;
    
    console.log('📊 Updating agent token prices...');
    
    for (const [agentAddress, agentConfig] of Object.entries(config.agentTokens)) {
      try {
        const price = await this.calculateAgentTokenPrice(agentAddress, agentConfig, []);
        if (price > 0) {
          this.agentTokenPrices.set(agentAddress.toLowerCase(), {
            price,
            symbol: agentConfig.symbol,
            timestamp: Date.now()
          });
          console.log(`   ${agentConfig.symbol}: $${price.toFixed(6)}`);
        }
      } catch (error) {
        console.error(`   Failed to update ${agentConfig.symbol}: ${error.message}`);
        this.metrics.addError(error);
      }
    }
  }
  
  async calculateAgentTokenPrice(agentAddress, agentConfig, callStack = []) {
    // Circular dependency protection
    if (callStack.includes(agentAddress)) {
      console.warn(`Circular dependency detected: ${callStack.join(' -> ')} -> ${agentAddress}`);
      return 0;
    }
    
    const newCallStack = [...callStack, agentAddress];
    const prices = [];
    
    for (const source of agentConfig.priceSources) {
      try {
        let price = 0;
        
        if (source.type === 'V2') {
          price = await this.getV2PoolPrice(source, agentAddress);
        } else {
          price = await this.getV3PoolPrice(source, agentAddress);
        }
        
        // Convert to USD based on pair token
        if (source.pair === 'WBNB') {
          price = price * this.bnbPrice;
        } else if (source.pair === 'USDC' || source.pair === 'USDT' || source.pair === 'DAI' || source.pair === 'BUSD') {
          // Already in USD
        } else {
          // Nested agent token - pass call stack
          const nestedAgentPrice = await this.getAgentTokenPrice(source.pairAddress, newCallStack);
          if (nestedAgentPrice > 0) {
            price = price * nestedAgentPrice;
          }
        }
        
        if (price > 0) {
          prices.push(price);
        }
      } catch (error) {
        console.error(`Failed to get price from ${source.address}: ${error.message}`);
      }
    }
    
    if (prices.length === 0) return 0;
    
    // Remove outliers before averaging
    const cleanPrices = this.removeOutliers(prices);
    return cleanPrices.reduce((sum, p) => sum + p, 0) / cleanPrices.length;
  }
  
  async getAgentTokenPrice(agentAddress, callStack = []) {
    if (!agentAddress) return 0;
    
    // Check for circular dependency
    if (callStack.includes(agentAddress)) {
      console.warn(`Circular dependency in getAgentTokenPrice: ${callStack.join(' -> ')} -> ${agentAddress}`);
      return 0;
    }
    
    const cached = this.agentTokenPrices.get(agentAddress.toLowerCase());
    
    // Use cached price if fresh enough
    if (cached && (Date.now() - cached.timestamp) < config.settings.agentPriceCacheTTL) {
      return cached.price;
    }
    
    // Otherwise calculate fresh price
    const agentConfig = config.agentTokens[agentAddress.toLowerCase()];
    if (!agentConfig) {
      console.warn(`No configuration for agent token ${agentAddress}`);
      return 0;
    }
    
    const price = await this.calculateAgentTokenPrice(agentAddress, agentConfig, callStack);
    
    // Cache the result
    if (price > 0) {
      this.agentTokenPrices.set(agentAddress.toLowerCase(), {
        price,
        symbol: agentConfig.symbol,
        timestamp: Date.now()
      });
    }
    
    return price;
  }
  
  // ==================== PRICE CALCULATION WITH OUTLIER DETECTION ====================
  
  removeOutliers(prices) {
    if (prices.length <= 2) return prices;
    
    // Calculate mean and standard deviation
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    // Remove prices that are more than 2 standard deviations from mean
    const filtered = prices.filter(p => Math.abs(p - mean) <= 2 * stdDev);
    
    // If we filtered out too much, return original
    if (filtered.length === 0) return prices;
    
    return filtered;
  }
  
  async getV2PoolPrice(poolInfo, tokenAddress) {
    const poolContract = new ethers.Contract(
      poolInfo.address,
      [
        'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
        'function token0() view returns (address)',
        'function token1() view returns (address)'
      ],
      this.provider
    );
    
    const [reserves, token0, token1] = await Promise.all([
      poolContract.getReserves(),
      poolContract.token0(),
      poolContract.token1()
    ]);
    
    if (reserves[0] === 0n || reserves[1] === 0n) {
      return 0;
    }
    
    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    
    let price;
    if (isToken0) {
      price = Number(ethers.formatUnits(reserves[1], poolInfo.decimals1)) / 
               Number(ethers.formatUnits(reserves[0], poolInfo.decimals0));
    } else {
      price = Number(ethers.formatUnits(reserves[0], poolInfo.decimals0)) / 
               Number(ethers.formatUnits(reserves[1], poolInfo.decimals1));
    }
    
    return price;
  }
  
  async getV3PoolPrice(poolInfo, tokenAddress) {
    const poolContract = new ethers.Contract(
      poolInfo.address,
      ['function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)',
       'function token0() view returns (address)',
       'function token1() view returns (address)'],
      this.provider
    );
    
    const [slot0, token0, token1] = await Promise.all([
      poolContract.slot0(),
      poolContract.token0(),
      poolContract.token1()
    ]);
    
    const sqrtPriceX96 = parseFloat(slot0[0].toString());
    const Q96 = 2 ** 96;
    const sqrtPrice = sqrtPriceX96 / Q96;
    let rawPrice = sqrtPrice * sqrtPrice;
    
    // Adjust for decimals
    if (poolInfo.decimals0 !== poolInfo.decimals1) {
      rawPrice = rawPrice * Math.pow(10, poolInfo.decimals0 - poolInfo.decimals1);
    }
    
    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    
    return isToken0 ? rawPrice : (1 / rawPrice);
  }
  
  // ==================== BNB PRICE MANAGEMENT ====================
  
  async updateBNBPrice() {
    try {
      const prices = [];
      
      for (const source of config.bnbPriceSources) {
        try {
          const price = await this.getBNBPriceFromPool(source);
          if (price > 0) {
            prices.push(price);
          }
        } catch (error) {
          console.log(`Failed to get price from ${source.address.slice(0,8)}...`);
        }
      }
      
      if (prices.length > 0) {
        // Remove outliers from BNB price sources too
        const cleanPrices = this.removeOutliers(prices);
        this.bnbPrice = cleanPrices.reduce((sum, p) => sum + p, 0) / cleanPrices.length;
        console.log(`📈 BNB price updated: $${this.bnbPrice.toFixed(2)}`);
      } else {
        console.log(`Using default BNB price: $${this.bnbPrice}`);
      }
      
      this.lastEthPriceUpdate = Date.now();
      
    } catch (error) {
      console.error('Failed to update BNB price:', error.message);
      this.metrics.addError(error);
    }
  }
  
  async getBNBPriceFromPool(source) {
    const poolContract = new ethers.Contract(
      source.address,
      ['function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)'],
      this.provider
    );
    
    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = parseFloat(slot0[0].toString());
    const Q96 = 2 ** 96;
    
    const sqrtPrice = sqrtPriceX96 / Q96;
    let price = sqrtPrice * sqrtPrice;
    
    // Adjust for decimals difference
    if (source.decimals0 !== source.decimals1) {
      price = price * Math.pow(10, source.decimals0 - source.decimals1);
    }
    
    // sqrtPriceX96 gives token1/token0 ratio
    // If stablecoin is token0, we need to invert to get USD per BNB
    if ((source.token0 === 'USDC' || source.token0 === 'USDT' || source.token0 === 'BUSD') && source.token1 === 'WBNB') {
      price = 1 / price;
    }

    return price;
  }
  
  // ==================== TOKEN MANAGEMENT ====================
  
  async addToken(tokenAddress) {
    try {
      // Normalize to lowercase for consistent key matching across all Maps
      tokenAddress = ethers.getAddress(tokenAddress).toLowerCase();

      if (this.monitoredTokens.has(tokenAddress)) {
        console.log(`Already monitoring ${tokenAddress}`);
        // Return from cache if available
        const cached = this.priceCache.get(tokenAddress);
        if (cached) {
          this.metrics.increment('cacheHits');
          return cached;
        }
        return this.monitoredTokens.get(tokenAddress).lastPrice;
      }

      // Get token config
      const tokenConfig = config.tokens[tokenAddress];
      if (!tokenConfig) {
        console.error(`❌ Token ${tokenAddress} not configured in tokens.config.js`);
        return null;
      }

      console.log(`\n🔍 Adding ${tokenConfig.name} (${tokenConfig.symbol})`);
      console.log(`   Address: ${tokenAddress}`);
      console.log(`   Configured pools: ${tokenConfig.pools.length}`);

      // Check for agent token dependencies
      const agentPools = tokenConfig.pools.filter(p => p.pairIsAgent);
      if (agentPools.length > 0) {
        console.log(`   Agent dependencies: ${agentPools.map(p => p.pair).join(', ')}`);
        await this.updateAllAgentPrices();
      }

      // Update BNB price if needed
      const now = Date.now();
      if (now - this.lastEthPriceUpdate > config.settings.updateBnbPriceInterval) {
        await this.updateBNBPrice();
      }

      // Load pool information
      const activePools = await this.loadPools(tokenAddress, tokenConfig);

      if (activePools.length === 0) {
        console.error(`❌ No active pools found for ${tokenConfig.symbol}`);
        return null;
      }

      // Calculate initial price
      const initialPrice = await this.calculatePrice(tokenAddress, activePools, tokenConfig);

      // Store token data
      this.monitoredTokens.set(tokenAddress, {
        config: tokenConfig,
        pools: activePools,
        lastPrice: initialPrice,
        lastUpdate: Date.now()
      });

      // Setup event listeners with tracking
      for (const pool of activePools) {
        await this.setupPoolListener(pool, tokenAddress);
      }

      // Cache the price
      if (initialPrice && initialPrice.priceUSD > 0) {
        this.priceCache.set(tokenAddress, initialPrice);
        this.broadcastPrice(tokenAddress, initialPrice);
        console.log(`💰 Initial price: $${initialPrice.priceUSD.toFixed(config.settings.decimalPlaces)}`);
      }

      return initialPrice;

    } catch (error) {
      console.error(`Failed to add token:`, error.message);
      this.metrics.addError(error);
      return null;
    }
  }

  async addDynamicTokens(tokensArray) {
    const results = [];

    console.log(`\n📋 Adding ${tokensArray.length} dynamic token(s)...`);

    for (let i = 0; i < tokensArray.length; i++) {
      const tokenInput = tokensArray[i];

      // DEBUG: Log exactly what we received from frontend
      console.log(`   📥 Received from frontend:`, JSON.stringify({
        dex: tokenInput.dex,
        version: tokenInput.version,
        fee: tokenInput.fee,
        symbol: tokenInput.symbol,
        pair: tokenInput.pair,
        pairAddress: tokenInput.pairAddress,
        poolAddress: tokenInput.poolAddress,
        tokenAddress: tokenInput.tokenAddress
      }));

      try {
        // Normalize addresses to lowercase for consistent key matching
        const tokenAddress = ethers.getAddress(tokenInput.tokenAddress).toLowerCase();
        const poolAddress = ethers.getAddress(tokenInput.poolAddress).toLowerCase();

        console.log(`\n[${i + 1}/${tokensArray.length}] Processing token ${tokenAddress.slice(0, 10)}...`);

        // Check if already monitoring
        if (this.monitoredTokens.has(tokenAddress)) {
          console.log(`   ⚠️  Already monitoring this token`);
          const cached = this.priceCache.get(tokenAddress);
          results.push({
            success: true,
            tokenAddress,
            message: 'Already monitoring',
            price: cached || this.monitoredTokens.get(tokenAddress).lastPrice
          });
          continue;
        }

        // Build token configuration dynamically
        const tokenConfig = this.buildTokenConfig(tokenInput, tokenAddress, poolAddress);

        // Add token with dynamic config
        const price = await this.addTokenWithConfig(tokenAddress, tokenConfig);

        if (price) {
          results.push({
            success: true,
            tokenAddress,
            poolAddress,
            pair: tokenInput.pair,
            version: tokenInput.version,
            message: 'Successfully added to monitoring',
            price
          });
          console.log(`   ✅ Successfully added!`);
        } else {
          results.push({
            success: false,
            tokenAddress,
            poolAddress,
            error: 'Failed to add token - check pool liquidity and configuration'
          });
          console.log(`   ❌ Failed to add`);
        }

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        results.push({
          success: false,
          tokenAddress: tokenInput.tokenAddress,
          error: error.message
        });
      }
    }

    console.log(`\n✅ Processed ${results.length} token(s)\n`);
    return results;
  }

  buildTokenConfig(tokenInput, tokenAddress, poolAddress) {
    const isAgent = !['WBNB', 'USDC', 'USDT', 'BUSD', 'DAI'].includes(tokenInput.pair);

    // Get pair address from config or user input
    let pairAddress;
    if (tokenInput.pairAddress) {
      pairAddress = ethers.getAddress(tokenInput.pairAddress);
    } else {
      pairAddress = config.addresses[tokenInput.pair];
      if (!pairAddress) {
        throw new Error(`Unknown pair token: ${tokenInput.pair}. Please provide pairAddress or use WBNB/USDC/USDT/BUSD`);
      }
    }

    // Determine DEX type (default to Uniswap for backward compatibility)
    const dex = tokenInput.dex || 'uniswap';
    const dexName = dex.toLowerCase();

    let poolType, description;
    if (dexName === 'aerodrome') {
      poolType = tokenInput.version === 2 ? 'AERODROME_V2' : 'AERODROME_V3';
      description = `${tokenInput.pair} Aerodrome ${tokenInput.version === 2 ? 'V2' : 'V3'}`;
    } else {
      // Default: Uniswap
      poolType = tokenInput.version === 2 ? 'V2' : 'V3';
      description = `${tokenInput.pair} ${tokenInput.version === 2 ? 'V2' : 'V3'}`;
    }

    const poolConfig = {
      address: poolAddress,
      type: poolType,
      version: tokenInput.version,
      dex: dexName,
      pair: tokenInput.pair,
      pairAddress,
      pairIsAgent: isAgent,
      description: description,
      priority: tokenInput.priority || 1
    };

    if (tokenInput.version === 3 || poolType === 'AERODROME_V3') {
      poolConfig.fee = tokenInput.fee;
    }

    return {
      name: tokenInput.name || `Token ${tokenAddress.slice(0, 6)}`,
      symbol: tokenInput.symbol || 'TKN',
      decimals: tokenInput.decimals || 18,
      address: tokenAddress,
      pools: [poolConfig]
    };
  }

  async addTokenWithConfig(tokenAddress, tokenConfig) {
    try {
      // Safety: ensure lowercase for consistent key matching
      tokenAddress = tokenAddress.toLowerCase();

      console.log(`   🔍 Token: ${tokenConfig.symbol}`);
      console.log(`   📍 Address: ${tokenAddress}`);
      console.log(`   🏊 Pool: ${tokenConfig.pools[0].description}`);

      // Check for agent token dependencies
      const agentPools = tokenConfig.pools.filter(p => p.pairIsAgent);
      if (agentPools.length > 0) {
        console.log(`   🤖 Agent dependencies: ${agentPools.map(p => p.pair).join(', ')}`);
        await this.updateAllAgentPrices();
      }

      // Update BNB price if needed
      const now = Date.now();
      if (now - this.lastEthPriceUpdate > config.settings.updateBnbPriceInterval) {
        await this.updateBNBPrice();
      }

      // Load pool information
      const activePools = await this.loadPools(tokenAddress, tokenConfig);

      if (activePools.length === 0) {
        console.error(`   ❌ No active pools found`);
        return null;
      }

      console.log(`   ✅ Pool has liquidity`);

      // Calculate initial price
      const initialPrice = await this.calculatePrice(tokenAddress, activePools, tokenConfig);

      // Store token data
      this.monitoredTokens.set(tokenAddress, {
        config: tokenConfig,
        pools: activePools,
        lastPrice: initialPrice,
        lastUpdate: Date.now(),
        isDynamic: true  // Mark as dynamically added
      });

      // Setup event listeners with tracking
      for (const pool of activePools) {
        await this.setupPoolListener(pool, tokenAddress);
      }

      // Cache the price
      if (initialPrice && initialPrice.priceUSD > 0) {
        this.priceCache.set(tokenAddress, initialPrice);
        this.broadcastPrice(tokenAddress, initialPrice);
        console.log(`   💰 Initial price: $${initialPrice.priceUSD.toFixed(config.settings.decimalPlaces)}`);
      }

      return initialPrice;

    } catch (error) {
      console.error(`   ❌ Failed to add token:`, error.message);
      this.metrics.addError(error);
      return null;
    }
  }
  
  async loadPools(tokenAddress, tokenConfig) {
    const activePools = [];
    
    console.log('\n📋 Loading configured pools...');
    
    for (const poolConfig of tokenConfig.pools) {
      try {
        console.log(`   Checking ${poolConfig.description}...`);

        let poolInfo;
        if (poolConfig.type === 'AERODROME_V2') {
          poolInfo = await this.loadAerodromeV2Pool(poolConfig, tokenAddress);
        } else if (poolConfig.type === 'AERODROME_V3') {
          poolInfo = await this.loadAerodromeV3Pool(poolConfig, tokenAddress);
        } else if (poolConfig.type === 'V2') {
          poolInfo = await this.loadV2Pool(poolConfig, tokenAddress);
        } else {
          poolInfo = await this.loadV3Pool(poolConfig, tokenAddress);
        }

        if (poolInfo && poolInfo.hasLiquidity) {
          activePools.push({ ...poolInfo, config: poolConfig });
          console.log(`     ✅ Active with liquidity`);
          
          if (poolConfig.pairIsAgent) {
            const agentPrice = await this.getAgentTokenPrice(poolConfig.pairAddress);
            if (agentPrice > 0) {
              console.log(`     📊 ${poolConfig.pair} price: $${agentPrice.toFixed(6)}`);
            }
          }
        } else {
          console.log(`     ⚠️  No liquidity`);
        }
        
      } catch (error) {
        console.error(`     ❌ Error: ${error.message}`);
      }
    }
    
    return activePools;
  }
  
  async loadV2Pool(poolConfig, tokenAddress) {
    const pairAddress = poolConfig.pairAddress || config.addresses[poolConfig.pair];
    if (!pairAddress) {
      throw new Error(`Unknown pair token: ${poolConfig.pair}`);
    }

    const poolContract = new ethers.Contract(
      poolConfig.address,
      [
        'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
        'function token0() view returns (address)',
        'function token1() view returns (address)'
      ],
      this.provider
    );

    const [reserves, token0, token1] = await Promise.all([
      poolContract.getReserves(),
      poolContract.token0(),
      poolContract.token1()
    ]);

    const hasLiquidity = reserves[0] > 0n && reserves[1] > 0n;

    // CRITICAL: Validate that the token is actually in this pool
    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const isToken1 = token1.toLowerCase() === tokenAddress.toLowerCase();
    if (!isToken0 && !isToken1) {
      console.error(`[V2 Pool] ❌ Token ${tokenAddress.slice(0,10)} is NOT in pool ${poolConfig.address.slice(0,10)}`);
      console.error(`         Pool contains: token0=${token0.slice(0,10)}, token1=${token1.slice(0,10)}`);
      throw new Error(`Token ${tokenAddress} not found in pool. Pool contains ${token0} and ${token1}`);
    }

    // Get actual decimals for both tokens from the blockchain
    const [decimals0Actual, decimals1Actual] = await Promise.all([
      this.getTokenDecimalsByAddress(token0),
      this.getTokenDecimalsByAddress(token1)
    ]);
    console.log(`[V2 Pool] Token ${tokenAddress.slice(0,10)} isToken0=${isToken0}`);
    console.log(`         token0=${token0.slice(0,10)} (${decimals0Actual} decimals)`);
    console.log(`         token1=${token1.slice(0,10)} (${decimals1Actual} decimals)`);

    return {
      address: poolConfig.address,
      type: 'V2',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      decimals0: decimals0Actual,
      decimals1: decimals1Actual,
      reserve0: reserves[0],
      reserve1: reserves[1],
      hasLiquidity,
      config: poolConfig  // Keep pool config for reference
    };
  }
  
  async loadV3Pool(poolConfig, tokenAddress) {
    const pairAddress = poolConfig.pairAddress || config.addresses[poolConfig.pair];
    if (!pairAddress) {
      throw new Error(`Unknown pair token: ${poolConfig.pair}`);
    }
    
    const poolContract = new ethers.Contract(
      poolConfig.address,
      [
        'function liquidity() view returns (uint128)',
        'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function fee() view returns (uint24)'
      ],
      this.provider
    );
    
    const [liquidity, slot0, token0, token1, fee] = await Promise.all([
      poolContract.liquidity(),
      poolContract.slot0(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee()
    ]);
    
    const hasLiquidity = liquidity > 0n;

    // CRITICAL: Validate that the token is actually in this pool
    console.log(`[V3 Pool] Validating token in pool...`);
    console.log(`         tokenAddress: ${tokenAddress}`);
    console.log(`         pool token0:  ${token0}`);
    console.log(`         pool token1:  ${token1}`);
    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const isToken1 = token1.toLowerCase() === tokenAddress.toLowerCase();
    console.log(`         isToken0=${isToken0}, isToken1=${isToken1}`);
    if (!isToken0 && !isToken1) {
      console.error(`[V3 Pool] ❌ Token ${tokenAddress.slice(0,10)} is NOT in pool ${poolConfig.address.slice(0,10)}`);
      console.error(`         Pool contains: token0=${token0.slice(0,10)}, token1=${token1.slice(0,10)}`);
      throw new Error(`Token ${tokenAddress} not found in pool. Pool contains ${token0} and ${token1}`);
    }
    console.log(`[V3 Pool] ✅ Token found in pool as ${isToken0 ? 'token0' : 'token1'}`);

    // Get actual decimals for both tokens from the blockchain
    const [decimals0Actual, decimals1Actual] = await Promise.all([
      this.getTokenDecimalsByAddress(token0),
      this.getTokenDecimalsByAddress(token1)
    ]);
    console.log(`[V3 Pool] Token ${tokenAddress.slice(0,10)} isToken0=${isToken0}`);
    console.log(`         token0=${token0.slice(0,10)} (${decimals0Actual} decimals)`);
    console.log(`         token1=${token1.slice(0,10)} (${decimals1Actual} decimals)`);

    return {
      address: poolConfig.address,
      type: 'V3',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      decimals0: decimals0Actual,
      decimals1: decimals1Actual,
      fee: Number(fee),
      sqrtPriceX96: slot0[0].toString(),
      tick: Number(slot0[1]),
      liquidity: liquidity.toString(),
      hasLiquidity,
      config: poolConfig  // Keep pool config for reference
    };
  }

  async loadAerodromeV2Pool(poolConfig, tokenAddress) {
    const pairAddress = poolConfig.pairAddress || config.addresses[poolConfig.pair];
    if (!pairAddress) {
      throw new Error(`Unknown pair token: ${poolConfig.pair}`);
    }

    const poolContract = new ethers.Contract(
      poolConfig.address,
      [
        'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
        'function token0() view returns (address)',
        'function token1() view returns (address)'
      ],
      this.provider
    );

    const [reserves, token0, token1] = await Promise.all([
      poolContract.getReserves(),
      poolContract.token0(),
      poolContract.token1()
    ]);

    const hasLiquidity = reserves[0] > 0n && reserves[1] > 0n;

    // CRITICAL: Validate that the token is actually in this pool
    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const isToken1 = token1.toLowerCase() === tokenAddress.toLowerCase();
    if (!isToken0 && !isToken1) {
      console.error(`[Aerodrome V2] ❌ Token ${tokenAddress.slice(0,10)} is NOT in pool ${poolConfig.address.slice(0,10)}`);
      console.error(`               Pool contains: token0=${token0.slice(0,10)}, token1=${token1.slice(0,10)}`);
      throw new Error(`Token ${tokenAddress} not found in pool. Pool contains ${token0} and ${token1}`);
    }

    // Get actual decimals for both tokens from the blockchain
    const [decimals0Actual, decimals1Actual] = await Promise.all([
      this.getTokenDecimalsByAddress(token0),
      this.getTokenDecimalsByAddress(token1)
    ]);
    console.log(`[Aerodrome V2] Token ${tokenAddress.slice(0,10)} isToken0=${isToken0}`);
    console.log(`               token0=${token0.slice(0,10)} (${decimals0Actual} decimals)`);
    console.log(`               token1=${token1.slice(0,10)} (${decimals1Actual} decimals)`);

    return {
      address: poolConfig.address,
      type: 'AERODROME_V2',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      decimals0: decimals0Actual,
      decimals1: decimals1Actual,
      reserve0: reserves[0],
      reserve1: reserves[1],
      hasLiquidity,
      config: poolConfig
    };
  }

  async loadAerodromeV3Pool(poolConfig, tokenAddress) {
    const pairAddress = poolConfig.pairAddress || config.addresses[poolConfig.pair];
    if (!pairAddress) {
      throw new Error(`Unknown pair token: ${poolConfig.pair}`);
    }

    const poolContract = new ethers.Contract(
      poolConfig.address,
      [
        'function liquidity() view returns (uint128)',
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function tickSpacing() view returns (int24)'
      ],
      this.provider
    );

    // For Aerodrome V3, we need to get slot0 data
    // Aerodrome V3 uses a slightly different slot0 structure
    let slot0Data;

    // Try method 1: Standard slot0 with 7 return values
    try {
      const slot0ABI = ['function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint16, bool)'];
      const slot0Contract = new ethers.Contract(poolConfig.address, slot0ABI, this.provider);
      slot0Data = await slot0Contract.slot0();
    } catch (e1) {
      console.log(`     ⚠️  Method 1 failed, trying Uniswap V3 style...`);

      // Try method 2: Uniswap V3 style slot0
      try {
        const slot0ABI2 = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'];
        const slot0Contract2 = new ethers.Contract(poolConfig.address, slot0ABI2, this.provider);
        slot0Data = await slot0Contract2.slot0();
      } catch (e2) {
        console.log(`     ⚠️  Method 2 failed, using raw call...`);

        // Try method 3: Raw call and manual decode
        try {
          const iface = new ethers.Interface(['function slot0()']);
          const data = iface.encodeFunctionData('slot0', []);
          const result = await this.provider.call({
            to: poolConfig.address,
            data: data
          });

          // Manually decode: first 32 bytes = sqrtPriceX96, next 32 bytes = tick
          const sqrtPriceX96 = BigInt('0x' + result.slice(2, 66));
          const tickHex = result.slice(66, 130);
          const tick = parseInt(tickHex, 16);

          slot0Data = [sqrtPriceX96, tick < 0x80000000 ? tick : tick - 0x100000000];
          console.log(`     ✅ Raw decode successful`);
        } catch (e3) {
          throw new Error(`All methods failed to read Aerodrome V3 slot0: ${e3.message}`);
        }
      }
    }

    const [liquidity, token0, token1] = await Promise.all([
      poolContract.liquidity(),
      poolContract.token0(),
      poolContract.token1()
    ]);

    const hasLiquidity = liquidity > 0n;

    // CRITICAL: Validate that the token is actually in this pool
    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const isToken1 = token1.toLowerCase() === tokenAddress.toLowerCase();
    if (!isToken0 && !isToken1) {
      console.error(`[Aerodrome V3] ❌ Token ${tokenAddress.slice(0,10)} is NOT in pool ${poolConfig.address.slice(0,10)}`);
      console.error(`               Pool contains: token0=${token0.slice(0,10)}, token1=${token1.slice(0,10)}`);
      throw new Error(`Token ${tokenAddress} not found in pool. Pool contains ${token0} and ${token1}`);
    }

    // Get actual decimals for both tokens from the blockchain
    const [decimals0Actual, decimals1Actual] = await Promise.all([
      this.getTokenDecimalsByAddress(token0),
      this.getTokenDecimalsByAddress(token1)
    ]);
    console.log(`[Aerodrome V3] Token ${tokenAddress.slice(0,10)} isToken0=${isToken0}`);
    console.log(`               token0=${token0.slice(0,10)} (${decimals0Actual} decimals)`);
    console.log(`               token1=${token1.slice(0,10)} (${decimals1Actual} decimals)`);

    return {
      address: poolConfig.address,
      type: 'AERODROME_V3',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      decimals0: decimals0Actual,
      decimals1: decimals1Actual,
      fee: poolConfig.fee, // Use fee from config
      sqrtPriceX96: slot0Data[0].toString(),
      tick: Number(slot0Data[1]),
      liquidity: liquidity.toString(),
      hasLiquidity,
      config: poolConfig
    };
  }

  getTokenDecimals(tokenSymbol) {
    const standardDecimals = {
      'WBNB': 18,
      'USDC': 6,
      'USDT': 6,
      'DAI': 18,
    };

    if (standardDecimals[tokenSymbol]) {
      return standardDecimals[tokenSymbol];
    }

    for (const [address, agentConfig] of Object.entries(config.agentTokens || {})) {
      if (agentConfig.symbol === tokenSymbol) {
        return agentConfig.decimals;
      }
    }

    return 18;
  }

  /**
   * Get token decimals by address (for dynamically added tokens)
   * Returns decimals from known addresses or fetches from contract
   */
  async getTokenDecimalsByAddress(tokenAddress) {
    const addr = tokenAddress.toLowerCase();

    // Known token addresses on Base
    const knownDecimals = {
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 18, // WBNB
      '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56': 18, // BUSD
      '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': 6,  // USDT
    };

    if (knownDecimals[addr]) {
      return knownDecimals[addr];
    }

    // Try to fetch from contract
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function decimals() view returns (uint8)'],
        this.provider
      );
      const decimals = await tokenContract.decimals();
      console.log(`[PriceMonitor] Fetched decimals for ${tokenAddress}: ${decimals}`);
      return Number(decimals);
    } catch (err) {
      console.warn(`[PriceMonitor] Failed to fetch decimals for ${tokenAddress}, defaulting to 18`);
      return 18;
    }
  }
  
  // ==================== EVENT LISTENERS WITH TRACKING ====================
  
  async setupPoolListener(pool, tokenAddress) {
    try {
      const poolDesc = pool.config ? pool.config.description : `${pool.pair} ${pool.type}`;
      // CRITICAL: Normalize addresses to lowercase for consistent key matching
      const normalizedPoolAddr = pool.address.toLowerCase();
      const normalizedTokenAddr = tokenAddress.toLowerCase();
      const listenerKey = `${normalizedPoolAddr}-${normalizedTokenAddr}`;

      // Clean up ALL old listeners for this pool+token combo (handles both checksum and lowercase keys)
      const keysToRemove = [];
      for (const [key, listener] of this.activeListeners) {
        // Check if this listener is for the same pool+token (case-insensitive)
        const keyLower = key.toLowerCase();
        if (keyLower === listenerKey) {
          listener.contract.removeAllListeners();
          keysToRemove.push(key);
          console.log(`     🧹 Cleaned up old listener (key: ${key.slice(0, 20)}...)`);
        }
      }
      keysToRemove.forEach(k => this.activeListeners.delete(k));

      // Also clean up from poolContracts map (handles both cases)
      for (const [addr, contract] of this.poolContracts) {
        if (addr.toLowerCase() === normalizedPoolAddr) {
          contract.removeAllListeners();
          this.poolContracts.delete(addr);
          console.log(`     🧹 Cleaned up poolContract for ${addr.slice(0, 10)}...`);
        }
      }

      console.log(`     👂 Setting up listener for ${poolDesc}`);
      console.log(`     📍 Pool address: ${pool.address}`);
      console.log(`     💱 Pair token: ${pool.config?.pair || 'UNKNOWN'}`);
      console.log(`     📊 Pool type: ${pool.type}`);
      console.log(`     🔧 Full config:`, JSON.stringify({
        address: pool.address,
        type: pool.type,
        pair: pool.config?.pair,
        symbol: pool.config?.symbol,
        dex: pool.config?.dex
      }));

      if (pool.type === 'AERODROME_V2') {
        await this.setupAerodromeV2Listener(pool, tokenAddress);
      } else if (pool.type === 'AERODROME_V3') {
        await this.setupAerodromeV3Listener(pool, tokenAddress);
      } else if (pool.type === 'V2') {
        await this.setupV2Listener(pool, tokenAddress);
      } else {
        await this.setupV3Listener(pool, tokenAddress);
      }

      console.log(`       ✅ Listening to events`);
      
    } catch (error) {
      console.error(`Failed to setup listener:`, error.message);
      this.metrics.addError(error);
    }
  }
  
  async setupV2Listener(pool, tokenAddress) {
    const abi = [
      'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)'
    ];

    const poolContract = new ethers.Contract(pool.address, abi, this.provider);

    // CRITICAL: Normalize addresses to lowercase for consistent key matching
    const normalizedPoolAddr = pool.address.toLowerCase();
    const normalizedTokenAddr = tokenAddress.toLowerCase();

    // Track this listener
    const listenerKey = `${normalizedPoolAddr}-${normalizedTokenAddr}`;
    this.activeListeners.set(listenerKey, {
      contract: poolContract,
      tokenAddress: normalizedTokenAddr,
      poolType: 'V2'
    });

    this.poolContracts.set(normalizedPoolAddr, poolContract);

    // Listen to Swap events only (Sync is redundant as Swap already updates reserves)
    // OPTIMIZED: Broadcast swap event IMMEDIATELY without waiting for reserves (saves 50-200ms)
    console.log(`     🎯 V2 Listener active for token=${normalizedTokenAddr} pool=${normalizedPoolAddr}`);

    // DEBUG: Verify contract can receive events
    const filter = poolContract.filters.Swap();
    console.log(`     📋 Event filter created:`, filter);

    // Test: Query recent events to verify contract works
    try {
      const recentEvents = await poolContract.queryFilter(filter, -100);
      console.log(`     📜 Recent Swap events (last 100 blocks): ${recentEvents.length}`);
      if (recentEvents.length > 0) {
        console.log(`     📜 Last event block: ${recentEvents[recentEvents.length - 1].blockNumber}`);
      }
    } catch (e) {
      console.log(`     ⚠️ Could not query recent events: ${e.message}`);
    }

    const listenerCount = await poolContract.listenerCount('Swap');
    console.log(`     📊 Current Swap listeners before: ${listenerCount}`);

    poolContract.on('Swap', async (...args) => {
      const [sender, amount0In, amount1In, amount0Out, amount1Out, to, event] = args;
      console.log(`\n🔔 [V2 Swap Event Received] pool=${normalizedPoolAddr.slice(0,10)}, args count: ${args.length}`);
      this.metrics.increment('eventsReceived');

      // Determine buy/sell and amounts IMMEDIATELY from swap data (no RPC call needed)
      const isToken0 = pool.token0.toLowerCase() === normalizedTokenAddr;
      console.log(`   isToken0=${isToken0}, pool.token0=${pool.token0?.slice(0,10)}, token=${normalizedTokenAddr.slice(0,10)}`);
      const swapInfo = this.parseV2SwapInfo(
        amount0In, amount1In, amount0Out, amount1Out,
        isToken0, pool.decimals0, pool.decimals1, pool.config
      );

      // Broadcast swap event to frontend clients IMMEDIATELY (fastest path)
      // NOTE: sender is router address, not user wallet - but speed is critical for confirmations
      // txHash is instant and can be used to verify real user on block explorer
      const tokenData = this.monitoredTokens.get(normalizedTokenAddr);
      console.log(`   tokenData found: ${!!tokenData}, symbol: ${tokenData?.config?.symbol}`);
      const tokenAmountNum = parseFloat(swapInfo.tokenAmount.split(' ')[0]) || 0;
      const pairAmountNum = parseFloat(swapInfo.pairAmount.split(' ')[0]) || 0;
      const pairSymbol = pool.config.pair || 'WBNB';
      const isWbnbPair = pairSymbol === 'WBNB' || pairSymbol === 'BNB';
      const amountBNB = isWbnbPair ? pairAmountNum : 0;
      const priceUSD = tokenData?.lastPrice?.priceUSD || 0;
      const valueUSD = tokenAmountNum * priceUSD;

      // INSTANT broadcast - no waiting, no RPC calls
      // Pass event object for background user address fetch
      // ethers v6: txHash is at event.log.transactionHash
      const txHash = event.log?.transactionHash || event.transactionHash || '';
      this.broadcastSwapEvent({
        tokenAddress,
        symbol: tokenData?.config?.symbol || pool.config?.symbol || 'TOKEN',
        poolAddress: pool.address,
        txHash,
        isBuy: swapInfo.isBuy,
        amountBNB,
        amountToken: tokenAmountNum,
        pairSymbol,
        pairAmount: pairAmountNum,
        priceUSD,
        valueUSD,
        event // For background user address fetch
      });

      // Run all background tasks in parallel (non-blocking)
      // Reserves update is now background - not needed for swap broadcast
      Promise.all([
        // Update reserves in background (for future price calculations)
        poolContract.getReserves().then(reserves => {
          pool.reserve0 = reserves[0];
          pool.reserve1 = reserves[1];
        }).catch(() => {}),
        // Handle swap confirmation
        this.handleSwapConfirmation({
          event,
          tokenAddress: normalizedTokenAddr,
          poolAddress: normalizedPoolAddr,
          protocol: 'uniswapv2',
          userAddress: pool.config.userAddress,
          swapInfo,
          sender,
          recipient: to
        }),
        // Handle price update
        this.handlePriceUpdate(normalizedTokenAddr, swapInfo)
      ]).catch(() => {});
    });

    // Verify listener was added
    const finalListenerCount = await poolContract.listenerCount('Swap');
    console.log(`     📊 Swap listeners after setup: ${finalListenerCount}`);
  }

  async setupV3Listener(pool, tokenAddress) {
    const abi = [
      'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
      'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'
    ];

    const poolContract = new ethers.Contract(pool.address, abi, this.provider);

    // CRITICAL: Normalize addresses to lowercase for consistent key matching
    const normalizedPoolAddr = pool.address.toLowerCase();
    const normalizedTokenAddr = tokenAddress.toLowerCase();

    // Track this listener
    const listenerKey = `${normalizedPoolAddr}-${normalizedTokenAddr}`;
    this.activeListeners.set(listenerKey, {
      contract: poolContract,
      tokenAddress: normalizedTokenAddr,
      poolType: 'V3'
    });

    this.poolContracts.set(normalizedPoolAddr, poolContract);

    // Listen to Swap events
    console.log(`     🎯 V3 Listener active for token=${normalizedTokenAddr} pool=${normalizedPoolAddr}`);
    poolContract.on('Swap', async (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick, event) => {
      console.log(`\n🔔 [V3 Swap Event Received] pool=${normalizedPoolAddr.slice(0,10)}`);
      this.metrics.increment('eventsReceived');

      pool.sqrtPriceX96 = sqrtPriceX96.toString();

      // Determine buy/sell and amounts
      const isToken0 = pool.token0.toLowerCase() === normalizedTokenAddr;
      console.log(`   isToken0=${isToken0}, pool.token0=${pool.token0?.slice(0,10)}, normalizedTokenAddr=${normalizedTokenAddr.slice(0,10)}`);
      const swapInfo = this.parseV3SwapInfo(
        amount0, amount1, isToken0, pool.decimals0, pool.decimals1, pool.config
      );

      // Run confirmation and price update in parallel for faster confirmation emission
      // Confirmation will be sent ~100-300ms faster than waiting for price calculations
      const confirmationPromise = this.handleSwapConfirmation({
        event,
        tokenAddress: normalizedTokenAddr,
        poolAddress: normalizedPoolAddr,
        protocol: 'uniswapv3',
        userAddress: pool.config.userAddress,
        swapInfo,
        sender,
        recipient
      });

      // Broadcast swap event to frontend clients IMMEDIATELY (fastest path)
      // NOTE: sender is router address, not user wallet - but speed is critical for confirmations
      // txHash is instant and can be used to verify real user on block explorer
      const tokenData = this.monitoredTokens.get(normalizedTokenAddr);
      const ethPrice = this.bnbPrice || 0;
      const tokenAmountNum = parseFloat(swapInfo.tokenAmount.split(' ')[0]) || 0;
      const pairAmountNum = parseFloat(swapInfo.pairAmount.split(' ')[0]) || 0;
      const pairSymbol = pool.config.pair || 'WBNB';
      const isWbnbPair = pairSymbol === 'WBNB' || pairSymbol === 'BNB';
      const amountBNB = isWbnbPair ? pairAmountNum : 0;
      const priceUSD = tokenData?.lastPrice?.priceUSD || 0;
      // Calculate valueUSD based on token amount * token price (more accurate)
      const valueUSD = tokenAmountNum * priceUSD;

      // ethers v6: txHash is at event.log.transactionHash
      const txHash = event.log?.transactionHash || event.transactionHash || '';
      this.broadcastSwapEvent({
        tokenAddress: normalizedTokenAddr,
        symbol: tokenData?.config?.symbol || pool.config?.symbol || 'TOKEN',
        poolAddress: normalizedPoolAddr,
        txHash,
        isBuy: swapInfo.isBuy,
        amountBNB,
        amountToken: tokenAmountNum,
        pairSymbol,
        pairAmount: pairAmountNum,
        priceUSD,
        valueUSD,
        event // For background user address fetch
      });

      const priceUpdatePromise = this.handlePriceUpdate(normalizedTokenAddr, swapInfo);

      // Wait for both to complete
      await Promise.all([confirmationPromise, priceUpdatePromise]);
    });
  }

  async setupAerodromeV2Listener(pool, tokenAddress) {
    const abi = [
      'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)'
    ];

    const poolContract = new ethers.Contract(pool.address, abi, this.provider);

    // CRITICAL: Normalize addresses to lowercase for consistent key matching
    const normalizedPoolAddr = pool.address.toLowerCase();
    const normalizedTokenAddr = tokenAddress.toLowerCase();

    // Track this listener
    const listenerKey = `${normalizedPoolAddr}-${normalizedTokenAddr}`;
    this.activeListeners.set(listenerKey, {
      contract: poolContract,
      tokenAddress: normalizedTokenAddr,
      poolType: 'AERODROME_V2'
    });

    this.poolContracts.set(normalizedPoolAddr, poolContract);

    // Listen to Swap events only (Sync is redundant as Swap already updates reserves)
    // OPTIMIZED: Broadcast swap event IMMEDIATELY without waiting for reserves (saves 50-200ms)
    poolContract.on('Swap', async (sender, amount0In, amount1In, amount0Out, amount1Out, to, event) => {
      this.metrics.increment('eventsReceived');

      // Determine buy/sell and amounts IMMEDIATELY from swap data (no RPC call needed)
      const isToken0 = pool.token0.toLowerCase() === normalizedTokenAddr;
      const swapInfo = this.parseV2SwapInfo(
        amount0In, amount1In, amount0Out, amount1Out,
        isToken0, pool.decimals0, pool.decimals1, pool.config
      );

      // Broadcast swap event to frontend clients IMMEDIATELY (fastest path)
      // NOTE: sender is router address, not user wallet - but speed is critical for confirmations
      // txHash is instant and can be used to verify real user on block explorer
      const tokenData = this.monitoredTokens.get(normalizedTokenAddr);
      const tokenAmountNum = parseFloat(swapInfo.tokenAmount.split(' ')[0]) || 0;
      const pairAmountNum = parseFloat(swapInfo.pairAmount.split(' ')[0]) || 0;
      const pairSymbol = pool.config.pair || 'WBNB';
      const isWbnbPair = pairSymbol === 'WBNB' || pairSymbol === 'BNB';
      const amountBNB = isWbnbPair ? pairAmountNum : 0;
      const priceUSD = tokenData?.lastPrice?.priceUSD || 0;
      const valueUSD = tokenAmountNum * priceUSD;

      // INSTANT broadcast - no waiting, no RPC calls
      // ethers v6: txHash is at event.log.transactionHash
      const txHash = event.log?.transactionHash || event.transactionHash || '';
      this.broadcastSwapEvent({
        tokenAddress: normalizedTokenAddr,
        symbol: tokenData?.config?.symbol || pool.config?.symbol || 'TOKEN',
        poolAddress: normalizedPoolAddr,
        txHash,
        isBuy: swapInfo.isBuy,
        amountBNB,
        amountToken: tokenAmountNum,
        pairSymbol,
        pairAmount: pairAmountNum,
        priceUSD,
        valueUSD,
        event // For background user address fetch
      });

      // Run all background tasks in parallel (non-blocking)
      Promise.all([
        // Update reserves in background
        poolContract.getReserves().then(reserves => {
          pool.reserve0 = reserves[0];
          pool.reserve1 = reserves[1];
        }).catch(() => {}),
        // Handle swap confirmation
        this.handleSwapConfirmation({
          event,
          tokenAddress: normalizedTokenAddr,
          poolAddress: normalizedPoolAddr,
          protocol: 'aerodromev2',
          userAddress: pool.config.userAddress,
          swapInfo,
          sender,
          recipient: to
        }),
        // Handle price update
        this.handlePriceUpdate(normalizedTokenAddr, swapInfo)
      ]).catch(() => {});
    });
  }

  async setupAerodromeV3Listener(pool, tokenAddress) {
    const abi = [
      'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
    ];

    const poolContract = new ethers.Contract(pool.address, abi, this.provider);

    // CRITICAL: Normalize addresses to lowercase for consistent key matching
    const normalizedPoolAddr = pool.address.toLowerCase();
    const normalizedTokenAddr = tokenAddress.toLowerCase();

    // Track this listener
    const listenerKey = `${normalizedPoolAddr}-${normalizedTokenAddr}`;
    this.activeListeners.set(listenerKey, {
      contract: poolContract,
      tokenAddress: normalizedTokenAddr,
      poolType: 'AERODROME_V3'
    });

    this.poolContracts.set(normalizedPoolAddr, poolContract);

    // Listen to Swap events - V3 already has sqrtPriceX96 in event (no extra RPC needed)
    // OPTIMIZED: Broadcast swap event IMMEDIATELY
    poolContract.on('Swap', async (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick, event) => {
      this.metrics.increment('eventsReceived');

      pool.sqrtPriceX96 = sqrtPriceX96.toString();

      // Determine buy/sell and amounts IMMEDIATELY from swap data
      const isToken0 = pool.token0.toLowerCase() === normalizedTokenAddr;
      const swapInfo = this.parseV3SwapInfo(
        amount0, amount1, isToken0, pool.decimals0, pool.decimals1, pool.config
      );

      // Broadcast swap event to frontend clients IMMEDIATELY (fastest path)
      // NOTE: sender is router address, not user wallet - but speed is critical for confirmations
      // txHash is instant and can be used to verify real user on block explorer
      const tokenData = this.monitoredTokens.get(normalizedTokenAddr);
      const tokenAmountNum = parseFloat(swapInfo.tokenAmount.split(' ')[0]) || 0;
      const pairAmountNum = parseFloat(swapInfo.pairAmount.split(' ')[0]) || 0;
      const pairSymbol = pool.config.pair || 'WBNB';
      const isWbnbPair = pairSymbol === 'WBNB' || pairSymbol === 'BNB';
      const amountBNB = isWbnbPair ? pairAmountNum : 0;
      const priceUSD = tokenData?.lastPrice?.priceUSD || 0;
      const valueUSD = tokenAmountNum * priceUSD;

      // INSTANT broadcast - no waiting, no RPC calls
      // ethers v6: txHash is at event.log.transactionHash
      const txHash = event.log?.transactionHash || event.transactionHash || '';
      this.broadcastSwapEvent({
        tokenAddress: normalizedTokenAddr,
        symbol: tokenData?.config?.symbol || pool.config?.symbol || 'TOKEN',
        poolAddress: normalizedPoolAddr,
        txHash,
        isBuy: swapInfo.isBuy,
        amountBNB,
        amountToken: tokenAmountNum,
        pairSymbol,
        pairAmount: pairAmountNum,
        priceUSD,
        valueUSD,
        event // For background user address fetch
      });

      // Run background tasks in parallel (non-blocking)
      Promise.all([
        this.handleSwapConfirmation({
          event,
          tokenAddress: normalizedTokenAddr,
          poolAddress: normalizedPoolAddr,
          protocol: 'aerodromev3',
          userAddress: pool.config.userAddress,
          swapInfo,
          sender,
          recipient
        }),
        this.handlePriceUpdate(normalizedTokenAddr, swapInfo)
      ]).catch(() => {});
    });
  }

  // ==================== SWAP INFO PARSING ====================

  parseV2SwapInfo(amount0In, amount1In, amount0Out, amount1Out, isToken0, decimals0, decimals1, poolConfig) {
    // V2: amount0In/Out, amount1In/Out are all positive
    // If our token has Out > 0, someone is selling it (we get Out tokens)
    // If our token has In > 0, someone is buying it (they send In tokens)

    let tokenAmountRaw, pairAmountRaw, isBuy;

    if (isToken0) {
      // Our token is token0
      if (amount0Out > 0n) {
        // Token0 going out = someone buying token0 (BUY)
        tokenAmountRaw = amount0Out;
        pairAmountRaw = amount1In;
        isBuy = true;
      } else {
        // Token0 coming in = someone selling token0 (SELL)
        tokenAmountRaw = amount0In;
        pairAmountRaw = amount1Out;
        isBuy = false;
      }
    } else {
      // Our token is token1
      if (amount1Out > 0n) {
        // Token1 going out = someone buying token1 (BUY)
        tokenAmountRaw = amount1Out;
        pairAmountRaw = amount0In;
        isBuy = true;
      } else {
        // Token1 coming in = someone selling token1 (SELL)
        tokenAmountRaw = amount1In;
        pairAmountRaw = amount0Out;
        isBuy = false;
      }
    }

    const tokenAmount = this.formatAmount(tokenAmountRaw, isToken0 ? decimals0 : decimals1);
    const pairAmount = this.formatAmount(pairAmountRaw, isToken0 ? decimals1 : decimals0);

    return {
      isBuy,
      tokenAmount: `${tokenAmount} ${poolConfig.pair === 'WBNB' ? 'tokens' : poolConfig.pair}`,
      pairAmount: `${pairAmount} ${poolConfig.pair}`,
      eventType: 'Swap (V2)'
    };
  }

  parseV3SwapInfo(amount0, amount1, isToken0, decimals0, decimals1, poolConfig) {
    // V3: amounts are signed integers (negative = out, positive = in)
    // If our token amount is negative, tokens go out = BUY
    // If our token amount is positive, tokens come in = SELL

    let tokenAmountRaw, pairAmountRaw, isBuy;

    if (isToken0) {
      // Our token is token0
      tokenAmountRaw = amount0 < 0n ? -amount0 : amount0;
      pairAmountRaw = amount1 < 0n ? -amount1 : amount1;
      isBuy = amount0 < 0n; // Negative = out = someone buying
    } else {
      // Our token is token1
      tokenAmountRaw = amount1 < 0n ? -amount1 : amount1;
      pairAmountRaw = amount0 < 0n ? -amount0 : amount0;
      isBuy = amount1 < 0n; // Negative = out = someone buying
    }

    const tokenAmount = this.formatAmount(tokenAmountRaw, isToken0 ? decimals0 : decimals1);
    const pairAmount = this.formatAmount(pairAmountRaw, isToken0 ? decimals1 : decimals0);

    return {
      isBuy,
      tokenAmount: `${tokenAmount} tokens`,
      pairAmount: `${pairAmount} ${poolConfig.pair}`,
      eventType: 'Swap (V3)'
    };
  }

  formatAmount(amount, decimals) {
    const formatted = Number(ethers.formatUnits(amount, decimals));
    if (formatted < 0.01) {
      return formatted.toExponential(4);
    } else if (formatted < 1000) {
      return formatted.toFixed(4);
    } else {
      return formatted.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
  }

  // ==================== PRICE CALCULATION ====================

  async handlePriceUpdate(tokenAddress, swapInfo = null) {
    try {
      const tokenData = this.monitoredTokens.get(tokenAddress);
      if (!tokenData) return;

      // Prevent duplicate updates within 100ms
      const now = Date.now();
      if (tokenData.lastUpdateCall && (now - tokenData.lastUpdateCall) < 100) {
        return; // Skip duplicate call
      }
      tokenData.lastUpdateCall = now;

      this.metrics.increment('priceUpdates');

      // Update BNB price periodically
      if (now - this.lastEthPriceUpdate > config.settings.updateBnbPriceInterval) {
        await this.updateBNBPrice();
      }

      // Update agent prices if needed
      const hasAgentPools = tokenData.config.pools.some(p => p.pairIsAgent);
      if (hasAgentPools) {
        await this.updateAllAgentPrices();
      }

      // Calculate new price
      const newPrice = await this.calculatePrice(tokenAddress, tokenData.pools);

      // Cache the new price immediately
      this.priceCache.set(tokenAddress, newPrice);

      // Check if price changed significantly
      const oldPrice = tokenData.lastPrice?.priceUSD || 0;
      const priceChange = oldPrice > 0 ? ((newPrice.priceUSD - oldPrice) / oldPrice) : 0;
      const percentChange = priceChange * 100;

      if (tokenData.pools.length > 1) {
        console.log(`  💰 Combined ${tokenData.config.symbol} Price: $${newPrice.priceUSD.toFixed(config.settings.decimalPlaces)} (${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%)`);
      }

      // Enhanced logging for price updates
      console.log('\n' + '='.repeat(60));
      console.log(`💲 PRICE UPDATE - ${tokenData.config.symbol || 'Token'}`);
      console.log('='.repeat(60));
      console.log(`📍 Token Address:  ${tokenAddress}`);
      console.log(`💰 Price USD:      $${newPrice.priceUSD.toFixed(config.settings.decimalPlaces)}`);
      console.log(`⚡ Price BNB:      ${newPrice.priceBNB.toFixed(8)} BNB`);
      if (oldPrice > 0) {
        const changeSymbol = percentChange >= 0 ? '📈' : '📉';
        console.log(`${changeSymbol} Change:         ${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%`);
      }
      console.log(`⏰ Timestamp:      ${new Date().toLocaleString()}`);
      console.log(`🏊 Pool Count:     ${newPrice.poolCount}`);

      // Display swap information if available
      if (swapInfo) {
        const actionIcon = swapInfo.isBuy ? '🟢 BUY' : '🔴 SELL';
        console.log(`📊 Action:         ${actionIcon}`);
        console.log(`💱 Amount:         ${swapInfo.tokenAmount}`);
        if (swapInfo.pairAmount) {
          console.log(`💵 For:            ${swapInfo.pairAmount}`);
        }
        console.log(`🔗 Event:          WebSocket Listener (Real-time)`);
      }

      if (tokenData.isDynamic) {
        console.log(`🔧 Type:           Dynamic (API added)`);
      }
      console.log('='.repeat(60) + '\n');

      // Broadcast if significant change or first price
      if (Math.abs(priceChange) >= config.settings.priceUpdateThreshold || oldPrice === 0) {
        tokenData.lastPrice = newPrice;
        tokenData.lastUpdate = now;

        this.broadcastPrice(tokenAddress, newPrice);
        console.log(`📡 Broadcasted ${tokenData.config.symbol} price: $${newPrice.priceUSD.toFixed(config.settings.decimalPlaces)}`);
      }

    } catch (error) {
      console.error('Price update error:', error.message);
      this.metrics.addError(error);
    }
  }
  
  async calculatePrice(tokenAddress, pools, providedConfig = null) {
    const prices = [];
    const tokenData = this.monitoredTokens.get(tokenAddress);
    const tokenConfig = providedConfig || (tokenData ? tokenData.config : config.tokens[tokenAddress.toLowerCase()]);
    
    for (const pool of pools) {
      try {
        let rawPrice;
        if (pool.type === 'V2' || pool.type === 'AERODROME_V2') {
          rawPrice = this.calculateV2Price(tokenAddress, pool);
        } else {
          // V3, AERODROME_V3
          rawPrice = this.calculateV3Price(tokenAddress, pool);
        }

        const price = await this.convertToUSD(rawPrice.priceInPair, pool, rawPrice.isToken0);
        
        if (price && price.priceUSD > 0) {
          prices.push({
            ...price,
            priority: pool.config.priority || 1,
            pool: pool.address,
            description: pool.config.description,
            pair: pool.config.pair
          });
        }
      } catch (error) {
        console.error(`Price calc error for ${pool.config.description}:`, error.message);
      }
    }
    
    if (prices.length === 0) {
      return { priceUSD: 0, priceBNB: 0 };
    }
    
    // Extract USD prices and remove outliers
    const usdPrices = prices.map(p => p.priceUSD);
    const cleanUsdPrices = this.removeOutliers(usdPrices);
    
    // Recalculate with clean prices
    const cleanPrices = prices.filter(p => cleanUsdPrices.includes(p.priceUSD));
    
    if (cleanPrices.length === 0) {
      // If all were outliers, use original
      return this.calculateWeightedAverage(prices, tokenConfig);
    }
    
    return this.calculateWeightedAverage(cleanPrices, tokenConfig);
  }
  
  calculateWeightedAverage(prices, tokenConfig) {
    const totalWeight = prices.reduce((sum, p) => sum + (1 / p.priority), 0);
    const weightedUSD = prices.reduce((sum, p) => sum + (p.priceUSD * (1 / p.priority)), 0) / totalWeight;
    const weightedBNB = prices.reduce((sum, p) => sum + (p.priceBNB * (1 / p.priority)), 0) / totalWeight;
    
    return {
      tokenAddress: tokenConfig.address || prices[0].tokenAddress,
      symbol: tokenConfig.symbol,
      name: tokenConfig.name,
      priceUSD: weightedUSD,
      priceBNB: weightedBNB,
      poolCount: prices.length,
      pools: prices,
      timestamp: new Date().toISOString()
    };
  }
  
  calculateV2Price(tokenAddress, pool) {
    const reserve0 = BigInt(pool.reserve0);
    const reserve1 = BigInt(pool.reserve1);
    
    if (reserve0 === 0n || reserve1 === 0n) {
      return { priceInPair: 0, isToken0: false };
    }
    
    const isToken0 = pool.token0 === tokenAddress.toLowerCase();
    
    let priceInPair;
    if (isToken0) {
      priceInPair = Number(ethers.formatUnits(reserve1, pool.decimals1)) / 
                    Number(ethers.formatUnits(reserve0, pool.decimals0));
    } else {
      priceInPair = Number(ethers.formatUnits(reserve0, pool.decimals0)) / 
                    Number(ethers.formatUnits(reserve1, pool.decimals1));
    }
    
    return { priceInPair, isToken0 };
  }
  
  calculateV3Price(tokenAddress, pool) {
    if (!pool.sqrtPriceX96) {
      return { priceInPair: 0, isToken0: false };
    }

    const isToken0 = pool.token0 === tokenAddress.toLowerCase();

    // Use BigInt for precise sqrtPriceX96 calculation
    // sqrtPriceX96 = sqrt(token1/token0) * 2^96
    // price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
    const sqrtPriceX96Bi = BigInt(pool.sqrtPriceX96);
    const Q192 = BigInt(2) ** BigInt(192);

    // Calculate price with high precision using BigInt then convert to Number
    // Multiply by 10^18 first to preserve decimals, then divide
    const PRECISION = BigInt(10) ** BigInt(18);
    const priceWithPrecision = (sqrtPriceX96Bi * sqrtPriceX96Bi * PRECISION) / Q192;
    let rawPrice = Number(priceWithPrecision) / 1e18;

    // Debug: show raw values
    console.log(`[V3 Price Debug] token=${tokenAddress.slice(0,10)}, isToken0=${isToken0}`);
    console.log(`  sqrtPriceX96=${pool.sqrtPriceX96}`);
    console.log(`  rawPrice (before decimal adj)=${rawPrice.toExponential(6)}`);
    console.log(`  decimals0=${pool.decimals0}, decimals1=${pool.decimals1}`);
    console.log(`  token0=${pool.token0?.slice(0,10)}, token1=${pool.token1?.slice(0,10)}`);

    // Convert to human-readable by adjusting for decimal differences
    // rawPrice = token1_raw / token0_raw
    // humanPrice = rawPrice * 10^(decimals0 - decimals1)
    if (pool.decimals0 !== pool.decimals1) {
      rawPrice = rawPrice * Math.pow(10, pool.decimals0 - pool.decimals1);
    }
    console.log(`  rawPrice (after decimal adj)=${rawPrice.toExponential(6)}`);

    let priceInPair;
    if (isToken0) {
      // Our token is token0, price is in terms of token1 (pair token)
      priceInPair = rawPrice;
    } else {
      // Our token is token1, need to invert
      priceInPair = 1 / rawPrice;
    }
    console.log(`  priceInPair=${priceInPair.toExponential(6)}`);

    return { priceInPair, isToken0 };
  }
  
  async convertToUSD(priceInPair, pool, isToken0) {
    const pairAddress = pool.config.pairAddress || (isToken0 ? pool.token1 : pool.token0);
    const pairSymbol = pool.config.pair;
    
    let priceUSD = 0;
    let priceBNB = 0;
    
    if (pairSymbol === 'WBNB') {
      priceBNB = priceInPair;
      priceUSD = priceBNB * this.bnbPrice;
    } else if (pairSymbol === 'USDC' || pairSymbol === 'USDT' || pairSymbol === 'DAI') {
      priceUSD = priceInPair;
      priceBNB = priceUSD / this.bnbPrice;
    } else if (pool.config.pairIsAgent) {
      const agentPriceUSD = await this.getAgentTokenPrice(pairAddress);
      
      if (agentPriceUSD > 0) {
        priceUSD = priceInPair * agentPriceUSD;
        priceBNB = priceUSD / this.bnbPrice;
        
        if (config.settings.enableDebugLogs) {
          console.log(`      Using ${pairSymbol} price: $${agentPriceUSD.toFixed(6)}`);
        }
      } else {
        console.warn(`      ⚠️  No price available for agent token ${pairSymbol}`);
      }
    } else {
      console.warn(`Unknown pair type: ${pairSymbol}`);
    }
    
    return { priceUSD, priceBNB };
  }
  
  // ==================== BROADCASTING ====================
  
  broadcastPrice(tokenAddress, priceData) {
    const update = {
      ...priceData,
      formatted: {
        priceUSD: `$${priceData.priceUSD.toFixed(config.settings.decimalPlaces)}`,
        priceBNB: `${priceData.priceBNB.toFixed(config.settings.decimalPlaces)} BNB`,
        change24h: null,
        marketCap: null,
      }
    };
    
    this.io.to(`token:${tokenAddress.toLowerCase()}`).emit('price-update', update);
    this.io.emit('global-price-update', update);
  }

  /**
   * Broadcast swap event to all connected frontend clients
   */
  broadcastSwapEvent(swapData) {
    const swapEvent = {
      tokenAddress: swapData.tokenAddress,
      symbol: swapData.symbol || 'TOKEN',
      poolAddress: swapData.poolAddress,
      txHash: swapData.txHash || '',
      type: swapData.isBuy ? 'buy' : 'sell',
      sender: '', // Will be updated via swap-update event
      amountBNB: swapData.amountBNB || 0,
      amountToken: swapData.amountToken || 0,
      pairSymbol: swapData.pairSymbol || 'BNB',
      pairAmount: swapData.pairAmount || 0,
      priceUSD: swapData.priceUSD || 0,
      valueUSD: swapData.valueUSD || 0,
      timestamp: Date.now()
    };

    // Emit only to clients subscribed to this token's room
    const room = `token:${swapData.tokenAddress.toLowerCase()}`;
    this.io.to(room).emit('swap-event', swapEvent);
    console.log(`📡 Broadcast swap-event to ${room}:`);
    console.log(`   Type: ${swapEvent.type.toUpperCase()} ${swapEvent.symbol}`);
    console.log(`   Pool: ${swapEvent.poolAddress}`);
    console.log(`   Pair: ${swapEvent.pairAmount?.toFixed(4)} ${swapEvent.pairSymbol}`);
    console.log(`   Value: $${swapEvent.valueUSD?.toFixed(2)}`);
    console.log(`   TxHash: ${swapEvent.txHash ? swapEvent.txHash.slice(0, 20) + '...' : '(empty - ethers v6 issue?)'}`);

    // Fetch real user address in background and send update (non-blocking)
    if (swapData.event) {
      swapData.event.getTransaction().then(tx => {
        if (tx && tx.from) {
          this.io.to(room).emit('swap-update', {
            txHash: swapData.txHash,
            sender: tx.from // Real user wallet address
          });
          console.log(`   👤 Real user: ${tx.from.slice(0, 10)}...`);
        }
      }).catch(() => {});
    }
  }
  
  // ==================== PUBLIC MBNBODS ====================
  
  getMonitoredTokens() {
    const tokens = [];
    for (const [address, data] of this.monitoredTokens) {
      tokens.push({
        address,
        ...data.config,
        lastPrice: data.lastPrice,
        lastUpdate: data.lastUpdate
      });
    }
    return tokens;
  }
  
  getTokenPrice(tokenAddress) {
    // First check cache
    const cached = this.priceCache.get(tokenAddress);
    if (cached) {
      this.metrics.increment('cacheHits');
      return cached;
    }
    
    // Fallback to stored data
    this.metrics.increment('cacheMisses');
    const data = this.monitoredTokens.get(ethers.getAddress(tokenAddress));
    return data ? data.lastPrice : null;
  }
  
  getCachedPrices() {
    return this.priceCache.getAll();
  }
  
  getMetrics() {
    return this.metrics.getStats();
  }
  
  async stop() {
    console.log('Stopping price monitor...');

    // Stop mempool monitoring
    if (this.mempoolMonitor) {
      this.mempoolMonitor.stop();
      console.log('⚡ Mempool monitor stopped');
    }

    // Clear intervals
    if (this.bnbPriceInterval) clearInterval(this.bnbPriceInterval);
    if (this.agentPriceInterval) clearInterval(this.agentPriceInterval);

    // Remove all listeners properly
    for (const [key, data] of this.activeListeners) {
      data.contract.removeAllListeners();
    }

    this.activeListeners.clear();
    this.poolContracts.clear();
    this.monitoredTokens.clear();
    this.agentTokenPrices.clear();
    this.priceCache.clear();

    // Close WebSocket
    if (this.provider?.websocket) {
      this.provider.websocket.close();
    }

    this.isConnected = false;
    console.log('✅ Price monitor stopped cleanly');
  }

  // ==================== SWAP CONFIRMATION INTEGRATION ====================

  /**
   * Start a swap confirmation listener for a specific pool/user
   */
  async startSwapListener({ tokenAddress, poolAddress, protocol, pairType, userAddress }) {
    const key = tokenAddress.toLowerCase();

    // Check if already listening
    if (this.swapListeners.has(key)) {
      console.log(`Already listening to swaps for ${tokenAddress}`);
      return this.swapListeners.get(key);
    }

    console.log(`\n🎧 Starting swap confirmation listener:`);
    console.log(`   Token: ${tokenAddress}`);
    console.log(`   Pool: ${poolAddress}`);
    console.log(`   Protocol: ${protocol}`);
    console.log(`   User: ${userAddress || 'ALL'}`);

    // Build token configuration based on protocol
    const tokenConfig = this.buildSwapListenerConfig({
      tokenAddress,
      poolAddress,
      protocol,
      pairType,
      userAddress
    });

    // Add the token to monitoring (this sets up the blockchain listener)
    const result = await this.addTokenWithConfig(tokenAddress, tokenConfig);

    if (result) {
      // Store swap listener info
      this.swapListeners.set(key, {
        tokenAddress,
        poolAddress,
        protocol,
        pairType,
        userAddress: userAddress || null,
        startedAt: Date.now(),
        status: 'listening',
        eventsDetected: 0
      });

      // Enable mempool monitoring for instant detection (0-100ms)
      if (this.mempoolMonitor) {
        // Need to determine if token is token0 or token1 in the pool
        // This is handled by the mempool monitor when decoding swap data
        await this.mempoolMonitor.addMonitoredPool(poolAddress, {
          tokenAddress,
          poolAddress,
          protocol,
          userAddress: userAddress || null,
          isToken0: null // Will be determined from swap event
        });
        console.log(`⚡ Mempool monitoring enabled for instant swap detection`);
      }

      console.log(`✅ Swap confirmation listener started for ${tokenAddress}\n`);
      return this.swapListeners.get(key);
    }

    return null;
  }

  /**
   * Stop a swap confirmation listener
   */
  stopSwapListener(tokenAddress) {
    const key = tokenAddress.toLowerCase();
    const listener = this.swapListeners.get(key);

    if (!listener) {
      return false;
    }

    // Disable mempool monitoring
    if (this.mempoolMonitor && listener.poolAddress) {
      this.mempoolMonitor.removeMonitoredPool(listener.poolAddress);
      console.log(`⚡ Mempool monitoring disabled for pool ${listener.poolAddress}`);
    }

    // Remove blockchain listeners
    const listenerData = this.activeListeners.get(key);
    if (listenerData) {
      for (const data of listenerData) {
        if (data.contract) {
          data.contract.removeAllListeners();
        }
      }
      this.activeListeners.delete(key);
    }

    // Remove from monitored tokens
    this.monitoredTokens.delete(key);
    this.swapListeners.delete(key);

    console.log(`✅ Stopped swap confirmation listener for ${tokenAddress}`);
    return true;
  }

  /**
   * Remove a dynamically added token from monitoring completely
   * Cleans up all listeners, caches, and state
   */
  removeDynamicToken(tokenAddress) {
    const key = tokenAddress.toLowerCase();

    // Check if token is being monitored
    const tokenData = this.monitoredTokens.get(key);
    if (!tokenData) {
      console.log(`Token ${tokenAddress} not found in monitoring`);
      return false;
    }

    console.log(`🛑 Removing token ${tokenAddress} from monitoring...`);

    // Remove event listeners for this token's pools
    for (const [listenerKey, listenerData] of this.activeListeners) {
      if (listenerKey.startsWith(`${key}:`)) {
        // Remove event listener from contract
        if (listenerData.contract && listenerData.listener) {
          try {
            listenerData.contract.off('Swap', listenerData.listener);
            console.log(`   Removed listener: ${listenerKey}`);
          } catch (e) {
            // Ignore errors during cleanup
          }
        }
        this.activeListeners.delete(listenerKey);
      }
    }

    // Remove from mempool monitor if present
    if (this.mempoolMonitor && tokenData.pools) {
      for (const pool of tokenData.pools) {
        if (pool.address) {
          this.mempoolMonitor.removeMonitoredPool(pool.address);
        }
      }
    }

    // Clean up pool contracts for this token
    if (tokenData.pools) {
      for (const pool of tokenData.pools) {
        if (pool.address) {
          this.poolContracts.delete(pool.address);
        }
      }
    }

    // Remove from caches and state
    this.monitoredTokens.delete(key);
    this.priceCache.delete(key);
    this.swapListeners.delete(key);

    console.log(`✅ Removed token ${tokenAddress} from monitoring`);
    return true;
  }

  /**
   * Get a specific swap listener
   */
  getSwapListener(tokenAddress) {
    return this.swapListeners.get(tokenAddress.toLowerCase()) || null;
  }

  /**
   * Get all active swap listeners
   */
  getActiveSwapListeners() {
    return Array.from(this.swapListeners.values());
  }

  /**
   * Build configuration for swap listener
   */
  buildSwapListenerConfig({ tokenAddress, poolAddress, protocol, pairType, userAddress }) {
    const poolType = this.getPoolTypeFromProtocol(protocol);
    const fee = protocol.includes('v3') || protocol === 'slipstream' ? 3000 : undefined;
    const pairSymbol = pairType.toUpperCase();

    // Get pair address from config.addresses
    const pairAddress = config.addresses[pairSymbol];

    return {
      address: tokenAddress,
      pools: [{
        address: poolAddress,
        type: poolType,
        pair: pairSymbol,
        pairAddress: pairAddress,
        fee,
        priority: 1,
        userAddress: userAddress || null, // Track user for filtering
        isSwapListener: true // Mark as swap confirmation listener
      }]
    };
  }

  /**
   * Get pool type from protocol string
   */
  getPoolTypeFromProtocol(protocol) {
    const protocolMap = {
      'uniswapv2': 'V2',
      'uniswapv3': 'V3',
      'aerodromev2': 'AERODROME_V2',
      'aerodromev3': 'AERODROME_V3',
      'slipstream': 'AERODROME_V3'
    };

    return protocolMap[protocol.toLowerCase()] || 'V2';
  }

  /**
   * Handle swap confirmation - extract tx details and emit to Swap Microservice
   * Called from all swap event handlers
   */
  async handleSwapConfirmation({ event, tokenAddress, poolAddress, protocol, userAddress, swapInfo, sender, recipient }) {
    try {
      // Check if this pool has swap listener enabled
      const listener = this.swapListeners.get(tokenAddress.toLowerCase());
      if (!listener) {
        return; // Not a swap confirmation listener, skip
      }

      // Filter by user address if specified
      if (listener.userAddress) {
        const targetUser = listener.userAddress.toLowerCase();
        const senderMatch = sender.toLowerCase() === targetUser;
        const recipientMatch = recipient.toLowerCase() === targetUser;

        if (!senderMatch && !recipientMatch) {
          console.log(`⏭️ Skipping swap - user address mismatch (expected: ${listener.userAddress})`);
          return; // Not the target user's swap
        }
      }

      // Extract transaction details
      const tx = await event.getTransaction();
      const receipt = await event.getTransactionReceipt();

      // Build swap confirmation data
      const swapConfirmation = {
        event: 'swap.confirmed',
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        tokenAddress,
        poolAddress,
        userAddress: recipient,
        operation: swapInfo.isBuy ? 'buy' : 'sell',
        status: 'confirmed',
        protocol,
        timestamp: Date.now()
      };

      // Emit to Swap Microservice
      await this.emitSwapConfirmation(swapConfirmation);

    } catch (error) {
      console.error('Error handling swap confirmation:', error);
      this.metrics.addError(error);
    }
  }

  /**
   * Emit swap confirmation to Swap Microservice
   * Called from event handlers when swap is detected
   */
  async emitSwapConfirmation(swapData) {
    if (!this.swapClient || !this.swapClient.isConnected()) {
      console.log('⚠️ Swap Microservice not connected, skipping confirmation emission');
      return false;
    }

    // Update listener stats
    const listener = this.swapListeners.get(swapData.tokenAddress.toLowerCase());
    if (listener) {
      listener.eventsDetected++;
    }

    // Emit to swap microservice
    return this.swapClient.emitSwapConfirmation(swapData);
  }
}

module.exports = PriceMonitor;