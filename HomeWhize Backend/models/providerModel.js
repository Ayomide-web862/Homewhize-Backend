import db from "../config/db.js";
import cache from "../config/cache.js";

// Helper: generate slug from company name
export function generateSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')      // spaces → hyphens
    .replace(/[^a-z0-9-]/g, ''); // remove non-alphanum
}

// Create a new provider
export const createProvider = async ({ company_name, email, phone, address, description = '', categories = '', user_id = null }) => {
  const normalized = (categories || '').split(',').map(s => s.trim()).filter(Boolean).join(',');

  // Generate a unique slug (append short suffix if necessary)
  let baseSlug = generateSlug(company_name || 'provider');
  let slug = baseSlug;
  let attempts = 0;
  while (attempts < 5) {
    // check if slug exists
    const [rows] = await db.execute(`SELECT id FROM providers WHERE slug = ? LIMIT 1`, [slug]);
    if (!rows || rows.length === 0) break; // unique
    // append small random suffix and retry
    slug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
    attempts++;
  }

  const sql = `INSERT INTO providers (company_name, slug, email, phone, address, description, categories, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await db.execute(sql, [company_name, slug, email, phone, address, description, normalized, user_id]);
  return { id: result.insertId, company_name, slug, email, phone, address, description, categories: normalized, user_id };
};

// Fetch provider by slug
export const getProviderBySlug = async (slug) => {
  // Accept numeric IDs in the slug path (frontend may pass an id).
  if (/^\d+$/.test(String(slug))) {
    const id = Number(slug);
    const [rowsId] = await db.execute(`SELECT * FROM providers WHERE id = ? LIMIT 1`, [id]);
    if (!rowsId || rowsId.length === 0) return null;
    const pId = rowsId[0];
    const [servicesId] = await db.execute(`SELECT * FROM services WHERE provider_id = ?`, [pId.id]);
    return {
      ...pId,
      categories: (pId.categories || '').split(',').filter(Boolean),
      services: servicesId || [],
    };
  }

  const cacheKey = `provider:slug:${slug}`;
  const ttl = parseInt(process.env.PROVIDER_TTL_MS || '60000', 10);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const [rows] = await db.execute(`SELECT * FROM providers WHERE slug = ? LIMIT 1`, [slug]);
  if (!rows || rows.length === 0) return null;
  const p = rows[0];
  const [services] = await db.execute(`SELECT * FROM services WHERE provider_id = ?`, [p.id]);
  const mapped = {
    ...p,
    categories: (p.categories || '').split(',').filter(Boolean),
    services: (services || []).map(s => ({
      ...s,
      description: s.description || '',
      title: s.title || s.name || '',
      price: s.price ? Number(s.price) : 0,
      estimatedDuration: s.estimated_duration || s.estimatedDuration || null,
      images: s.images ? (String(s.images).split(',').map(x => x.trim()).filter(Boolean)) : [],
    })),
  };
  await cache.set(cacheKey, mapped, ttl).catch(() => {});
  return mapped;
};

// Existing functions for ID or listing
export const getProviderById = async (id) => {
  const [rows] = await db.execute(`SELECT * FROM providers WHERE id = ? LIMIT 1`, [id]);
  if (!rows || rows.length === 0) return null;
  const p = rows[0];
  const [services] = await db.execute(`SELECT * FROM services WHERE provider_id = ?`, [id]);
  return {
    ...p,
    categories: (p.categories || '').split(',').filter(Boolean),
    services: (services || []).map(s => ({
      ...s,
      description: s.description || '',
      title: s.title || s.name || '',
      price: s.price ? Number(s.price) : 0,
      estimatedDuration: s.estimated_duration || s.estimatedDuration || null,
      images: s.images ? (String(s.images).split(',').map(x => x.trim()).filter(Boolean)) : [],
    })),
  };
};

export const getProviders = async ({ category = null } = {}) => {
  if (!category) {
    const ttl = parseInt(process.env.PROVIDERS_TTL_MS || '60000', 10);
    const cacheKey = 'providers:all';
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const [rows] = await db.execute(`SELECT * FROM providers ORDER BY created_at DESC`);
    const mapped = rows.map(r => ({ ...r, categories: (r.categories||'').split(',').filter(Boolean) }));
    await cache.set(cacheKey, mapped, ttl).catch(()=>{});
    return mapped;
  }
  const cat = category.trim();
  const cacheKey = `providers:category:${cat}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const [rows] = await db.execute(
    `SELECT * FROM providers WHERE FIND_IN_SET(?, categories) > 0 ORDER BY created_at DESC`,
    [cat]
  );
  const mapped = rows.map(r => ({ ...r, categories: (r.categories||'').split(',').filter(Boolean) }));
  const ttlCat = parseInt(process.env.PROVIDERS_TTL_MS || '60000', 10);
  await cache.set(cacheKey, mapped, ttlCat).catch(()=>{});
  return mapped;
};

export default { createProvider, getProviderById, getProviderBySlug, getProviders, generateSlug };