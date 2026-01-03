<p align="center">
  <h1 align="center">BscPulse</h1>
  <p align="center">
    <strong>Real-time token price monitoring for BSC network</strong>
  </p>
  <p align="center">
    WebSocket-powered price feeds from PancakeSwap V2/V3 pools
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Socket.IO-4.x-010101?style=flat-square&logo=socket.io&logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/ethers.js-6.x-3C3C3D?style=flat-square&logo=ethereum&logoColor=white" alt="ethers.js" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/BSC-Mainnet-F0B90B?style=flat-square&logo=binance&logoColor=white" alt="BSC" />
</p>

---

## Features

- **Real-Time Price Monitoring** - Track token prices from PancakeSwap V2/V3 pools via WebSocket
- **WebSocket Broadcasting** - Socket.IO server pushes price updates to subscribed clients
- **Dynamic Token Management** - Add/remove tokens via REST API without restart
- **Multi-Pool Aggregation** - Aggregate prices from multiple pools with outlier filtering
- **Buy/Sell Detection** - Automatic swap direction detection from blockchain events
- **Connection Management** - Automatic cleanup of stale WebSocket connections
- **Rate Limiting** - Built-in protection against API abuse
- **Health Monitoring** - Health checks with uptime and metrics

## Quick Start

### Prerequisites

- Node.js 18+
- BSC WebSocket RPC URL (Alchemy, QuickNode, or public)

### Installation

```bash
# Clone the repository
git clone https://github.com/0xprotovox/bsc-pulse.git
cd bsc-pulse

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your RPC URL

# Start the server
npm start
```

### Development

```bash
# Run with hot reload
npm run dev

# Test WebSocket client
npm test
```

## Configuration

Create a `.env` file:

```env
# Required: BSC WebSocket RPC
WSS_URL=wss://bnb-mainnet.g.alchemy.com/v2/YOUR_KEY

# Optional
PORT=3001
RPC_URL=https://bsc-dataseed.binance.org
```

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with metrics |
| GET | `/api/tokens` | List configured tokens |
| GET | `/api/tokens/monitored` | List actively monitored tokens |
| GET | `/api/prices` | Get all cached prices |
| GET | `/api/prices/:token` | Get specific token price |
| GET | `/api/metrics` | System metrics |
| POST | `/api/monitor` | Add token to monitoring |
| POST | `/api/monitor-dynamic` | Add multiple tokens with config |

### WebSocket Events

#### Client -> Server

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{tokenAddress: '0x...'}` | Subscribe to token updates |
| `unsubscribe` | `{tokenAddress: '0x...'}` | Unsubscribe from token |
| `ping` | - | Keep-alive ping |
| `get-all-prices` | - | Request all cached prices |

#### Server -> Client

| Event | Description |
|-------|-------------|
| `welcome` | Connection confirmation |
| `subscribed` | Subscription confirmed with current price |
| `price-update` | Real-time price update |
| `all-prices` | Response to get-all-prices |
| `heartbeat` | Periodic system status (30s) |
| `pong` | Response to ping |
| `error` | Error message |

## Usage Examples

### JavaScript Client

```javascript
const { io } = require('socket.io-client');

const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('Connected to BscPriceBot');

  // Subscribe to CAKE token
  socket.emit('subscribe', {
    tokenAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
  });
});

socket.on('price-update', (data) => {
  console.log(`${data.symbol}: $${data.priceUSD.toFixed(4)}`);
});

socket.on('subscribed', (data) => {
  console.log(`Subscribed to ${data.tokenAddress}`);
  console.log(`Current price: $${data.currentPrice?.priceUSD || 'N/A'}`);
});
```

### Add Token via API

```bash
# Simple: Just token address (auto-discovers pools)
curl -X POST http://localhost:3001/api/monitor \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"}'

# Advanced: With pool configuration
curl -X POST http://localhost:3001/api/monitor-dynamic \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": [{
      "tokenAddress": "0xTOKEN",
      "poolAddress": "0xPOOL",
      "pair": "WBNB",
      "version": 2
    }]
  }'
```

## Architecture

```
src/
├── index.js                 # Application entry point
├── config/
│   └── tokens.config.js     # Token and pool configuration
├── services/
│   ├── PriceMonitor.js      # Core price monitoring
│   ├── ConnectionManager.js # WebSocket connection management
│   ├── MempoolMonitor.js    # Pending transaction monitoring
│   └── SwapMicroserviceClient.js
├── routes/
│   ├── health.routes.js     # Health endpoints
│   ├── prices.routes.js     # Price query endpoints
│   ├── monitoring.routes.js # Token monitoring control
│   └── listener.routes.js   # Swap listener control
├── middlewares/
│   ├── rateLimiter.js       # Rate limiting
│   ├── errorHandler.js      # Error handling
│   ├── logger.js            # Request logging
│   └── validator.js         # Input validation
└── utils/
    ├── constants.js         # Application constants
    └── formatters.js        # Data formatters
```

## Price Calculation

### V2 Pools (Constant Product AMM)
```
price = reserve_quote / reserve_token
```

### V3 Pools (Concentrated Liquidity)
```
price = (sqrtPriceX96 / 2^96)^2
```

Adjusted for token decimals and converted to USD via BNB price.

## Performance

| Metric | Value |
|--------|-------|
| Price Update Latency | < 500ms |
| WebSocket Connections | 1000+ concurrent |
| Memory Usage | ~50-100MB |
| Cache Hit Rate | ~90% |

## Supported Protocols

| Protocol | Type | Factory |
|----------|------|---------|
| PancakeSwap V2 | Constant Product | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| PancakeSwap V3 | Concentrated Liquidity | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |

## Production Deployment

### PM2 Setup

```bash
npm install -g pm2

# Start
pm2 start src/index.js --name bsc-pulse

# Auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 logs bsc-pulse
```

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Part of the BSC DeFi microservices ecosystem</sub>
</p>
