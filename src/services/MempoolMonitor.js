// src/services/MempoolMonitor.js
// Professional mempool monitoring for instant swap detection

const { ethers } = require('ethers');

class MempoolMonitor {
  constructor(provider, swapClient) {
    this.provider = provider;
    this.swapClient = swapClient;

    // Track pending transactions
    this.pendingSwaps = new Map(); // txHash → swapData
    this.monitoredPools = new Map(); // poolAddress → config

    // Performance metrics
    this.metrics = {
      pendingDetected: 0,
      confirmed: 0,
      failed: 0,
      replaced: 0,
      timedOut: 0
    };

    // Configuration
    this.TIMEOUT_MS = 300000; // 5 minutes timeout for pending txs
    this.CLEANUP_INTERVAL = 60000; // Clean up every 60 seconds

    // Method signatures for swap detection
    this.SWAP_SIGNATURES = {
      // Uniswap V2 Router: swapExactTokensForTokens, swapTokensForExactTokens, etc.
      'swapExactTokensForTokens': '0x38ed1739',
      'swapTokensForExactTokens': '0x8803dbee',
      'swapExactETHForTokens': '0x7ff36ab5',
      'swapTokensForExactETH': '0x4a25d94a',
      'swapExactTokensForETH': '0x18cbafe5',
      'swapETHForExactTokens': '0xfb3bdb41',

      // Uniswap V3 Router: exactInputSingle, exactOutputSingle
      'exactInputSingle': '0x414bf389',
      'exactOutputSingle': '0xdb3e2198',
      'exactInput': '0xc04b8d59',
      'exactOutput': '0xf28c0498',

      // Uniswap Universal Router
      'execute': '0x3593564c',

      // Direct pool swaps
      'swap': '0x022c0d9f', // V2 pool
      'swapV3': '0x128acb08' // V3 pool
    };

    this.isMonitoring = false;
    this.cleanupTimer = null;
  }

  /**
   * Start monitoring mempool for a specific pool
   */
  async addMonitoredPool(poolAddress, config) {
    const key = poolAddress.toLowerCase();
    this.monitoredPools.set(key, {
      ...config,
      addedAt: Date.now()
    });

    console.log(`⚡ Mempool monitoring enabled for pool: ${poolAddress}`);

    // Start monitoring if not already started
    if (!this.isMonitoring) {
      await this.startMonitoring();
    }
  }

  /**
   * Remove pool from monitoring
   */
  removeMonitoredPool(poolAddress) {
    const key = poolAddress.toLowerCase();
    this.monitoredPools.delete(key);

    console.log(`⚡ Mempool monitoring disabled for pool: ${poolAddress}`);

    // Stop monitoring if no pools left
    if (this.monitoredPools.size === 0) {
      this.stopMonitoring();
    }
  }

