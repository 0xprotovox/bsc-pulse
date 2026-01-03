// src/services/ConnectionManager.js
// WebSocket connection management service

class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.checkInterval = null;
  }

  add(socket) {
    this.connections.set(socket.id, {
      id: socket.id,
      connectedAt: Date.now(),
      lastPing: Date.now(),
      subscriptions: new Set(),
      ip: socket.handshake.address
    });
  }

  updateActivity(socketId) {
    const conn = this.connections.get(socketId);
    if (conn) {
      conn.lastPing = Date.now();
    }
  }

  addSubscription(socketId, tokenAddress) {
    const conn = this.connections.get(socketId);
    if (conn) {
      conn.subscriptions.add(tokenAddress.toLowerCase());
    }
  }

  removeSubscription(socketId, tokenAddress) {
    const conn = this.connections.get(socketId);
    if (conn) {
      conn.subscriptions.delete(tokenAddress.toLowerCase());
    }
  }

  remove(socketId) {
    this.connections.delete(socketId);
  }

  startHealthCheck(io) {
    this.checkInterval = setInterval(() => {
      const now = Date.now();
      const stale = [];

      for (const [id, conn] of this.connections) {
        if (now - conn.lastPing > 60000) {
          stale.push(id);
        }
      }

      stale.forEach(id => {
        const socket = io.sockets.sockets.get(id);
        if (socket) {
          socket.disconnect();
        }
        this.remove(id);
      });

      if (stale.length > 0) {
        console.log(`Disconnected ${stale.length} stale connections`);
      }
    }, 30000);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  getStats() {
    return {
      totalConnections: this.connections.size,
      connections: Array.from(this.connections.values()).map(c => ({
        id: c.id,
        connectedFor: Math.floor((Date.now() - c.connectedAt) / 1000),
        subscriptions: c.subscriptions.size
      }))
    };
  }
}

module.exports = ConnectionManager;
