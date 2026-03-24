import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import cache from "../config/cache.js";

const slugify = (text) => {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

/* ADD PROPERTY */
export const addProperty = async (req, res) => {
  try {
    const {
      name,
      address,
      location,
      price,
      cautionFee,
      propertyType,
      bedrooms,
      bathrooms,
      maxGuests,
      status,
      description,
      latitude,
      longitude
    } = req.body;

    const files = req.files || [];
    const adminId = req.user && req.user.id ? req.user.id : null;

    // Upload images if present
    let imageUrls = [];
    if (files && files.length) {
      const uploadPromises = files.map((file) =>
        new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream({ folder: "properties" }, (error, result) => {
            if (error) return reject(error);
            resolve(result.secure_url);
          }).end(file.buffer);
        })
      );
      imageUrls = await Promise.all(uploadPromises);
    }

    const insertSql = `
      INSERT INTO properties
      (name, address, location, price, caution_fee, property_type, bedrooms, bathrooms, max_guests,
       status, description, latitude, longitude, admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute(insertSql, [
      name,
      address,
      location,
      Number(price) || 0,
      Number(cautionFee) || 0,
      propertyType,
      Number(bedrooms) || 0,
      Number(bathrooms) || 0,
      Number(maxGuests) || 0,
      status || 'available',
      description || '',
      latitude || null,
      longitude || null,
      adminId,
    ]);

    const propertyId = result.insertId;

    // Persist a stable slug for the property (used by the public detail page)
    // Format: <slugified-name>-<id> (unique and friendly)
    const slug = `${slugify(name)}-${propertyId}`;
    try {
      await db.execute("UPDATE properties SET slug = ? WHERE id = ?", [slug, propertyId]);
    } catch (e) {
      // If the slug column doesn't exist yet (older deployments), ignore.
      console.warn("Unable to persist property slug:", e && e.message ? e.message : e);
    }

    if (imageUrls && imageUrls.length) {
      const imageSql = `INSERT INTO property_images (property_id, image_url) VALUES ?`;
      const imageValues = imageUrls.map((u) => [propertyId, u]);
      await new Promise((resolve, reject) => db.query(imageSql, [imageValues], (e) => (e ? reject(e) : resolve())));
    }

    // Invalidate public properties cache
    try { await cache.del('public:properties'); } catch (e) { /* ignore */ }

    res.status(201).json({ message: 'Property added successfully', id: propertyId });
  } catch (error) {
    console.error('Add property error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/* GET ADMIN PROPERTIES */
export const getProperties = (req, res) => {
  const { id, role } = req.user;

  let sql = `
    SELECT p.*,
      GROUP_CONCAT(pi.image_url) AS images
    FROM properties p
    LEFT JOIN property_images pi ON p.id = pi.property_id
  `;

  let params = [];

  if (role !== "superadmin" && role !== "master") {
    sql += " WHERE p.admin_id = ?";
    params.push(id);
  }

  sql += " GROUP BY p.id ORDER BY p.created_at DESC";

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json([]);

    const formatted = results.map(p => ({
      ...p,
      images: p.images ? p.images.split(",") : []
    }));

    res.json(formatted);
  });
};

/* PUBLIC PROPERTIES */
export const getPublicProperties = async (req, res) => {
  try {
    const TTL_MS = parseInt(process.env.PUBLIC_PROPERTIES_TTL_MS || String(30 * 1000), 10); // default 30s
    const cacheKey = "public:properties";

    let cautionFeeField = "0 AS caution_fee";
    try {
      const [columnRows] = await db.execute(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'caution_fee' LIMIT 1`
      );
      if (columnRows && columnRows.length > 0) {
        cautionFeeField = "p.caution_fee";
      }
    } catch (colErr) {
      console.warn('Unable to determine caution_fee column existence:', colErr);
    }

    const cached = cache.get ? await cache.get(cacheKey) : null;
    if (cached) {
      res.setHeader('Cache-Control', `public, max-age=${Math.ceil(TTL_MS/1000)}`);
      return res.json(cached);
    }

      const sql = `
        SELECT 
          p.id,
          p.slug,
          p.name,
          p.address,
          p.location,
          p.price,
          ${cautionFeeField},
          p.max_guests,
          p.bedrooms,
          p.bathrooms,
          p.description,
          GROUP_CONCAT(pi.image_url) AS images,
          EXISTS(
            SELECT 1 FROM bookings b
            WHERE b.property_id = p.id
              AND b.payment_status = 'paid'
              AND CURDATE() >= b.check_in
              AND CURDATE() < b.check_out
          ) AS is_currently_occupied
        FROM properties p
        LEFT JOIN property_images pi ON p.id = pi.property_id
        WHERE LOWER(p.status) = 'available'
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;

      db.query(sql, [], async (err, results) => {
        if (err) {
          console.error('Get public properties query error:', err);
          return res.status(500).json({ message: 'Server error' });
        }

        const formatted = (results || []).map((p) => ({
          ...p,
          images: p.images ? p.images.split(',') : [],
        }));

        try { await cache.set(cacheKey, formatted, TTL_MS); } catch (e) { /* ignore */ }

        res.setHeader('Cache-Control', `public, max-age=${Math.ceil(TTL_MS/1000)}`);
        res.json(formatted);
      });
  } catch (error) {
    console.error('Get public properties error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



/* GET SINGLE PUBLIC PROPERTY */
export const getPublicPropertyBySlug = async (req, res) => {
  const { slug } = req.params;
  const normalizedSlug = slugify(slug);

  const buildDetailQuery = async (whereClause) => {
    let bookedDatesExpression = "NULL AS booked_dates";
    let cautionFeeExpression = "0 AS caution_fee";

    try {
      const [tableRows] = await db.execute(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'booked_dates' LIMIT 1`
      );

      if (tableRows && tableRows.length > 0) {
        bookedDatesExpression = `(
          SELECT GROUP_CONCAT(DISTINCT bd.booked_date)
          FROM booked_dates bd
          WHERE bd.property_id = p.id
            AND bd.booked_date >= CURDATE()
          ORDER BY bd.booked_date
        ) AS booked_dates`;
      }

      const [columnRows] = await db.execute(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'caution_fee' LIMIT 1`
      );

      if (columnRows && columnRows.length > 0) {
        cautionFeeExpression = 'p.caution_fee AS caution_fee';
      }
    } catch (tableCheckErr) {
      console.warn('Unable to determine booked_dates/caution_fee availability:', tableCheckErr);
    }

    return `
      SELECT
        p.id,
        p.slug,
        p.name,
        p.address,
        p.location,
        p.price,
        ${cautionFeeExpression},
        p.max_guests,
        p.bedrooms,
        p.bathrooms,
        p.description,
        p.latitude,
        p.longitude,
        (
          SELECT GROUP_CONCAT(pi.image_url)
          FROM property_images pi
          WHERE pi.property_id = p.id
        ) AS images,
        EXISTS(
          SELECT 1 FROM bookings b
          WHERE b.property_id = p.id
            AND b.payment_status = 'paid'
            AND CURDATE() >= b.check_in
            AND CURDATE() < b.check_out
        ) AS is_currently_occupied,
        ${bookedDatesExpression}
      FROM properties p
      WHERE LOWER(p.status) = 'available'
        AND ${whereClause}
      LIMIT 1
    `;
  };

  const getPropertyById = async (id) => {
    const sql = await buildDetailQuery('p.id = ?');
    return new Promise((resolve, reject) => {
      db.query(sql, [id], (err, results) => {
        if (err) return reject(err);
        const prop = results && results[0] ? results[0] : null;
        if (prop) prop.images = prop.images ? prop.images.split(",") : [];
        resolve(prop);
      });
    });
  };

  const getPropertyBySlugColumn = async (slugValue) => {
    const sql = await buildDetailQuery('LOWER(p.slug) = LOWER(?)');
    return new Promise((resolve, reject) => {
      db.query(sql, [slugValue], (err, results) => {
        if (err) return reject(err);
        const prop = results && results[0] ? results[0] : null;
        if (prop) prop.images = prop.images ? prop.images.split(",") : [];
        resolve(prop);
      });
    });
  };

  // 1) Attempt to resolve using cached public properties (fast, consistent with list page)
  try {
    const cached = cache.get ? await cache.get('public:properties') : null;
    if (Array.isArray(cached)) {
      const candidate = cached.find((p) => {
        if (!p) return false;
        const candidates = new Set();
        if (p.slug) candidates.add(slugify(p.slug));
        if (p.name) candidates.add(slugify(p.name));
        if (p.id && p.name) candidates.add(`${slugify(p.name)}-${p.id}`);
        return candidates.has(normalizedSlug);
      });

      if (candidate && candidate.id) {
        const detail = await getPropertyById(candidate.id);
        if (detail) {
          console.log(' Property retrieved (cache match):', detail.name);
          return res.json(detail);
        }
      }
    }
  } catch (cacheErr) {
    console.warn('Cache lookup error in getPublicPropertyBySlug:', cacheErr);
  }

  // 2) Try direct slug column match (newer deployments)
  try {
    const bySlug = await getPropertyBySlugColumn(normalizedSlug);
    if (bySlug) {
      console.log(' Property retrieved (slug column):', bySlug.name);
      return res.json(bySlug);
    }
  } catch (err) {
    // If the slug column does not exist, fall back without failing hard.
    if (!/Unknown column/.test(err.message || '')) {
      console.error('Error querying by slug column:', err);
    }
  }

  // 3) Fallback to name-based matching (existing behavior)
  const name = slug.replace(/-/g, " ");

  const sql = await buildDetailQuery('LOWER(p.name) = LOWER(?)');
  db.query(sql, [name], (err, results) => {
    if (err) {
      console.error("Error fetching property by slug:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (!results?.length) {
      console.warn(`Property not found with slug (exact match): ${slug}. Trying permissive search.`);

      const permissiveSql = buildDetailQuery(`(
        LOWER(p.name) = LOWER(?)
        OR LOWER(REPLACE(p.name, ' ', '-')) = LOWER(?)
        OR LOWER(p.name) LIKE CONCAT('%', ?, '%')
      )`);

      const slugified = slug; // e.g., '3-bedroom-apartment'
      const likePattern = name; // '3 bedroom apartment' will be used in LIKE

      return db.query(permissiveSql, [name, slugified, likePattern], (err2, res2) => {
        if (err2) {
          console.error('Permissive property search error:', err2);
          return res.status(500).json({ message: 'Server error' });
        }

        if (!res2 || res2.length === 0) {
          console.warn(`Property not found after permissive search: ${slug}`);
          return res.status(404).json({ message: 'Shortlet not found' });
        }

        const property = res2[0];
        property.images = property.images ? property.images.split(',') : [];
        console.log(' Property retrieved (permissive):', property.name);
        return res.json(property);
      });
    }

    const property = results[0];
    property.images = property.images ? property.images.split(",") : [];

    console.log(" Property retrieved:", property.name);
    res.json(property);
  });
};

/* CHECK AVAILABILITY FOR A PROPERTY */
export const getPropertyAvailability = (req, res) => {
  try {
    const { id } = req.params;
    const { check_in, check_out } = req.query;

    if (!check_in || !check_out) return res.status(400).json({ message: 'check_in and check_out are required' });

    // Ensure dates are valid
    const ci = new Date(check_in);
    const co = new Date(check_out);
    if (isNaN(ci.getTime()) || isNaN(co.getTime()) || co <= ci) {
      return res.status(400).json({ message: 'Invalid check_in/check_out dates' });
    }

    const sql = `
      SELECT COUNT(*) AS cnt FROM bookings b
      WHERE b.property_id = ?
        AND b.payment_status = 'paid'
        AND NOT (b.check_out <= ? OR b.check_in >= ?)
    `;

    db.execute(sql, [id, check_in, check_out])
      .then(([rows]) => {
        const cnt = rows && rows[0] ? Number(rows[0].cnt) : 0;
        res.json({ available: cnt === 0, overlapping: cnt });
      })
      .catch((err) => {
        console.error('Availability query error:', err);
        res.status(500).json({ message: 'Failed to check availability' });
      });
  } catch (err) {
    console.error('getPropertyAvailability error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};





/* DELETE PROPERTY */
export const deleteProperty = (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;
  const role = req.user.role;

  // 1️ Get images first
  const getImagesSql =
    "SELECT image_url FROM property_images WHERE property_id = ?";

  db.query(getImagesSql, [id], async (err, images) => {
    if (err) return res.status(500).json({ message: "Failed to fetch images" });

    try {
      //2️ Delete images from Cloudinary
      // Be robust when deriving Cloudinary public_id from the stored URL.
      // Cloudinary URLs are typically like: /upload/v12345/folder/subfolder/name.jpg
      // We strip the '/upload/' prefix, remove the version segment and extension.
      for (const img of images) {
        try {
          const url = img.image_url || "";
          const uploadIdx = url.indexOf("/upload/");
          let publicId;

          if (uploadIdx !== -1) {
            publicId = url.substring(uploadIdx + "/upload/".length);
            // remove version prefix like v123456/ if present
            publicId = publicId.replace(/^v\d+\//, "");
            // remove file extension
            publicId = publicId.replace(/\.[^/.]+$/, "");
          } else {
            // fallback to previous heuristic
            publicId = img.image_url.split("/").slice(-2).join("/").split(".")[0];
          }

          await cloudinary.uploader.destroy(publicId);
        } catch (destroyErr) {
          console.warn("Cloudinary destroy failed for", img.image_url, destroyErr);
          // continue deleting other images even if one fails
        }
      }

      // 3️ Delete property (CASCADE will handle images if set, else manual)
      let deleteSql = "DELETE FROM properties WHERE id = ?";
      let params = [id];

      if (role === "admin") {
        deleteSql += " AND admin_id = ?";
        params.push(adminId);
      }

      db.query(deleteSql, params, (delErr, result) => {
        if (delErr)
          return res.status(500).json({ message: "Delete failed" });

        if (result.affectedRows === 0)
          return res.status(403).json({ message: "Not allowed" });

        res.json({ message: "Property deleted successfully" });
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Cloudinary delete failed" });
    }
  });
};
