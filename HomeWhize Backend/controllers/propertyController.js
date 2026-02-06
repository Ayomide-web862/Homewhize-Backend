import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

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

    const adminId = req.user.id;

    if (!req.files || req.files.length === 0) {
      console.log("FILES:", req.files);
      return res.status(400).json({
        message: "At least one image is required",
      });
    }


    /* UPLOAD IMAGES */
    const uploadPromises = req.files.map(file =>
      new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: "properties" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        ).end(file.buffer);
      })
    );

    const imageUrls = await Promise.all(uploadPromises);

    /* INSERT PROPERTY */
    const propertySql = `
      INSERT INTO properties
      (name, address, location, price, property_type, bedrooms, bathrooms, max_guests,
       status, description, latitude, longitude, admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
      propertySql,
      [
        name,
        address,
        location,
        Number(price),
        propertyType,
        Number(bedrooms),
        Number(bathrooms),
        Number(maxGuests),
        status,
        description,
        latitude || null,
        longitude || null,
        adminId
      ],
      (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ message: "Database error" });
        }

        const propertyId = result.insertId;

        /* INSERT IMAGES */
        const imageSql =
          "INSERT INTO property_images (property_id, image_url) VALUES ?";

        const imageValues = imageUrls.map(url => [propertyId, url]);

        db.query(imageSql, [imageValues], (imgErr) => {
          if (imgErr) {
            console.error(imgErr);
            return res.status(500).json({ message: "Image save failed" });
          }

          res.status(201).json({ message: "Property added successfully" });
        });
      }
    );
  } catch (error) {
    console.error("Add property error:", error);
    res.status(500).json({ message: "Server error" });
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
  const sql = `
    SELECT 
      p.id,
      p.name,
      p.address,
      p.location,
      p.price,
      p.max_guests,
      p.bedrooms,
      MIN(pi.image_url) AS image_url
    FROM properties p
    LEFT JOIN property_images pi ON p.id = pi.property_id
    WHERE p.status = 'Available'
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json([]);
    }
    res.json(results);
  });
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
      p.description,
      p.latitude,
      p.longitude,
      GROUP_CONCAT(pi.image_url) AS images
    FROM properties p
    LEFT JOIN property_images pi ON p.id = pi.property_id
    WHERE p.status = 'Available'
      AND LOWER(p.name) = LOWER(?)
    GROUP BY p.id
  `;

  db.query(sql, [name], (err, results) => {
    if (err) return res.status(500).json({ message: "Server error" });

    if (!results.length) {
      return res.status(404).json({ message: "Shortlet not found" });
    }

    const property = results[0];
    property.images = property.images ? property.images.split(",") : [];

    res.json(property);
  });
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
      for (const img of images) {
        const publicId = img.image_url
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];

        await cloudinary.uploader.destroy(publicId);
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
