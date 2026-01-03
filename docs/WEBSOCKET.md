# BscPulse WebSocket Documentation

## Connection

Connect to the WebSocket server using Socket.IO:

```
ws://localhost:3001
```

**Supported Transports:**
- WebSocket (preferred)
- Polling (fallback)

---

## Events Overview

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{tokenAddress}` | Subscribe to token price updates |
| `unsubscribe` | `{tokenAddress}` | Unsubscribe from token |
| `ping` | - | Keep-alive ping |
| `get-all-prices` | - | Request all cached prices |

### Server → Client

| Event | Description |
|-------|-------------|
| `welcome` | Connection confirmation with service info |
| `subscribed` | Subscription confirmed with current price |
| `unsubscribed` | Unsubscription confirmed |
| `price-update` | Real-time price update |
| `all-prices` | Response to get-all-prices |
| `heartbeat` | Periodic system status (every 30s) |
| `pong` | Response to ping |
| `error` | Error message |

---

## Event Details

### `welcome`

Sent immediately upon connection.

```json
{
  "message": "Connected to BscPulse",
  "socketId": "abc123xyz",
  "service": "BscPulse v1.0.0",
  "features": {
    "v2Support": true,
    "v3Support": true,
    "pancakeswapSupport": true,
    "multiPoolSupport": true,
    "dynamicBnbPrice": true,
    "caching": true,
    "metricsTracking": true,
    "buySellDetection": true
  }
}
```

### `subscribe`

Subscribe to price updates for a token.

**Send:**
```json
{
  "tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
}
```

**Receive (`subscribed`):**
```json
{
  "tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  "currentPrice": {
    "priceUSD": 2.45,
    "priceBNB": 0.0041,
    "timestamp": 1704300000000
  },
  "room": "token:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"
}
```

### `unsubscribe`

Unsubscribe from a token.

**Send:**
```json
{
  "tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
}
```

**Receive (`unsubscribed`):**
```json
{
  "tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
}
```

### `price-update`

Received when a subscribed token's price changes (>0.1% change threshold).

```json
{
  "tokenAddress": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  "symbol": "CAKE",
  "priceUSD": 2.46,
  "priceBNB": 0.00412,
  "poolCount": 2,
  "timestamp": 1704300500000,
  "change": {
    "percent": 0.41,
    "direction": "up"
  },
  "swap": {
    "type": "buy",
    "amountUSD": 5000,
    "amountBNB": 8.33
  }
}
```

### `heartbeat`

Sent every 30 seconds with system status.

```json
{
  "timestamp": 1704300000000,
  "monitoredTokens": 5,
  "uptime": 3600,
  "metrics": {
    "priceUpdates": 1250,
    "cacheHits": 890,
    "eventsReceived": 3400
  }
}
```

### `get-all-prices`

Request all cached prices.

**Send:** (no payload)

**Receive (`all-prices`):**
```json
{
  "prices": [
    {
      "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      "symbol": "CAKE",
      "priceUSD": 2.45,
      "priceBNB": 0.0041,
      "timestamp": 1704300000000
    }
  ]
}
```

### `error`

Sent when an error occurs.

```json
{
  "message": "Token address required",
  "code": "INVALID_REQUEST"
}
```

---

## Client Examples

### JavaScript (Socket.IO Client)

```javascript
const { io } = require('socket.io-client');

const socket = io('http://localhost:3001', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

// Connection events
socket.on('connect', () => {
  console.log('Connected:', socket.id);
});

socket.on('welcome', (data) => {
  console.log('Service:', data.service);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

// Subscribe to token
socket.emit('subscribe', {
  tokenAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
});

socket.on('subscribed', (data) => {
  console.log('Subscribed to:', data.tokenAddress);
  console.log('Current price:', data.currentPrice?.priceUSD);
});

// Receive price updates
socket.on('price-update', (data) => {
  console.log(`${data.symbol}: $${data.priceUSD.toFixed(4)}`);

  if (data.swap) {
    console.log(`  ${data.swap.type.toUpperCase()}: $${data.swap.amountUSD}`);
  }
});

// Heartbeat monitoring
socket.on('heartbeat', (data) => {
  console.log(`[Heartbeat] Uptime: ${data.uptime}s`);
});

// Error handling
socket.on('error', (error) => {
  console.error('Error:', error.message);
});

// Keep-alive
setInterval(() => {
  socket.emit('ping');
}, 30000);

socket.on('pong', (data) => {
  console.log('Pong received:', data.time);
});
```

### Python (python-socketio)

```python
import socketio

sio = socketio.Client()

@sio.event
def connect():
    print('Connected')
    # Subscribe to token
    sio.emit('subscribe', {
        'tokenAddress': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
    })

@sio.event
def welcome(data):
    print(f"Service: {data['service']}")

@sio.on('subscribed')
def on_subscribed(data):
    print(f"Subscribed to: {data['tokenAddress']}")

@sio.on('price-update')
def on_price_update(data):
    print(f"{data['symbol']}: ${data['priceUSD']:.4f}")

@sio.on('heartbeat')
def on_heartbeat(data):
    print(f"[Heartbeat] Tokens: {data['monitoredTokens']}")

@sio.event
def disconnect():
    print('Disconnected')

# Connect
sio.connect('http://localhost:3001', transports=['websocket'])
sio.wait()
```

### Browser (HTML/JavaScript)

```html
<!DOCTYPE html>
<html>
<head>
  <title>BscPulse Client</title>
  <script src="https://cdn.socket.io/4.6.0/socket.io.min.js"></script>
</head>
<body>
  <h1>BscPulse Price Monitor</h1>
  <div id="prices"></div>

  <script>
    const socket = io('http://localhost:3001');

    socket.on('connect', () => {
      console.log('Connected');

      // Subscribe to CAKE
      socket.emit('subscribe', {
        tokenAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
      });
    });

    socket.on('price-update', (data) => {
      document.getElementById('prices').innerHTML = `
        <p><strong>${data.symbol}</strong>: $${data.priceUSD.toFixed(4)}</p>
        <p>BNB: ${data.priceBNB.toFixed(6)}</p>
        <p>Updated: ${new Date(data.timestamp).toLocaleTimeString()}</p>
      `;
    });
  </script>
</body>
</html>
```

---

## Connection Management

### Auto-Reconnection

The server handles disconnections gracefully. Configure your client:

```javascript
const socket = io('http://localhost:3001', {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});
```

### Stale Connection Cleanup

- Server pings clients every 30 seconds via `heartbeat`
- Connections inactive for >60 seconds are auto-disconnected
- Send `ping` events to keep connection alive

### Room-Based Subscriptions

Each token subscription joins a room:
- Room format: `token:<address_lowercase>`
- Price updates only sent to subscribers of that token
- Reduces bandwidth for clients

---

## Best Practices

1. **Reconnection Handling**
   - Re-subscribe to tokens after reconnection
   - Store subscribed tokens locally

2. **Error Handling**
   - Always listen for `error` events
   - Handle disconnections gracefully

3. **Keep-Alive**
   - Send `ping` every 30 seconds
   - Listen for `pong` responses

4. **Memory Management**
   - Unsubscribe from tokens you no longer need
   - Don't subscribe to same token multiple times

5. **Rate Limiting**
   - Don't spam subscribe/unsubscribe
   - Batch token subscriptions if possible
