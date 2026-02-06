import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// Upload helper with better error handling
const uploadToCloudinary = async (file) => {
  if (!file) {
    throw new Error("File is missing");
  }
  
  try {
    const result = await cloudinary.uploader.upload(
      `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      { 
        folder: "kyc_documents",
        resource_type: "auto", // Auto-detect resource type (image, raw, etc.)
        type: "upload", // Ensure public upload, not private
        access_control: [{access_type: "token"}], // Allow public access with optional token
        quality: "auto"
      }
    );
    return result.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    throw new Error(`Failed to upload file: ${err.message}`);
  }
};

/* ADMIN SUBMIT KYC - WITH DUPLICATE CHECK */
export const submitKYC = async (req, res) => {
  try {
    // Validate required fields
    const { fullName, email, phone, address } = req.body;
    
    if (!fullName || !email || !phone || !address) {
      return res.status(400).json({ 
        message: "All fields (fullName, email, phone, address) are required" 
      });
    }

    // Validate files
    if (!req.files?.idDocument?.[0]) {
      return res.status(400).json({ message: "ID Document is required" });
    }
    if (!req.files?.ownershipDocument?.[0]) {
      return res.status(400).json({ message: "Ownership Document is required" });
    }

    // Check for duplicate submission (user can only have one pending/approved KYC)
    const [existing] = await db.execute(
      "SELECT id, status FROM kyc_requests WHERE user_id = ? AND status IN (?, ?)",
      [req.user.id, "Pending", "Approved"]
    );

    if (existing && existing.length > 0) {
      return res.status(409).json({ 
        message: `KYC already submitted with status: ${existing[0].status}. Please wait for approval.` 
      });
    }

    // Upload to Cloudinary
    const idDocUrl = await uploadToCloudinary(req.files.idDocument[0]);
    const ownershipDocUrl = await uploadToCloudinary(req.files.ownershipDocument[0]);

    // Insert into database
    const [result] = await db.execute(
      `INSERT INTO kyc_requests 
      (user_id, full_name, email, phone, address, id_document_url, ownership_document_url, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        req.user.id,
        fullName,
        email,
        phone,
        address,
        idDocUrl,
        ownershipDocUrl,
        "Pending"
      ]
    );

    res.status(201).json({ 
      message: "KYC submitted successfully", 
      status: "Pending",
      id: result.insertId
    });
  } catch (err) {
    console.error("KYC submission error:", err);
    res.status(500).json({ message: err.message || "KYC submission failed" });
  }
};

/* ADMIN CHECK STATUS */
export const getMyKYCStatus = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, status, created_at, updated_at FROM kyc_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );

    if (rows && rows.length > 0) {
      return res.json(rows[0]);
    }
    
    res.json({ status: "Not Submitted" });
  } catch (err) {
    console.error("Get KYC status error:", err);
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        message: "Database table `kyc_requests` not found. Run the migration: Backend/migrations/001_kyc_schema.sql",
        code: err.code,
      });
    }

    res.status(500).json({ message: "Failed to fetch KYC status", error: err.message });
  }
};

/* SUPER ADMIN GET ALL */
export const getAllKYC = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, user_id, full_name, email, phone, address, id_document_url, ownership_document_url, status, created_at, updated_at FROM kyc_requests ORDER BY created_at DESC"
    );
    
    res.json(rows || []);
  } catch (err) {
    console.error("Get all KYC error:", err);
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        message: "Database table `kyc_requests` not found. Run the migration: Backend/migrations/001_kyc_schema.sql",
        code: err.code,
      });
    }

    res.status(500).json({ message: "Failed to fetch KYC requests", data: [], error: err.message });
  }
};

/* SUPER ADMIN UPDATE STATUS */
export const updateKYCStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    // Validate status
    const validStatuses = ["Pending", "Approved", "Rejected"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` 
      });
    }

    // Check if KYC exists
    const [existing] = await db.execute(
      "SELECT id, status FROM kyc_requests WHERE id=?",
      [id]
    );

    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: "KYC request not found" });
    }

    // Update status
    const [result] = await db.execute(
      "UPDATE kyc_requests SET status=?, updated_at=NOW() WHERE id=?",
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({ message: "Failed to update KYC status" });
    }

    res.json({ 
      message: `KYC status updated to ${status}`,
      id,
      status
    });
  } catch (err) {
    console.error("Update KYC status error:", err);
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        message: "Database table `kyc_requests` not found. Run the migration: Backend/migrations/001_kyc_schema.sql",
        code: err.code,
      });
    }

    res.status(500).json({ message: "Failed to update KYC status", error: err.message });
  }
};
