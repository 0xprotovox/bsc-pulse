// src/middlewares/rateLimiter.js
// Rate limiting middleware

class RateLimiter {
  constructor(maxRequests = 100, windowMs = 60000) {
    this.requests = new Map();
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(ip) {
    const now = Date.now();
    const userRequests = this.requests.get(ip) || [];

    // Clean old requests
    const valid = userRequests.filter(time => now - time < this.windowMs);

    if (valid.length >= this.maxRequests) {
      return false;
    }

    valid.push(now);
    this.requests.set(ip, valid);
    return true;
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;

      if (!this.check(ip)) {
        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(this.windowMs / 1000)
        });
      }

      next();
    };
  }
}

// Export factory function for easy use
const rateLimiter = (maxRequests = 100, windowMs = 60000) => {
  const limiter = new RateLimiter(maxRequests, windowMs);
  return limiter.middleware();
};

module.exports = { RateLimiter, rateLimiter };
