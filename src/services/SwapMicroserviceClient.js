// src/services/SwapMicroserviceClient.js
// Socket.IO client for connecting to Swap Microservice

const { io } = require('socket.io-client');

class SwapMicroserviceClient {
  constructor(url = 'http://localhost:3000', path = '/ws') {
    this.url = url;
    this.path = path;
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  connect() {
    console.log(`🔌 Connecting to Swap Microservice at ${this.url}${this.path}...`);

    this.socket = io(this.url, {
      path: this.path,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: this.maxReconnectAttempts,
      transports: ['websocket']
    });

    this.setupListeners();
    return this;
  }

  setupListeners() {
    this.socket.on('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('✅ Connected to Swap Microservice WebSocket');
      console.log(`   Socket ID: ${this.socket.id}`);
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      console.log(`❌ Disconnected from Swap Microservice: ${reason}`);

      // Manually reconnect if server initiated disconnect
      if (reason === 'io server disconnect') {
        console.log('🔄 Attempting manual reconnection...');
        setTimeout(() => {
          if (!this.connected) {
            this.socket.connect();
          }
        }, 1000);
      }
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      console.error(`⚠️ WebSocket connection error (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error.message);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ Max reconnection attempts reached. Please check if Swap Microservice is running.');
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected to Swap Microservice after ${attemptNumber} attempts`);
      this.connected = true;
      this.reconnectAttempts = 0;
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('⚠️ Reconnection error:', error.message);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('❌ Failed to reconnect to Swap Microservice');
      this.connected = false;
    });
  }

  /**
   * Emit swap confirmation to Swap Microservice
   * @param {Object} eventData - Swap confirmation data
   * @returns {boolean} Success status
   */
  emitSwapConfirmation(eventData) {
    if (!this.socket || !this.connected) {
      console.error('❌ WebSocket not connected, cannot emit swap confirmation');
      console.error('   Event data:', {
        txHash: eventData.txHash,
        operation: eventData.operation
      });
      return false;
    }

    try {
      // Emit to swap microservice
      this.socket.emit('swap:confirmed', eventData);

      console.log('✅ Emitted swap confirmation to Swap Microservice:', {
        txHash: eventData.txHash,
        operation: eventData.operation,
        blockNumber: eventData.blockNumber,
        userAddress: eventData.userAddress
      });

      return true;

    } catch (error) {
      console.error('❌ Failed to emit swap confirmation:', error);
      return false;
    }
  }

  /**
   * Check if connected to Swap Microservice
   */
  isConnected() {
    return this.connected && this.socket && this.socket.connected;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected(),
      socketId: this.socket?.id || null,
      reconnectAttempts: this.reconnectAttempts,
      url: this.url,
      path: this.path
    };
  }

  /**
   * Disconnect from Swap Microservice
   */
  disconnect() {
    if (this.socket) {
      console.log('🛑 Disconnecting from Swap Microservice...');
      this.socket.disconnect();
      this.connected = false;
    }
  }
}

module.exports = SwapMicroserviceClient;
