/**
 * Request Logger Middleware
 * Logs all incoming requests with timing and status codes
 * Helps with debugging and monitoring API performance
 */

const logger = (req, res, next) => {
  const start = Date.now();

  // Log request
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl || req.url}`);

  // Capture response status
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    // Color coding for terminal
    const methodColor = getMethodColor(req.method);
    const statusColor = getStatusColor(statusCode);

    console.log(
      `${methodColor}${req.method}\x1b[0m ` +
        `${statusColor}${statusCode}\x1b[0m ` +
        `${duration}ms ` +
        `${req.originalUrl || req.url}`
    );

    // Log errors separately
    if (statusCode >= 400) {
      console.error(`[ERROR] ${req.method} ${req.originalUrl || req.url} - ${statusCode}`);
      if (data && typeof data === 'object') {
        console.error(JSON.stringify(data, null, 2));
      }
    }

    res.send = originalSend;
    return res.send(data);
  };

  next();
};

const getMethodColor = (method) => {
  const colors = {
    GET: '\x1b[32m', // Green
    POST: '\x1b[36m', // Cyan
    PUT: '\x1b[33m', // Yellow
    PATCH: '\x1b[33m', // Yellow
    DELETE: '\x1b[31m', // Red
    OPTIONS: '\x1b[90m', // Gray
  };
  return colors[method] || '\x1b[0m';
};

const getStatusColor = (status) => {
  if (status >= 500) return '\x1b[31m'; // Red
  if (status >= 400) return '\x1b[33m'; // Yellow
  if (status >= 300) return '\x1b[36m'; // Cyan
  if (status >= 200) return '\x1b[32m'; // Green
  return '\x1b[0m';
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ERROR: ${err.message}`);
  console.error(err.stack);
  next(err);
};

module.exports = { logger, errorLogger };