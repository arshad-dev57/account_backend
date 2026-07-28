// utils/redisClient.js - Redis caching utility

const Redis = require('ioredis');

let redisClient = null;

// Initialize Redis client
function getRedisClient() {
  if (!redisClient) {
    try {
      const redisUrl = process.env.REDIS_URL;
      
      console.log('🔍 [Redis] REDIS_URL:', redisUrl ? 'Set' : 'Not set');
      
      if (redisUrl) {
        // Use Upstash/cloud Redis URL
        redisClient = new Redis(redisUrl, {
          tls: {},
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            if (times > 3) {
              console.log('❌ [Redis] Connection failed after 3 retries');
              return null;
            }
            return Math.min(times * 100, 3000);
          },
        });
      } else {
        // Use local Redis
        redisClient = new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            if (times > 3) {
              console.log('❌ [Redis] Connection failed after 3 retries');
              return null;
            }
            return Math.min(times * 100, 3000);
          },
        });
      }

      redisClient.on('connect', () => {
        console.log('✅ [Redis] Connected successfully');
      });

      redisClient.on('error', (err) => {
        console.log('⚠️ [Redis] Connection error:', err.message);
      });
    } catch (error) {
      console.log('❌ [Redis] Failed to initialize:', error.message);
      return null;
    }
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
