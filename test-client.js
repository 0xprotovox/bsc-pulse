// test-client.js
// WebSocket test client for BscPulse

const io = require('socket.io-client');

class TestClient {
  constructor() {
    this.socket = null;
  }

  connect() {
    console.log('Connecting to BscPulse...\n');

    this.socket = io('http://localhost:3001', {
      reconnection: true
    });

    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected!');
      console.log('Socket ID:', this.socket.id);
      console.log('');
    });

    this.socket.on('welcome', (data) => {
      console.log('Welcome:', data.message);
      console.log('');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
    });

    this.socket.on('error', (error) => {
      console.error('Error:', error);
    });

    // Price events
    this.socket.on('price-update', (data) => {
      console.log('\n========== PRICE UPDATE ==========');
      console.log('Token:', data.tokenAddress);
      console.log('Price USD: $' + (data.priceUSD?.toFixed(6) || 'N/A'));
      console.log('Price BNB:', (data.priceBNB?.toFixed(8) || 'N/A') + ' BNB');
      console.log('Pools:', data.poolCount);
      console.log('Time:', new Date(data.timestamp).toLocaleTimeString());
      console.log('==================================\n');
    });

    this.socket.on('subscribed', (data) => {
      console.log('Subscribed to', data.tokenAddress);
    });

    this.socket.on('heartbeat', (data) => {
      console.log(`[Heartbeat] Uptime: ${data.uptime}s, Tokens: ${data.monitoredTokens}`);
    });
  }

  subscribeToToken(tokenAddress) {
    console.log(`\nSubscribing to ${tokenAddress}...`);
    this.socket.emit('subscribe', { tokenAddress });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Run test
async function runTest() {
  console.log('====================================');
  console.log('       BSC PULSE TEST CLIENT');
  console.log('====================================\n');

  const client = new TestClient();
  client.connect();

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test tokens (BSC)
  const tokens = [
    '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
    // Add any BSC token address you want to monitor
  ];

  // Subscribe to tokens
  for (const token of tokens) {
    client.subscribeToToken(token);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\nListening for price updates...');
  console.log('(Prices will update when swaps occur on PancakeSwap)\n');

  // Keep running
  process.on('SIGINT', () => {
    console.log('\n\nShutting down test client...');
    client.disconnect();
    process.exit(0);
  });
}

// Start
runTest().catch(console.error);
