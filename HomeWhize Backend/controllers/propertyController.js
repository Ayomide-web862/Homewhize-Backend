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

const uploadPropertyImage = (file) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: "properties", timeout: 60000 },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error("Cloudinary returned no image URL"));
        resolve(result.secure_url);
      }
    ).end(file.buffer);
  });

const getCloudinaryPublicId = (url) => {
  const marker = "/upload/";
  const uploadIndex = String(url || "").indexOf(marker);
  if (uploadIndex === -1) return null;

  const publicPath = String(url)
    .slice(uploadIndex + marker.length)
    .split("/")
    .filter((segment) => !/^v\d+$/.test(segment))
    .join("/");
  return publicPath.replace(/\.[^/.]+$/, "") || null;
};

const removeCloudinaryImage = async (url) => {
  const publicId = getCloudinaryPublicId(url);
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
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

    console.log('[addProperty] Request received for property:', name);
    console.log('[addProperty] req.files structure:', req.files ? Object.keys(req.files) : 'NO FILES');
    console.log('[addProperty] Total files:', req.files ? Object.values(req.files).flat().length : 0);

    // Handle multer file structure - files can be under 'images' or 'images[]'
    let filesArray = [];
    if (req.files) {
      filesArray = req.files.images || req.files['images[]'] || [];
    }
    
    console.log('[addProperty] Resolved filesArray length:', filesArray.length);

    const adminId = req.user && req.user.id ? req.user.id : null;
    const adminName = req.user && req.user.name ? req.user.name : null;
    const adminEmail = req.user && req.user.email ? req.user.email : null;

    // Upload images to Cloudinary with timeout and retry
    let imageUrls = [];
    if (filesArray && filesArray.length) {
      console.log('[addProperty] Starting Cloudinary uploads for', filesArray.length, 'files');
      
      const uploadWithRetry = (file, idx, maxRetries = 2) => {
        return new Promise((resolve, reject) => {
          const attemptUpload = (attempt = 0) => {
            const uploadTimeout = setTimeout(() => {
              console.warn(`[addProperty] Upload attempt ${attempt + 1} timeout for file ${idx + 1}`);
              reject(new Error(`Upload timeout for file ${idx + 1} after ${attempt + 1} attempt(s)`));
            }, 60000); // 60 second timeout per attempt

            cloudinary.uploader.upload_stream(
              { folder: "properties", timeout: 60000 },
              (error, result) => {
                clearTimeout(uploadTimeout);

                if (error) {
                  console.error(`[addProperty] Cloudinary upload failed for file ${idx + 1} (attempt ${attempt + 1}):`, error.message);
                  if (attempt < maxRetries) {
                    console.log(`[addProperty] Retrying file ${idx + 1}... (attempt ${attempt + 2}/${maxRetries + 1})`);
                    setTimeout(() => attemptUpload(attempt + 1), 2000); // Wait 2s before retry
                  } else {
                    reject(error);
                  }
                } else {
                  console.log(`[addProperty] Cloudinary upload successful for file ${idx + 1}:`, result.secure_url.substring(0, 50) + '...');
                  resolve(result.secure_url);
                }
              }
            ).end(file.buffer);
          };

          attemptUpload();
        });
      };

      const uploadPromises = filesArray.map((file, idx) => uploadWithRetry(file, idx));
      
      try {
        imageUrls = await Promise.all(uploadPromises);
        console.log('[addProperty] All Cloudinary uploads complete. URLs:', imageUrls.length);
      } catch (uploadError) {
        console.error('[addProperty] Image upload failed:', uploadError.message);
        return res.status(400).json({ message: 'Image upload failed: ' + uploadError.message });
      }
    } else {
      console.log('[addProperty] No files to upload');
    }

    const insertSql = `
      INSERT INTO properties
      (name, address, location, price, caution_fee, property_type, bedrooms, bathrooms, max_guests,
       status, description, latitude, longitude, admin_id, admin_name, admin_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      adminName,
      adminEmail,
    ]);

    const propertyId = result.insertId;

    // Persist a stable slug for the property (used by the public detail page)
    // Format: <slugified-name>-<id> (unique and friendly)
    const slug = `${slugify(name)}-${propertyId}`;
    try {
      await db.execute("UPDATE properties SET slug = ? WHERE id = ?", [slug, propertyId]);
      console.log('[addProperty] Slug persisted:', slug);
    } catch (e) {
      // If the slug column doesn't exist yet (older deployments), ignore.
      console.warn("Unable to persist property slug:", e && e.message ? e.message : e);
    }

    if (imageUrls && imageUrls.length) {
      console.log('[addProperty] Inserting', imageUrls.length, 'images for property', propertyId);
      const imageSql = `INSERT INTO property_images (property_id, image_url) VALUES ?`;
      const imageValues = imageUrls.map((u) => [propertyId, u]);
      
      try {
        await new Promise((resolve, reject) => {
          db.query(imageSql, [imageValues], (e) => {
            if (e) {
              console.error('[addProperty] Database insert failed:', e.message);
              reject(e);
            } else {
              console.log('[addProperty] Database insert successful for', imageValues.length, 'images');
              resolve();
            }
          });
        });
      } catch (dbErr) {
        console.error('[addProperty] Image insertion failed:', dbErr.message);
        throw dbErr;
      }
    } else {
      console.log('[addProperty] No images to insert');
    }

    // Invalidate public properties cache
    try { await cache.del('public:properties'); } catch (e) { /* ignore */ }

    console.log('[addProperty] Success! Property created with ID:', propertyId, 'Images uploaded:', imageUrls.length);
    res.status(201).json({ message: 'Property added successfully', id: propertyId });
  } catch (error) {
    console.error('[addProperty] Error creating property:', error.message);
    console.error('[addProperty] Error stack:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/* GET ADMIN PROPERTIES */
export const getProperties = (req, res) => {
  const { id, role } = req.user;

  let sql = `
    SELECT p.*,
      GROUP_CONCAT(pi.image_url) AS images,
      u.name AS admin_name,
      u.email AS admin_email
    FROM properties p
    LEFT JOIN property_images pi ON p.id = pi.property_id
    LEFT JOIN users u ON p.admin_id = u.id
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

/* GET ALL PROPERTIES FOR SUPERADMIN WITH ADMIN DETAILS */
export const getAllPropertiesForSuperAdmin = (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(5, Math.min(50, Number(req.query.limit) || 12));
  const offset = (page - 1) * limit;

  const countSql = `SELECT COUNT(*) AS total FROM properties`;
  db.query(countSql, [], (countErr, countResults) => {
    if (countErr) {
      console.error('Count properties error:', countErr);
      return res.status(500).json({ properties: [], total: 0, page, totalPages: 0 });
    }

    const total = countResults && countResults[0] ? countResults[0].total : 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);

    const sql = `
      SELECT
        p.*,
        GROUP_CONCAT(pi.image_url) AS images,
        u.name AS admin_name,
        u.email AS admin_email
      FROM properties p
      LEFT JOIN property_images pi ON p.id = pi.property_id
      LEFT JOIN users u ON p.admin_id = u.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    db.query(sql, [limit, offset], (err, results) => {
      if (err) {
        console.error('Get all properties for superadmin error:', err);
        return res.status(500).json({ properties: [], total, page, totalPages });
      }

      const formatted = results.map(p => ({
        ...p,
        images: p.images ? p.images.split(",") : []
      }));

      res.json({
        properties: formatted,
        total,
        limit,
        page,
        totalPages,
      });
    });
  });
};

/* GET PUBLIC PROPERTIES COUNT - LIGHTWEIGHT ENDPOINT */
export const getPublicPropertiesCount = async (req, res) => {
  try {
    const cacheKey = "public:properties:count";
    const TTL_MS = parseInt(process.env.PUBLIC_PROPERTIES_TTL_MS || String(30 * 1000), 10);

    // Check cache first (fast)
    const cached = cache.get ? await cache.get(cacheKey) : null;
    if (cached) {
      res.setHeader('Cache-Control', `public, max-age=${Math.ceil(TTL_MS/1000)}`);
      return res.json(cached);
    }

    // Simple COUNT query - very fast
    const sql = `
      SELECT COUNT(*) as count
      FROM properties
      WHERE LOWER(status) IN ('available', 'booked')
    `;

    db.query(sql, [], async (err, results) => {
      if (err) {
        console.error('Get public properties count error:', err);
        return res.status(500).json({ message: 'Server error' });
      }

      const count = results[0]?.count || 0;
      const response = { count };

      try { await cache.set(cacheKey, response, TTL_MS); } catch (e) { /* ignore */ }

      res.setHeader('Cache-Control', `public, max-age=${Math.ceil(TTL_MS/1000)}`);
      res.json(response);
    });
  } catch (error) {
    console.error('Get public properties count error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/* PUBLIC PROPERTIES */
export const getPublicProperties = async (req, res) => {
  try {
    const TTL_MS = parseInt(process.env.PUBLIC_PROPERTIES_TTL_MS || String(30 * 1000), 10); // default 30s
    const cacheKey = "public:properties";

    let cautionFeeField = "0 AS caution_fee";
    let bookedDatesSubquery = "NULL AS booked_dates";

    try {
      const [cautionColumnRows] = await db.execute(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'caution_fee' LIMIT 1`
      );
      if (cautionColumnRows && cautionColumnRows.length > 0) {
        cautionFeeField = "p.caution_fee";
      }

      const [bookedDatesTable] = await db.execute(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'booked_dates' LIMIT 1`
      );
      if (bookedDatesTable && bookedDatesTable.length > 0) {
        bookedDatesSubquery = `(
          SELECT GROUP_CONCAT(bd.booked_date ORDER BY bd.booked_date SEPARATOR ',')
          FROM booked_dates bd
          WHERE bd.property_id = p.id
            AND bd.booked_date >= CURDATE()
        ) AS booked_dates`;
      }
    } catch (colErr) {
      console.warn('Unable to determine caution_fee/booked_dates presence:', colErr);
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
          ${bookedDatesSubquery},
          GROUP_CONCAT(pi.image_url) AS images,
          (
            LOWER(p.status) = 'booked'
            OR EXISTS(
              SELECT 1 FROM bookings b
              WHERE b.property_id = p.id
                AND b.payment_status = 'paid'
                AND CURDATE() >= b.check_in
                AND CURDATE() < b.check_out
            )
          ) AS is_currently_occupied
        FROM properties p
        LEFT JOIN property_images pi ON p.id = pi.property_id
        WHERE LOWER(p.status) IN ('available', 'booked')
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
          booked_dates: p.booked_dates ? p.booked_dates.split(',') : [],
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
      WHERE LOWER(p.status) IN ('available', 'booked')
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
        if (prop) {
          prop.images = prop.images ? prop.images.split(",") : [];
          prop.booked_dates = prop.booked_dates ? prop.booked_dates.split(",") : [];
        }
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
        if (prop) {
          prop.images = prop.images ? prop.images.split(",") : [];
          prop.booked_dates = prop.booked_dates ? prop.booked_dates.split(",") : [];
        }
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
export const getPropertyAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { check_in, check_out } = req.query;

    if (!check_in || !check_out) return res.status(400).json({ message: 'check_in and check_out are required' });

    const ci = new Date(check_in);
    const co = new Date(check_out);
    if (isNaN(ci.getTime()) || isNaN(co.getTime()) || co <= ci) {
      return res.status(400).json({ message: 'Invalid check_in/check_out dates' });
    }

    let bookedDates = [];
    let overlapping = 0;
    let available = true;

    try {
      const [bdTable] = await db.execute(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'booked_dates' LIMIT 1`
      );

      if (bdTable && bdTable.length > 0) {
        const [rows] = await db.execute(
          `SELECT booked_date FROM booked_dates WHERE property_id = ? AND booked_date >= ? AND booked_date < ? ORDER BY booked_date`,
          [id, check_in, check_out]
        );

        bookedDates = rows.map((r) => r.booked_date);
        overlapping = bookedDates.length;
        available = overlapping === 0;
      } else {
        // Fallback to booking intervals if `booked_dates` table does not exist
        const [rows] = await db.execute(
          `SELECT b.check_in, b.check_out FROM bookings b WHERE b.property_id = ? AND b.payment_status = 'paid' AND NOT (b.check_out <= ? OR b.check_in >= ?)`,
          [id, check_in, check_out]
        );

        overlapping = rows.length;
        available = overlapping === 0;

        if (rows.length > 0) {
          // Expand overlapping bookings into day-level set for frontend
          const blocked = new Set();
          for (const r of rows) {
            let d = new Date(r.check_in);
            const end = new Date(r.check_out);
            while (d < end) {
              blocked.add(d.toISOString().slice(0, 10));
              d.setDate(d.getDate() + 1);
            }
          }
          bookedDates = Array.from(blocked).sort();
        }
      }
    } catch (tableErr) {
      console.warn('getPropertyAvailability failed to query booked_dates/bookings', tableErr);
      return res.status(500).json({ message: 'Failed to check availability' });
    }

    res.json({ available, overlapping, booked_dates: bookedDates });
  } catch (err) {
    console.error('getPropertyAvailability error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};





/* UPDATE PROPERTY */
export const updateProperty = async (req, res) => {
  const { id } = req.params;
  const role = req.user?.role;
  const adminId = req.user?.id;
  const uploadedFiles = [
    ...(req.files?.images || []),
    ...(req.files?.["images[]"] || []),
  ];
  const hasKeepImages = Object.prototype.hasOwnProperty.call(req.body, "keepImages");
  let keepImages;
  let uploadedUrls = [];
  let connection;

  try {
    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ message: "Invalid property ID" });
    }

    if (uploadedFiles.length > 10) {
      return res.status(400).json({ message: "A property can have at most 10 images" });
    }

    if (hasKeepImages) {
      try {
        keepImages = JSON.parse(req.body.keepImages);
      } catch {
        return res.status(400).json({ message: "Invalid image list" });
      }
      if (!Array.isArray(keepImages) || keepImages.some((url) => typeof url !== "string")) {
        return res.status(400).json({ message: "Invalid image list" });
      }
    }

    const [propertyRows] = await db.execute(
      "SELECT id, admin_id FROM properties WHERE id = ?",
      [id]
    );
    if (!propertyRows.length) return res.status(404).json({ message: "Property not found" });
    if (role === "admin" && Number(propertyRows[0].admin_id) !== Number(adminId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const [currentImageRows] = await db.execute(
      "SELECT image_url FROM property_images WHERE property_id = ?",
      [id]
    );
    const currentImages = currentImageRows.map((row) => row.image_url);
    if (!hasKeepImages) keepImages = currentImages;

    if (keepImages.some((url) => !currentImages.includes(url))) {
      return res.status(400).json({ message: "Image list contains an image not attached to this property" });
    }
    if (keepImages.length + uploadedFiles.length > 10) {
      return res.status(400).json({ message: "A property can have at most 10 images" });
    }

    const hasField = (...names) => names.some((name) =>
      Object.prototype.hasOwnProperty.call(req.body, name)
    );
    const fieldValue = (...names) => {
      const name = names.find((key) => Object.prototype.hasOwnProperty.call(req.body, key));
      return name ? req.body[name] : undefined;
    };
    const updates = [];
    const values = [];
    const addUpdate = (column, value) => {
      updates.push(`${column} = ?`);
      values.push(value);
    };
    const addText = (column, aliases, { required = false, nullable = false } = {}) => {
      if (!hasField(...aliases)) return;
      const value = fieldValue(...aliases);
      if (value === "" && nullable) return addUpdate(column, null);
      if (typeof value !== "string" || (required && !value.trim())) {
        throw new Error(`${aliases[0]} must be a non-empty string`);
      }
      addUpdate(column, value.trim());
    };
    const addNumber = (column, aliases, { integer = false, nullable = false, min = 0, max = Infinity } = {}) => {
      if (!hasField(...aliases)) return;
      const rawValue = fieldValue(...aliases);
      if ((rawValue === "" || rawValue === null) && nullable) return addUpdate(column, null);
      const number = Number(rawValue);
      if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
        throw new Error(`${aliases[0]} is invalid`);
      }
      addUpdate(column, number);
    };

    addText("name", ["name"], { required: true });
    addText("address", ["address"], { required: true });
    addText("location", ["location"], { required: true });
    addNumber("price", ["price"]);
    addNumber("caution_fee", ["cautionFee", "caution_fee"]);
    addText("property_type", ["propertyType", "property_type"], { nullable: true });
    addNumber("bedrooms", ["bedrooms"], { integer: true });
    addNumber("bathrooms", ["bathrooms"], { integer: true });
    addNumber("max_guests", ["maxGuests", "max_guests"], { integer: true });
    addText("description", ["description"]);
    addNumber("latitude", ["latitude"], { nullable: true, min: -90, max: 90 });
    addNumber("longitude", ["longitude"], { nullable: true, min: -180, max: 180 });

    if (hasField("status")) {
      const status = String(fieldValue("status")).toLowerCase();
      if (!["available", "booked"].includes(status)) {
        return res.status(400).json({ message: "Status must be Available or Booked" });
      }
      addUpdate("status", status === "available" ? "Available" : "Booked");
    }

    if (updates.length === 0 && !hasKeepImages && uploadedFiles.length === 0) {
      return res.status(400).json({ message: "No property changes were provided" });
    }

    if (uploadedFiles.length) {
      const results = await Promise.allSettled(uploadedFiles.map(uploadPropertyImage));
      uploadedUrls = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      const failedUpload = results.find((result) => result.status === "rejected");
      if (failedUpload) {
        await Promise.allSettled(uploadedUrls.map(removeCloudinaryImage));
        return res.status(400).json({ message: `Image upload failed: ${failedUpload.reason.message}` });
      }
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [lockedRows] = await connection.execute(
      "SELECT id, admin_id FROM properties WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!lockedRows.length) {
      await connection.rollback();
      connection.release();
      connection = null;
      await Promise.allSettled(uploadedUrls.map(removeCloudinaryImage));
      return res.status(404).json({ message: "Property not found" });
    }
    if (role === "admin" && Number(lockedRows[0].admin_id) !== Number(adminId)) {
      await connection.rollback();
      connection.release();
      connection = null;
      await Promise.allSettled(uploadedUrls.map(removeCloudinaryImage));
      return res.status(403).json({ message: "Not authorized" });
    }

    const [lockedImages] = await connection.execute(
      "SELECT image_url FROM property_images WHERE property_id = ?",
      [id]
    );
    const lockedImageUrls = lockedImages.map((row) => row.image_url);
    const imagesChanged = lockedImageUrls.length !== currentImages.length
      || currentImages.some((url) => !lockedImageUrls.includes(url));
    if (imagesChanged || keepImages.some((url) => !lockedImageUrls.includes(url))) {
      await connection.rollback();
      connection.release();
      connection = null;
      await Promise.allSettled(uploadedUrls.map(removeCloudinaryImage));
      return res.status(409).json({ message: "Property images changed. Reload and try again." });
    }

    if (hasField("name")) {
      const [slugColumns] = await connection.execute(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'slug' LIMIT 1`
      );
      if (slugColumns.length) {
        updates.push("slug = ?");
        values.push(`${slugify(fieldValue("name"))}-${id}`);
      }
    }

    if (updates.length) {
      await connection.execute(
        `UPDATE properties SET ${updates.join(", ")} WHERE id = ?`,
        [...values, id]
      );
    }

    if (hasKeepImages || uploadedFiles.length) {
      await connection.execute("DELETE FROM property_images WHERE property_id = ?", [id]);
      const imageUrls = [...keepImages, ...uploadedUrls];
      if (imageUrls.length) {
        const placeholders = imageUrls.map(() => "(?, ?)").join(", ");
        const imageValues = imageUrls.flatMap((url) => [id, url]);
        await connection.execute(
          `INSERT INTO property_images (property_id, image_url) VALUES ${placeholders}`,
          imageValues
        );
      }
    }

    await connection.commit();
    connection.release();
    connection = null;

    if (hasKeepImages || uploadedFiles.length) {
      const removedImages = lockedImageUrls.filter((url) => !keepImages.includes(url));
      const cleanupResults = await Promise.allSettled(removedImages.map(removeCloudinaryImage));
      cleanupResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.warn("Could not remove replaced Cloudinary image:", removedImages[index], result.reason);
        }
      });
    }

    try {
      await cache.del("public:properties");
      await cache.del("public:properties:count");
    } catch (cacheError) {
      console.warn("Could not clear property cache after update:", cacheError);
    }

    return res.json({ message: "Property updated successfully", id: Number(id) });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Property update rollback failed:", rollbackError);
      }
      connection.release();
    }
    await Promise.allSettled(uploadedUrls.map(removeCloudinaryImage));

    if (error.message?.includes(" is invalid") || error.message?.includes("must be a non-empty string")) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Update property error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/* DELETE PROPERTY */
export const deleteProperty = async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;
  const role = req.user.role;

  try {
    const [images] = await db.execute(
      "SELECT image_url FROM property_images WHERE property_id = ?",
      [id]
    );

    for (const img of images || []) {
      try {
        const url = img.image_url || "";
        const uploadIdx = url.indexOf("/upload/");
        let publicId;

        if (uploadIdx !== -1) {
          publicId = url.substring(uploadIdx + "/upload/".length);
          publicId = publicId.replace(/^v\d+\//, "");
          publicId = publicId.replace(/\.[^/.]+$/, "");
        } else {
          publicId = img.image_url.split("/").slice(-2).join("/").split(".")[0];
        }

        await cloudinary.uploader.destroy(publicId);
      } catch (destroyErr) {
        console.warn("Cloudinary destroy failed for", img.image_url, destroyErr);
      }
    }

    // Remove any bookings that reference this property before deleting the property itself.
    // This prevents foreign-key failures from bookings.property_id.
    try {
      await db.execute("DELETE FROM bookings WHERE property_id = ?", [id]);
    } catch (bookingDeleteErr) {
      console.warn("Could not delete related bookings before property delete:", bookingDeleteErr);
      throw bookingDeleteErr;
    }

    let deleteSql = "DELETE FROM properties WHERE id = ?";
    const params = [id];
    if (role === "admin") {
      deleteSql += " AND admin_id = ?";
      params.push(adminId);
    }

    const [result] = await db.execute(deleteSql, params);
    if (result.affectedRows === 0) {
      return res.status(role === "admin" ? 403 : 404).json({ message: "Property not found or not allowed" });
    }

    try {
      await cache.del('public:properties');
    } catch (cacheErr) {
      console.warn('Could not clear public property cache after delete:', cacheErr);
    }

    return res.json({ message: "Property deleted successfully" });
  } catch (error) {
    console.error('Delete property error:', error);
    return res.status(500).json({
      message: "Delete failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
