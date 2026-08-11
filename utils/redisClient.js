// utils/redisClient.js - Redis caching utility

const Redis = require('ioredis');

let redisClient = null;
let _initialized = false;

// Initialize Redis client
function getRedisClient() {
  if (_initialized) return redisClient;
  _initialized = true;

  const redisUrl = process.env.REDIS_URL;

  // No Redis URL configured — run without cache (graceful no-op)
  if (!redisUrl) {
    console.log('ℹ️ [Redis] REDIS_URL not set — caching disabled');
    redisClient = null;
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      tls: {},
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 2) {
          console.log('❌ [Redis] Connection failed — disabling cache');
          redisClient = null;
          return null; // stop retrying
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      console.log('✅ [Redis] Connected successfully');
    });

    redisClient.on('error', (err) => {
      console.log('⚠️ [Redis] Error:', err.message);
    });

    redisClient.on('close', () => {
      console.log('ℹ️ [Redis] Connection closed');
    });
  } catch (error) {
    console.log('❌ [Redis] Failed to initialize:', error.message);
    redisClient = null;
  }

  return redisClient;
}

// Get cached data
async function get(key) {
  try {
    const client = getRedisClient();
    if (!client) return null;

    const data = await client.get(key);
    if (data) {
      console.log('✅ [Redis] Cache HIT:', key);
      return JSON.parse(data);
    }
    console.log('⚠️ [Redis] Cache MISS:', key);
    return null;
  } catch (error) {
    console.log('❌ [Redis] GET error:', error.message);
    return null;
  }
}

// Set cached data with TTL
async function set(key, value, ttlSeconds) {
  try {
    const client = getRedisClient();
    if (!client) return false;

    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    console.log('💾 [Redis] Cache SET:', key, `TTL: ${ttlSeconds}s`);
    return true;
  } catch (error) {
    console.log('❌ [Redis] SET error:', error.message);
    return false;
  }
}

// Delete cached data
async function del(key) {
  try {
    const client = getRedisClient();
    if (!client) return false;

    await client.del(key);
    console.log('🗑️ [Redis] Cache DELETE:', key);
    return true;
  } catch (error) {
    console.log('❌ [Redis] DELETE error:', error.message);
    return false;
  }
}

// Delete multiple keys by pattern
async function delPattern(pattern) {
  try {
    const client = getRedisClient();
    if (!client) return false;

    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
      console.log('🗑️ [Redis] Pattern DELETE:', pattern, `Deleted ${keys.length} keys`);
    }
    return true;
  } catch (error) {
    console.log('❌ [Redis] Pattern DELETE error:', error.message);
    return false;
  }
}

// Check if Redis is available
async function isAvailable() {
  try {
    const client = getRedisClient();
    if (!client) return false;

    await client.ping();
    return true;
  } catch (error) {
    console.log('⚠️ [Redis] Not available:', error.message);
    return false;
  }
}

module.exports = {
  get,
  set,
  del,
  delPattern,
  isAvailable,
  getRedisClient,
};