  /**
   * Start mempool monitoring
   */
  async startMonitoring() {
    if (this.isMonitoring) return;

    console.log('\n⚡ MEMPOOL MONITOR STARTING...');
    console.log('   Instant swap detection: ENABLED');
    console.log('   Detection speed: 0-100ms\n');

    this.isMonitoring = true;

    try {
      // Subscribe to pending transactions using WebSocket subscription
      // This works with Alchemy and other providers that support eth_subscribe
      await this.provider.send('eth_subscribe', ['newPendingTransactions']);

      // Listen for subscription messages
      this.provider.websocket.on('message', (data) => {
        try {
          const message = JSON.parse(data);

          // Check if it's a pending transaction notification
          if (message.method === 'eth_subscription' && message.params?.result) {
            const txHash = message.params.result;
            this.handlePendingTransaction(txHash).catch(err => {
              // Silent fail for individual tx errors (mempool is noisy)
              if (err.code !== 'NETWORK_ERROR') {
                console.error(`Mempool error for ${txHash}:`, err.message);
              }
            });
          }
        } catch (parseError) {
          // Ignore JSON parse errors
        }
      });

      console.log('✅ Subscribed to pending transactions via eth_subscribe');
    } catch (error) {
      console.warn('⚠️  WebSocket pending tx subscription failed:', error.message);
      console.log('⚠️  Mempool monitoring NOT available with this provider');
      console.log('ℹ️  Falling back to block event monitoring only\n');
      this.isMonitoring = false;
      return;
    }

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleTransactions();
    }, this.CLEANUP_INTERVAL);

    console.log('✅ Mempool monitor: ACTIVE\n');
  }

  /**
   * Stop mempool monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;

    console.log('🛑 Stopping mempool monitor...');

    this.isMonitoring = false;
    this.provider.removeAllListeners('pending');

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    console.log('✅ Mempool monitor: STOPPED');
  }

  /**
   * Handle a pending transaction
   */
  async handlePendingTransaction(txHash) {
    try {
      // Validate txHash is actually a string (Alchemy on Base sends block objects sometimes)
      if (typeof txHash !== 'string' || !txHash.startsWith('0x') || txHash.length !== 66) {
        return; // Invalid tx hash, skip silently
      }

      // Check if we're already tracking this
      if (this.pendingSwaps.has(txHash)) return;

      // Fetch transaction details
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) return;

      // Check if this transaction interacts with any monitored pool
      const poolConfig = this.getPoolConfigForTx(tx);
      if (!poolConfig) return;

      // Decode swap data
      const swapData = this.decodeSwapTransaction(tx, poolConfig);
      if (!swapData) return;

      // Filter by user address if specified
      if (poolConfig.userAddress) {
        const targetUser = poolConfig.userAddress.toLowerCase();
        const txFrom = tx.from.toLowerCase();

        if (txFrom !== targetUser) {
          return; // Not the target user
        }
      }

      // Track this pending swap
      const pendingSwap = {
        ...swapData,
        txHash,
        detectedAt: Date.now(),
        status: 'pending'
      };

      this.pendingSwaps.set(txHash, pendingSwap);
      this.metrics.pendingDetected++;

      // Emit pending event
      this.emitPendingSwap(pendingSwap);

      // Wait for confirmation in background
      this.waitForConfirmation(txHash, poolConfig);

    } catch (error) {
      // Silently ignore all mempool errors (Alchemy on Base has limitations)
      // Provider sends invalid data that causes errors - this is expected
      return;
    }
  }

  /**
   * Check if transaction interacts with monitored pool
   */
  getPoolConfigForTx(tx) {
    if (!tx.to) return null;

    const toAddress = tx.to.toLowerCase();

    // Check if tx.to is a monitored pool
    if (this.monitoredPools.has(toAddress)) {
      return this.monitoredPools.get(toAddress);
    }

    // Could also check if tx data contains monitored pool address
    // (for router transactions)
    return null;
  }

  /**
   * Decode swap transaction data
   */
  decodeSwapTransaction(tx, poolConfig) {
    try {
      const data = tx.data;
      if (!data || data.length < 10) return null;

      const methodId = data.slice(0, 10).toLowerCase();

      // Determine operation type based on method
      let operation = null;

      // V2 Direct Swap
      if (methodId === this.SWAP_SIGNATURES.swap) {
        operation = this.decodeV2DirectSwap(data, poolConfig);
      }

      // V3 Direct Swap
      else if (methodId === this.SWAP_SIGNATURES.swapV3) {
        operation = 'unknown'; // Will be determined from event
      }

      // Router swaps
      else if (Object.values(this.SWAP_SIGNATURES).includes(methodId)) {
        operation = 'unknown'; // Will be determined from event
      }

      if (!operation) return null;

      return {
        tokenAddress: poolConfig.tokenAddress,
        poolAddress: poolConfig.poolAddress,
        protocol: poolConfig.protocol,
        userAddress: tx.from,
        operation: operation,
        methodId,
        gasPrice: tx.gasPrice?.toString(),
        gasLimit: tx.gasLimit?.toString()
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Decode V2 direct swap
   */
  decodeV2DirectSwap(data, poolConfig) {
    try {
      // V2 swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data)
      const iface = new ethers.Interface([
        'function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data)'
      ]);

      const decoded = iface.parseTransaction({ data });
      if (!decoded) return 'unknown';

      const amount0Out = decoded.args[0];
      const amount1Out = decoded.args[1];

      // Determine if buy or sell based on which amount is non-zero
      const isToken0 = poolConfig.isToken0 !== false; // Default true if not specified

      if (isToken0) {
        return amount0Out > 0n ? 'buy' : 'sell';
      } else {
        return amount1Out > 0n ? 'buy' : 'sell';
      }
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Emit pending swap event
   */
  emitPendingSwap(swapData) {
    if (!this.swapClient || !this.swapClient.isConnected()) {
      return;
    }

    const event = {
      event: 'swap.pending',
      txHash: swapData.txHash,
      tokenAddress: swapData.tokenAddress,
      poolAddress: swapData.poolAddress,
      userAddress: swapData.userAddress,
      operation: swapData.operation,
      status: 'pending',
      protocol: swapData.protocol,
      timestamp: Date.now(),
      detectionTime: Date.now() - swapData.detectedAt
    };

    this.swapClient.socket.emit('swap:pending', event);

    console.log('\n⚡ INSTANT DETECTION - Pending Swap:');
    console.log(`   TX Hash:    ${swapData.txHash.slice(0, 20)}...`);
    console.log(`   Operation:  ${swapData.operation.toUpperCase()}`);
    console.log(`   User:       ${swapData.userAddress.slice(0, 10)}...`);
    console.log(`   Speed:      ${Date.now() - swapData.detectedAt}ms`);
    console.log(`   Status:     ⏳ PENDING (waiting for confirmation)\n`);
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(txHash, poolConfig) {
    try {
      // Wait for transaction receipt (with timeout)
      const receipt = await Promise.race([
        this.provider.waitForTransaction(txHash, 1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), this.TIMEOUT_MS)
        )
      ]);

      const pending = this.pendingSwaps.get(txHash);
      if (!pending) return;

      if (receipt.status === 1) {
        // Success
        this.handleConfirmedSwap(txHash, receipt, poolConfig);
      } else {
        // Failed/Reverted
        this.handleFailedSwap(txHash, receipt, 'Transaction reverted');
      }

    } catch (error) {
      if (error.message === 'Timeout') {
        this.handleTimeout(txHash);
      } else if (error.replacement) {
        this.handleReplacedTransaction(txHash, error.replacement);
      } else {
        console.error(`Confirmation error for ${txHash}:`, error.message);
      }
    }
  }

  /**
   * Handle confirmed swap
   */
  handleConfirmedSwap(txHash, receipt, poolConfig) {
    const pending = this.pendingSwaps.get(txHash);
    if (!pending) return;

    this.metrics.confirmed++;

    const confirmationTime = Date.now() - pending.detectedAt;

    console.log('\n✅ SWAP CONFIRMED:');
    console.log(`   TX Hash:     ${txHash.slice(0, 20)}...`);
    console.log(`   Block:       ${receipt.blockNumber}`);
    console.log(`   Gas Used:    ${receipt.gasUsed.toString()}`);
    console.log(`   Total Time:  ${confirmationTime}ms`);
    console.log(`   Status:      ✅ CONFIRMED\n`);

    // Clean up
    this.pendingSwaps.delete(txHash);
  }

  /**
   * Handle failed swap
   */
  handleFailedSwap(txHash, receipt, reason) {
    const pending = this.pendingSwaps.get(txHash);
    if (!pending) return;

    this.metrics.failed++;

    if (this.swapClient && this.swapClient.isConnected()) {
      this.swapClient.socket.emit('swap:failed', {
        event: 'swap.failed',
        txHash,
        blockNumber: receipt?.blockNumber,
        reason,
        status: 'failed',
        timestamp: Date.now()
      });
    }

    console.log('\n❌ SWAP FAILED:');
    console.log(`   TX Hash:  ${txHash.slice(0, 20)}...`);
    console.log(`   Reason:   ${reason}`);
    console.log(`   Block:    ${receipt?.blockNumber || 'N/A'}\n`);

    this.pendingSwaps.delete(txHash);
  }

  /**
   * Handle replaced transaction (speed-up/cancel)
   */
  handleReplacedTransaction(oldTxHash, replacement) {
    const pending = this.pendingSwaps.get(oldTxHash);
    if (!pending) return;

    this.metrics.replaced++;

    console.log('\n🔄 SWAP REPLACED:');
    console.log(`   Old TX:  ${oldTxHash.slice(0, 20)}...`);
    console.log(`   New TX:  ${replacement.hash.slice(0, 20)}...`);
    console.log(`   Reason:  User speed-up or cancel\n`);

    // Move tracking to new transaction
    this.pendingSwaps.delete(oldTxHash);
    this.pendingSwaps.set(replacement.hash, {
      ...pending,
      txHash: replacement.hash,
      replacedFrom: oldTxHash
    });

    // Emit update
    if (this.swapClient && this.swapClient.isConnected()) {
      this.swapClient.socket.emit('swap:replaced', {
        event: 'swap.replaced',
        oldTxHash,
        newTxHash: replacement.hash,
        status: 'replaced',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle transaction timeout
   */
  handleTimeout(txHash) {
    const pending = this.pendingSwaps.get(txHash);
    if (!pending) return;

    this.metrics.timedOut++;

    console.log('\n⏱️  SWAP TIMEOUT:');
    console.log(`   TX Hash:  ${txHash.slice(0, 20)}...`);
    console.log(`   Reason:   Stuck in mempool (5+ minutes)\n`);

    this.pendingSwaps.delete(txHash);
  }

  /**
   * Clean up stale pending transactions
   */
  cleanupStaleTransactions() {
    const now = Date.now();
    const stale = [];

    for (const [txHash, swap] of this.pendingSwaps) {
      if (now - swap.detectedAt > this.TIMEOUT_MS) {
        stale.push(txHash);
      }
    }

    if (stale.length > 0) {
      console.log(`🧹 Cleaning up ${stale.length} stale pending transactions`);
      stale.forEach(txHash => {
        this.handleTimeout(txHash);
      });
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      isActive: this.isMonitoring,
      monitoredPools: this.monitoredPools.size,
      pendingSwaps: this.pendingSwaps.size,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Cleanup on shutdown
   */
  stop() {
    this.stopMonitoring();
    this.pendingSwaps.clear();
    this.monitoredPools.clear();
  }
}

module.exports = MempoolMonitor;
