import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import cache from "../config/cache.js";

/* ADD PROPERTY */
export const addProperty = async (req, res) => {
  try {
    const {
      name,
      address,
      location,
      price,
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
      (name, address, location, price, property_type, bedrooms, bathrooms, max_guests,
       status, description, latitude, longitude, admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute(insertSql, [
      name,
      address,
      location,
      Number(price) || 0,
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
export const getPublicProperties = (req, res) => {
  try {
    const TTL_MS = parseInt(process.env.PUBLIC_PROPERTIES_TTL_MS || String(30 * 1000), 10); // default 30s
    const cacheKey = "public:properties";

    const cachedPromise = cache.get ? cache.get(cacheKey) : Promise.resolve(null);
    cachedPromise.then((cached) => {
      if (cached) {
        res.setHeader('Cache-Control', `public, max-age=${Math.ceil(TTL_MS/1000)}`);
        return res.json(cached);
      }

      const sql = `
        SELECT 
          p.id,
          p.name,
          p.address,
          p.location,
          p.price,
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
          ) AS is_booked
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
    }).catch((cacheErr) => {
      console.warn('Cache lookup error for public properties', cacheErr);
      // fallback to DB query
      db.query(`SELECT p.*, GROUP_CONCAT(pi.image_url) AS images FROM properties p LEFT JOIN property_images pi ON p.id = pi.property_id WHERE LOWER(p.status) = 'available' GROUP BY p.id ORDER BY p.created_at DESC`, [], (err, results) => {
        if (err) return res.status(500).json({ message: 'Server error' });
        const formatted = (results || []).map((p) => ({ ...p, images: p.images ? p.images.split(',') : [] }));
        res.json(formatted);
      });
    });
  } catch (error) {
    console.error('Get public properties error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



/* GET SINGLE PUBLIC PROPERTY */
export const getPublicPropertyBySlug = (req, res) => {
  const { slug } = req.params;
  const name = slug.replace(/-/g, " ");

  const sql = `
    SELECT 
      p.id,
      p.name,
      p.address,
      p.location,
      p.price,
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
        ) AS is_booked
    FROM properties p
    WHERE LOWER(p.status) = 'available'
      AND LOWER(p.name) = LOWER(?)
    LIMIT 1
  `;

  db.query(sql, [name], (err, results) => {
    if (err) {
      console.error("Error fetching property by slug:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (!results?.length) {
      console.warn(`Property not found with slug (exact match): ${slug}. Trying permissive search.`);

      // Try a permissive fallback: match slug against a slugified name or partial LIKE match.
      // This helps when names contain punctuation, extra whitespace, or slight variations.
      const permissiveSql = `
        SELECT 
          p.id,
          p.name,
          p.address,
          p.location,
          p.price,
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
          ) AS is_booked
        FROM properties p
        WHERE LOWER(p.status) = 'available'
          AND (
            LOWER(p.name) = LOWER(?)
            OR LOWER(REPLACE(p.name, ' ', '-')) = LOWER(?)
            OR LOWER(p.name) LIKE CONCAT('%', ?, '%')
          )
        LIMIT 1
      `;

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
        console.log('✅ Property retrieved (permissive):', property.name);
        return res.json(property);
      });
    }

    const property = results[0];
    property.images = property.images ? property.images.split(",") : [];

    console.log("✅ Property retrieved:", property.name);
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

  // 1️⃣ Get images first
  const getImagesSql =
    "SELECT image_url FROM property_images WHERE property_id = ?";

  db.query(getImagesSql, [id], async (err, images) => {
    if (err) return res.status(500).json({ message: "Failed to fetch images" });

    try {
      // 2️⃣ Delete images from Cloudinary
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

      // 3️⃣ Delete property (CASCADE will handle images if set, else manual)
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
