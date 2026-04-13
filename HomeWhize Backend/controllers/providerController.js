import { createProvider, getProviderById, getProviders, getProviderBySlug, invalidateProviderCaches } from "../models/providerModel.js";
import db from "../config/db.js";

// Create service for a provider
export const createServiceForProvider = async (req, res, next) => {
  try {
    const providerId = Number(req.params.id);
    if (!providerId) return res.status(400).json({ message: 'Invalid provider id' });

    // Ensure authenticated user is present
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Not authenticated' });

    // Ensure provider exists and ownership
    const [provRows] = await db.execute(`SELECT * FROM providers WHERE id = ? LIMIT 1`, [providerId]);
    if (!provRows || provRows.length === 0) return res.status(404).json({ message: 'Provider not found' });
    const provider = provRows[0];

    // Only provider owner or admin/superadmin can create services
    const allowedAdminRoles = ['admin', 'superadmin', 'master'];
    if (provider.user_id !== user.id && !allowedAdminRoles.includes(user.role)) {
      return res.status(403).json({ message: 'Forbidden: not owner' });
    }

    const { title, category, description, price, estimatedDuration, images } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ message: 'title is required' });
    }

    const est = estimatedDuration || null;
    const imgs = Array.isArray(images) ? images.join(',') : (images || null);
    const priceNum = price === undefined || price === null ? 0 : Number(String(price).replace(/,/g, ''));
    if (isNaN(priceNum) || priceNum < 0) return res.status(400).json({ message: 'Invalid price' });

    const sql = `INSERT INTO services (provider_id, title, category, description, price, estimated_duration, images) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const [result] = await db.execute(sql, [providerId, title.trim(), category || null, description || null, priceNum, est, imgs]);

    const [rows] = await db.execute(`SELECT * FROM services WHERE id = ? LIMIT 1`, [result.insertId]);
    const s = rows && rows[0] ? rows[0] : null;
    if (!s) return res.status(500).json({ message: 'Failed to create service' });

    const mapped = {
      id: s.id,
      provider_id: s.provider_id,
      title: s.title || '',
      category: s.category || null,
      description: s.description || '',
      price: s.price ? Number(s.price) : 0,
      estimatedDuration: s.estimated_duration || null,
      images: s.images ? String(s.images).split(',').map(x=>x.trim()).filter(Boolean) : [],
      created_at: s.created_at,
      updated_at: s.updated_at,
    };

    await invalidateProviderCaches({ slug: provider.slug, categories: provider.categories }).catch(() => {});
    res.status(201).json({ service: mapped });
  } catch (err) {
    next(err);
  }
};

// Get provider for the authenticated user
export const getMyProviderHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Not authenticated' });

    const [rows] = await db.execute(`SELECT * FROM providers WHERE user_id = ? LIMIT 1`, [user.id]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'Provider not found for user' });
    const p = rows[0];
    const [services] = await db.execute(`SELECT * FROM services WHERE provider_id = ? ORDER BY created_at DESC`, [p.id]);

    const mappedServices = (services || []).map(s => ({
      id: s.id,
      provider_id: s.provider_id,
      title: s.title || '',
      category: s.category || null,
      description: s.description || '',
      price: s.price ? Number(s.price) : 0,
      estimatedDuration: s.estimated_duration || null,
      images: s.images ? String(s.images).split(',').map(x=>x.trim()).filter(Boolean) : [],
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));

    res.json({ provider: { ...p, services: mappedServices } });
  } catch (err) {
    next(err);
  }
};

export const createProviderHandler = async (req, res, next) => {
  try {
    const { company_name, email, phone, address, description, categories, user_id } = req.body;
    if (!company_name || !email) return res.status(400).json({ message: 'company_name and email are required' });
    const provider = await createProvider({ company_name, email, phone, address, description, categories, user_id });
    res.status(201).json({ message: 'Provider created', provider });
  } catch (err) {
    next(err);
  }
};

export const getProviderHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const provider = await getProviderById(id);
    if (!provider) return res.status(404).json({ message: 'Provider not found' });
    res.json(provider);
  } catch (err) {
    next(err);
  }
};

export const getProviderBySlugHandler = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const provider = await getProviderBySlug(slug);
    if (!provider) return res.status(404).json({ message: 'Provider not found' });
    res.json(provider);
  } catch (err) {
    next(err);
  }
};

export const listProvidersHandler = async (req, res, next) => {
  try {
    const { category } = req.query;
    const providers = await getProviders({ category });
    res.json({ providers });
  } catch (err) {
    next(err);
  }
};

// Delete provider and optionally its linked user (transactional)
export const deleteProviderHandler = async (req, res, next) => {
  let connection;
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid provider id' });

    // Only allow privileged roles (route should also protect) — double-check
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Not authenticated' });

    // Start transaction
    connection = await new Promise((resolve, reject) => db.getConnection((err, conn) => err ? reject(err) : resolve(conn)));
    const connP = connection.promise();
    await connP.beginTransaction();

    const [provRows] = await connP.execute(`SELECT * FROM providers WHERE id = ? LIMIT 1`, [id]);
    if (!provRows || provRows.length === 0) {
      await connP.rollback();
      connection.release();
      return res.status(404).json({ message: 'Provider not found' });
    }

    const provider = provRows[0];

    // Only superadmin/master or owner can delete
    const allowed = ['superadmin', 'master'];
    if (!allowed.includes(user.role) && provider.user_id !== user.id) {
      await connP.rollback();
      connection.release();
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Delete provider
    await connP.execute(`DELETE FROM providers WHERE id = ?`, [id]);

    // If provider had linked user, delete user as well
    if (provider.user_id) {
      await connP.execute(`DELETE FROM users WHERE id = ?`, [provider.user_id]);
    }

    await connP.commit();
    await invalidateProviderCaches({ slug: provider.slug, categories: provider.categories }).catch(() => {});
    connection.release();
    res.json({ message: 'Provider and linked user deleted' });
  } catch (err) {
    try {
      if (connection) await connection.promise().rollback();
      if (connection) connection.release();
    } catch (e) {
      // ignore
    }
    next(err);
  }
};

export default {
  createProviderHandler,
  getProviderHandler,
  getProviderBySlugHandler,
  listProvidersHandler,
  createServiceForProvider,
  getMyProviderHandler,
  deleteProviderHandler,
};