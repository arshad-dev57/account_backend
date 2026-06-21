/**
 * Rate Limiter Middleware
 * Prevents brute force attacks and abuse on sensitive endpoints
 * Uses in-memory store (for production with multiple servers, use Redis)
 */

class RateLimiter {
  constructor(windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests') {
    this.windowMs = windowMs;
    this.max = max;
    this.message = message;
    this.requests = new Map();
  }

  middleware() {
    return (req, res, next) => {
      const key = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const windowStart = now - this.windowMs;

      if (!this.requests.has(key)) {
        this.requests.set(key, []);
      }

      const userRequests = this.requests.get(key).filter(time => time > windowStart);

      if (userRequests.length >= this.max) {
        return res.status(429).json({
          success: false,
          message: this.message,
          retryAfter: Math.ceil((userRequests[0] + this.windowMs - now) / 1000),
        });
      }

      userRequests.push(now);
      this.requests.set(key, userRequests);

      next();
    };
  }

  // Cleanup old entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => time > now - this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validRequests);
      }
    }
  }
}

// Global rate limiter - 100 requests per 15 minutes
const globalLimiter = new RateLimiter(
  15 * 60 * 1000,
  100,
  'Too many requests from this IP, please try again later'
);

// Strict rate limiter for auth endpoints - 5 requests per 15 minutes
const authLimiter = new RateLimiter(
  15 * 60 * 1000,
  5,
  'Too many authentication attempts, please try again later'
);

// OTP rate limiter - 3 requests per 10 minutes
const otpLimiter = new RateLimiter(
  10 * 60 * 1000,
  3,
  'Too many OTP requests, please try again later'
);

// Cleanup every 5 minutes
setInterval(() => {
  globalLimiter.cleanup();
  authLimiter.cleanup();
  otpLimiter.cleanup();
}, 5 * 60 * 1000);

module.exports = {
  globalLimiter,
  authLimiter,
  otpLimiter,
  RateLimiter,
};