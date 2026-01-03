// src/utils/constants.js
// Application constants for BSC Price Listener

module.exports = {
  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_ERROR: 500
  },

  // Network Configuration
  NETWORK: {
    NAME: 'BSC',
    CHAIN_ID: 56,
    NATIVE_TOKEN: 'BNB',
    BLOCK_TIME: 3000, // ~3 seconds
    EXPLORER: 'https://bscscan.com'
  },

  // BSC Token Addresses
  ADDRESSES: {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
  },

  // PancakeSwap Contracts
  PANCAKESWAP: {
    V2_FACTORY: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    V2_ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
    V3_QUOTER: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
  },

  // Defaults
  DEFAULTS: {
    PORT: 3001,
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW: 60000, // 1 minute
    PRICE_DECIMAL_PLACES: 12,
    BNB_PRICE_DEFAULT: 600,
    HEARTBEAT_INTERVAL: 30000, // 30 seconds
    STALE_CONNECTION_TIMEOUT: 60000, // 60 seconds
    HEALTH_CHECK_INTERVAL: 30000 // 30 seconds
  },

  // DEX Types
  DEX_TYPES: {
    PANCAKESWAP: 'pancakeswap'
  },

  // Pool Types
  POOL_TYPES: {
    V2: 'V2',
    V3: 'V3'
  },

  // Known Base Pairs
  KNOWN_PAIRS: ['WBNB', 'USDT', 'USDC', 'BUSD'],

  // V3 Fee Tiers (PancakeSwap V3)
  V3_FEE_TIERS: [100, 500, 2500, 10000],

  // Service Info
  SERVICE: {
    NAME: 'BscPulse',
    VERSION: '1.0.0',
    DESCRIPTION: 'Real-time token price monitoring for BSC/PancakeSwap'
  },

  // WebSocket Events
  WS_EVENTS: {
    // Client -> Server
    SUBSCRIBE: 'subscribe',
    UNSUBSCRIBE: 'unsubscribe',
    PING: 'ping',
    GET_ALL_PRICES: 'get-all-prices',

    // Server -> Client
    WELCOME: 'welcome',
    SUBSCRIBED: 'subscribed',
    UNSUBSCRIBED: 'unsubscribed',
    PRICE_UPDATE: 'price-update',
    ALL_PRICES: 'all-prices',
    HEARTBEAT: 'heartbeat',
    PONG: 'pong',
    ERROR: 'error'
  }
};
