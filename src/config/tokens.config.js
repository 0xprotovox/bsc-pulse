// src/config/tokens.config.js
// Token configuration for BSC Price Bot

module.exports = {
  // BSC Mainnet Token Addresses
  addresses: {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    DAI: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  },

  // Service Settings
  settings: {
    // BNB price settings
    defaultBnbPrice: 600,
    updateBnbPriceInterval: 60000, // 1 minute

    // Agent token price settings (for tokens paired with non-stablecoins)
    updateAgentPriceInterval: 30000, // 30 seconds
    agentPriceCacheTTL: 10000, // 10 seconds

    // Logging
    enableDebugLogs: false,
    decimalPlaces: 8,

    // Reconnection settings
    maxReconnectAttempts: 10,
    reconnectDelay: 5000, // 5 seconds

    // Price update threshold (0.1% change triggers broadcast)
    priceUpdateThreshold: 0.001,
  },

  // Pre-configured tokens to monitor
  // Empty by default - use API to add tokens dynamically
  tokens: {
    // Example token config:
    // '0xTOKEN_ADDRESS': {
    //   symbol: 'TOKEN',
    //   name: 'Token Name',
    //   decimals: 18,
    //   pools: [
    //     {
    //       address: '0xPOOL_ADDRESS',
    //       type: 'V2',        // V2 or V3
    //       fee: 2500,         // Required for V3 (100, 500, 2500, 10000)
    //       tokenIndex: 0,     // 0 if token is token0, 1 if token is token1
    //       quoteToken: 'WBNB' // WBNB, USDC, USDT, BUSD
    //     }
    //   ]
    // }
  },

  // Agent tokens (tokens with multiple price sources)
  agentTokens: {},

  // Contract ABIs
  abis: {
    // PancakeSwap V2 Pool
    v2Pool: [
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
      'event Sync(uint112 reserve0, uint112 reserve1)'
    ],

    // PancakeSwap V3 Pool
    v3Pool: [
      'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function fee() view returns (uint24)',
      'function liquidity() view returns (uint128)',
      'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
    ],

    // ERC-20 Token
    erc20: [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function balanceOf(address) view returns (uint256)'
    ]
  },

  // BNB/USD Price Pool (PancakeSwap V3 WBNB/USDT 0.01% fee)
  bnbPricePool: {
    address: '0x36696169C63e42cd08ce11f5deeBbCeBae652050',
    type: 'V3',
    fee: 100
  },

  // BNB Price Sources (for multi-pool price averaging)
  bnbPriceSources: [
    {
      address: '0x36696169C63e42cd08ce11f5deeBbCeBae652050', // PancakeSwap V3 WBNB/USDT 0.01%
      type: 'V3',
      fee: 100,
      weight: 1,
      token0: 'WBNB',
      token1: 'USDT',
      decimals0: 18,
      decimals1: 18 // USDT on BSC has 18 decimals
    }
  ]
};
