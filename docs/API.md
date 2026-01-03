# BscPulse REST API Documentation

## Base URL

```
http://localhost:3001
```

## Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| GET | `/api/tokens` | List configured tokens |
| GET | `/api/tokens/monitored` | List actively monitored tokens |
| GET | `/api/prices` | Get all cached prices |
| GET | `/api/prices/:token` | Get specific token price |
| GET | `/api/metrics` | System metrics |
| GET | `/api/settings` | Configuration settings |
| POST | `/api/monitor` | Add token to monitoring |
| POST | `/api/monitor-dynamic` | Add multiple tokens with config |

---

## Health Check

### `GET /health`

Returns service health status with uptime and metrics.

**Response:**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "service": "BscPulse v1.0.0",
  "connections": 5,
  "monitoredTokens": 3,
  "metrics": {
    "priceUpdates": 1250,
    "cacheHits": 890,
    "eventsReceived": 3400
  }
}
```

---

## Token Management

### `GET /api/tokens`

List all configured tokens (from config file).

**Response:**
```json
{
  "success": true,
  "tokens": [
    {
      "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      "symbol": "CAKE",
      "pools": 2
    }
  ]
}
```

### `GET /api/tokens/monitored`

List tokens currently being monitored with active listeners.

**Response:**
```json
{
  "success": true,
  "count": 3,
  "tokens": [
    {
      "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      "symbol": "CAKE",
      "lastPrice": 2.45,
      "lastUpdate": 1704300000000
    }
  ]
}
```

---

## Price Data

### `GET /api/prices`

Get all cached prices.

**Response:**
```json
{
  "success": true,
  "count": 3,
  "prices": [
    {
      "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      "symbol": "CAKE",
      "priceUSD": 2.45,
      "priceBNB": 0.0041,
      "poolCount": 2,
      "timestamp": 1704300000000
    }
  ]
}
```

### `GET /api/prices/:token`

Get price for a specific token.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `token` | address | Token contract address |

**Example:**
```bash
curl http://localhost:3001/api/prices/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82
```

**Response:**
```json
{
  "success": true,
  "price": {
    "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    "symbol": "CAKE",
    "priceUSD": 2.45,
    "priceBNB": 0.0041,
    "poolCount": 2,
    "timestamp": 1704300000000,
    "cached": true
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Token not found in cache"
}
```

---

## Token Monitoring

### `POST /api/monitor`

Add a single token to monitoring (auto-discovers pools).

**Request Body:**
```json
{
  "tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Token added to monitoring",
  "token": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  "currentPrice": {
    "priceUSD": 2.45,
    "priceBNB": 0.0041
  }
}
```

### `POST /api/monitor-dynamic`

Add multiple tokens with full pool configuration.

**Request Body:**
```json
{
  "tokens": [
    {
      "tokenAddress": "0xTOKEN_ADDRESS",
      "poolAddress": "0xPOOL_ADDRESS",
      "pair": "WBNB",
      "version": 2
    },
    {
      "tokenAddress": "0xTOKEN_ADDRESS",
      "poolAddress": "0xV3_POOL_ADDRESS",
      "pair": "USDT",
      "version": 3,
      "fee": 2500
    }
  ]
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tokenAddress` | address | Yes | Token contract address |
| `poolAddress` | address | Yes | Pool contract address |
| `pair` | string | Yes | Quote token: `WBNB`, `USDT`, `USDC`, `BUSD` |
| `version` | number | Yes | Pool version: `2` or `3` |
| `fee` | number | V3 only | Fee tier: `100`, `500`, `2500`, `10000` |

**Response:**
```json
{
  "success": true,
  "message": "Added 2 token(s) to monitoring",
  "tokens": [
    {
      "address": "0xTOKEN_ADDRESS",
      "status": "monitoring"
    }
  ]
}
```

---

## System Metrics

### `GET /api/metrics`

Get detailed system metrics.

**Response:**
```json
{
  "success": true,
  "metrics": {
    "uptime": 3600,
    "priceUpdates": 1250,
    "cacheHits": 890,
    "cacheMisses": 45,
    "eventsReceived": 3400,
    "wsConnections": 5,
    "errorCount": 2,
    "lastError": null
  }
}
```

### `GET /api/settings`

Get current configuration settings.

**Response:**
```json
{
  "success": true,
  "settings": {
    "priceUpdateThreshold": 0.001,
    "bnbPriceUpdateInterval": 60000,
    "maxReconnectAttempts": 10
  }
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**HTTP Status Codes:**
| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request (invalid parameters) |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

---

## Rate Limiting

- Default: 100 requests per minute per IP
- Configurable via `.env` file
- Returns `429` when exceeded

---

## Examples

### cURL

```bash
# Health check
curl http://localhost:3001/health

# Get all prices
curl http://localhost:3001/api/prices

# Get specific token price
curl http://localhost:3001/api/prices/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82

# Add token to monitoring
curl -X POST http://localhost:3001/api/monitor \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"}'
```

### JavaScript (axios)

```javascript
const axios = require('axios');
const BASE_URL = 'http://localhost:3001';

// Get all prices
const { data } = await axios.get(`${BASE_URL}/api/prices`);
console.log(data.prices);

// Add token to monitoring
await axios.post(`${BASE_URL}/api/monitor`, {
  tokenAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
});
```

### Python (requests)

```python
import requests

BASE_URL = 'http://localhost:3001'

# Get all prices
response = requests.get(f'{BASE_URL}/api/prices')
prices = response.json()['prices']

# Add token to monitoring
requests.post(f'{BASE_URL}/api/monitor', json={
    'tokenAddress': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
})
```
