import dotenv from 'dotenv';
dotenv.config();

// Lightweight cache utility with Redis support (if REDIS_URL provided)
// Fallback to in-memory Map with TTL when Redis not available.

let redisClient = null;
let useRedis = false;

async function tryInitRedis() {
  if (useRedis || redisClient) return;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  try {
    const { createClient } = await import('redis');
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (e) => console.warn('Redis client error', e));
    await redisClient.connect();
    useRedis = true;
    console.log(' Cache: connected to Redis');
  } catch (err) {
    console.warn(' Cache: Redis not available, falling back to in-memory cache', err && err.message ? err.message : err);
    redisClient = null;
    useRedis = false;
  }
}

// In-memory cache
const mem = new Map();

function memSet(key, value, ttlMs) {
  const expiresAt = ttlMs ? Date.now() + ttlMs : null;
  mem.set(key, { value, expiresAt });
  if (ttlMs) {
    setTimeout(() => {
      const cur = mem.get(key);
      if (cur && cur.expiresAt && cur.expiresAt <= Date.now()) mem.delete(key);
    }, ttlMs + 50);
  }
}

function memGet(key) {
  const entry = mem.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    mem.delete(key);
    return null;
  }
  return entry.value;
}

function memDel(key) {
  mem.delete(key);
}

export default {
  async init() {
    await tryInitRedis();
  },
  async get(key) {
    await tryInitRedis();
    if (useRedis && redisClient) {
      try {
        const data = await redisClient.get(key);
        if (!data) return null;
        return JSON.parse(data);
      } catch (err) {
        console.warn('Cache get error, falling back to memory:', err && err.message ? err.message : err);
        return memGet(key);
      }
    }
    return memGet(key);
  },
  async set(key, value, ttlMs) {
    await tryInitRedis();
    if (useRedis && redisClient) {
      try {
        const str = JSON.stringify(value);
        if (ttlMs) await redisClient.setEx(key, Math.ceil(ttlMs / 1000), str);
        else await redisClient.set(key, str);
        return true;
      } catch (err) {
        console.warn('Cache set error, falling back to memory:', err && err.message ? err.message : err);
        memSet(key, value, ttlMs);
        return false;
      }
    }
    memSet(key, value, ttlMs);
    return true;
  },
  async del(key) {
    await tryInitRedis();
    if (useRedis && redisClient) {
      try { await redisClient.del(key); return true; } catch (err) { console.warn('Cache del error', err); memDel(key); return false; }
    }
    memDel(key);
    return true;
  },
  async wrap(key, ttlMs, fn) {
    const v = await this.get(key);
    if (v !== null && v !== undefined) return v;
    const computed = await fn();
    await this.set(key, computed, ttlMs);
    return computed;
  }
};
