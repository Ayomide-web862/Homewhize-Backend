import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import crypto from "crypto";
import http from "http";
import https from "https";
import { createSubaccountForUser } from "./paystackSubaccountController.js";
import { getSubaccountByUserId } from "../models/subaccountModel.js";

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
    const { fullName, email, phone, address, bankName, accountNumber } = req.body;
    const bankCode = req.body.bankCode || ""; // Make bankCode optional
    
    if (!fullName || !email || !phone || !address || !bankName || !accountNumber) {
      return res.status(400).json({ 
        message: "All fields (fullName, email, phone, address, bankName, accountNumber) are required" 
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
      (user_id, full_name, email, phone, address, bank_name, bank_code, account_number, id_document_url, ownership_document_url, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        req.user.id,
        fullName,
        email,
        phone,
        address,
        bankName,
        bankCode,
        accountNumber,
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
      "SELECT id, user_id, full_name, email, phone, address, bank_name, account_number, id_document_url, ownership_document_url, status, created_at, updated_at FROM kyc_requests ORDER BY created_at DESC"
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
      "SELECT id, user_id, full_name, email, bank_name, bank_code, account_number, status FROM kyc_requests WHERE id=?",
      [id]
    );

    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: "KYC request not found" });
    }

    // If approved, ensure subaccount creation once per user
    if (status === "Approved") {
      try {
        const userId = existing[0].user_id;
        const existingSub = await getSubaccountByUserId(userId);

        if (!existingSub) {
          const business_name = existing[0].full_name || "Untitled Business";
          const bank_code = existing[0].bank_code || null;
          const account_number = existing[0].account_number || null;

          if (!bank_code || !account_number) {
            throw new Error("Bank code and account number are required for subaccount onboarding");
          }

          await createSubaccountForUser({
            user_id: userId,
            business_name,
            bank_code,
            account_number,
            bank_name: existing[0].bank_name,
            email: existing[0].email,
            full_name: existing[0].full_name,
          });
        }
      } catch (subErr) {
        console.error("Subaccount creation error for user after KYC approval:", subErr);
        return res.status(500).json({ message: "Failed to onboard subaccount for approved KYC", error: subErr.message });
      }
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

/* DEBUG - View KYC record with document URLs */
export const debugGetKYC = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.execute(
      "SELECT id, user_id, full_name, email, phone, address, bank_name, account_number, id_document_url, ownership_document_url, status, created_at FROM kyc_requests WHERE id=?",
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "KYC request not found" });
    }

    res.json({
      message: "KYC Record",
      data: rows[0],
      debug: {
        id_doc_url_exists: !!rows[0].id_document_url,
        id_doc_url_length: rows[0].id_document_url?.length || 0,
        ownership_doc_url_exists: !!rows[0].ownership_document_url,
        ownership_doc_url_length: rows[0].ownership_document_url?.length || 0
      }
    });
  } catch (err) {
    console.error("Debug KYC error:", err);
    res.status(500).json({ message: "Failed to fetch KYC", error: err.message });
  }
};

/* DOWNLOAD DOCUMENT - Fetch from Cloudinary and serve with proper headers */

export const downloadDocument = async (req, res) => {
  try {
    const { id, docType } = req.params;

    if (!["id", "ownership"].includes(docType)) {
      return res.status(400).json({ message: "Invalid document type" });
    }

    const [rows] = await db.execute(
      "SELECT id_document_url, ownership_document_url FROM kyc_requests WHERE id=?",
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "KYC request not found" });
    }

    const docUrl =
      docType === "id"
        ? rows[0].id_document_url
        : rows[0].ownership_document_url;

    if (!docUrl) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Derive the public_id from the Cloudinary URL
    const urlObj = new URL(docUrl);
    const pathAfterUpload = urlObj.pathname.split("/upload/")[1] || "";
    const withoutVersion = pathAfterUpload.replace(/^v\d+\//, "");
    const publicId = withoutVersion.replace(/\.[^/.]+$/, "");

    // Build a signed/private download URL using Cloudinary SDK when possible
    let signedUrl;
    try {
      if (cloudinary.utils && typeof cloudinary.utils.private_download_url === "function") {
        signedUrl = cloudinary.utils.private_download_url(publicId, { resource_type: "auto", attachment: true });
      } else {
        // Fallback: sign manually
        const timestamp = Math.floor(Date.now() / 1000);
        const apiSecret = (process.env.CLOUDINARY_API_SECRET || cloudinary.config().api_secret || "").toString().trim();
        const apiKey = (process.env.CLOUDINARY_API_KEY || cloudinary.config().api_key || "").toString().trim();
        const cloudName = (process.env.CLOUDINARY_NAME || cloudinary.config().cloud_name || "").toString().trim();
        const stringToSign = `public_id=${publicId}&timestamp=${timestamp}`;
        const signature = crypto.createHash("sha1").update(stringToSign + apiSecret).digest("hex");
        signedUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/download?timestamp=${timestamp}&public_id=${encodeURIComponent(publicId)}&signature=${signature}&api_key=${apiKey}`;
      }
    } catch (e) {
      console.error("Failed to generate signed Cloudinary URL:", e);
    }

    if (!signedUrl) {
      return res.status(500).json({ message: "Failed to generate signed download URL" });
    }

    // Fetch the signed URL server-side and pipe to client to avoid CORS and XHR credential issues
    const signedUrlObj = new URL(signedUrl);
    const client = signedUrlObj.protocol === "https:" ? https : http;

    const signedReq = client.get(signedUrlObj, (signedRes) => {
      if (signedRes.statusCode && signedRes.statusCode >= 400) {
        console.error("Signed URL fetch failed with status", signedRes.statusCode);
        return res.status(502).json({ message: "Failed to fetch signed file from Cloudinary" });
      }

      const contentType = signedRes.headers["content-type"] || "application/octet-stream";
      const remoteDisposition = signedRes.headers["content-disposition"];
      res.setHeader("Content-Type", contentType);
      if (remoteDisposition) res.setHeader("Content-Disposition", remoteDisposition);
      else res.setHeader("Content-Disposition", `attachment; filename="${docType}-document"`);

      signedRes.pipe(res);
    });

    signedReq.on("error", (err) => {
      console.error("Error fetching signed URL:", err);
      if (!res.headersSent) res.status(500).json({ message: "Download failed" });
    });

    signedReq.setTimeout(60 * 1000, () => {
      signedReq.destroy(new Error("Timeout fetching signed remote file"));
    });
  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({ message: "Download failed" });
  }
};

/* GENERATE SIGNED URL (for frontend to open directly) */
export const getSignedDocumentUrl = async (req, res) => {
  try {
    const { id, docType } = req.params;
    if (!["id", "ownership"].includes(docType)) {
      return res.status(400).json({ message: "Invalid document type" });
    }

    const [rows] = await db.execute(
      "SELECT id_document_url, ownership_document_url FROM kyc_requests WHERE id=?",
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: "KYC request not found" });

    const docUrl = docType === "id" ? rows[0].id_document_url : rows[0].ownership_document_url;
    if (!docUrl) return res.status(404).json({ message: "Document not found" });

    const urlObj = new URL(docUrl);
    const pathAfterUpload = urlObj.pathname.split("/upload/")[1] || "";
    const withoutVersion = pathAfterUpload.replace(/^v\d+\//, "");
    const publicId = withoutVersion.replace(/\.[^/.]+$/, "");

    let signedUrl;
    try {
      if (cloudinary.utils && typeof cloudinary.utils.private_download_url === "function") {
        signedUrl = cloudinary.utils.private_download_url(publicId, { resource_type: "auto" });
      } else {
        signedUrl = cloudinary.url(publicId, { resource_type: "auto", sign_url: true, secure: true });
      }
    } catch (e) {
      console.error("Signed URL generation failed:", e);
      return res.status(500).json({ message: "Failed to generate signed URL" });
    }

    if (!signedUrl) return res.status(500).json({ message: "Failed to generate signed URL" });

    res.json({ url: signedUrl });
  } catch (err) {
    console.error("Get signed URL error:", err);
    res.status(500).json({ message: "Failed to get signed URL" });
  }
};

// Debug endpoint: return public_id, stringToSign, computed signature and URL
export const getSignedDocumentDebug = async (req, res) => {
  try {
    const { id, docType } = req.params;
    if (!["id", "ownership"].includes(docType)) {
      return res.status(400).json({ message: "Invalid document type" });
    }

    const [rows] = await db.execute(
      "SELECT id_document_url, ownership_document_url FROM kyc_requests WHERE id=?",
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: "KYC request not found" });

    const docUrl = docType === "id" ? rows[0].id_document_url : rows[0].ownership_document_url;
    if (!docUrl) return res.status(404).json({ message: "Document not found" });

    const urlObj = new URL(docUrl);
    const pathAfterUpload = urlObj.pathname.split("/upload/")[1] || "";
    const withoutVersion = pathAfterUpload.replace(/^v\d+\//, "");
    const publicId = withoutVersion.replace(/\.[^/.]+$/, "");

    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = `public_id=${publicId}&timestamp=${timestamp}`;
    const apiSecret = (process.env.CLOUDINARY_API_SECRET || cloudinary.config().api_secret || "").toString().trim();
    const apiKey = (process.env.CLOUDINARY_API_KEY || cloudinary.config().api_key || "").toString().trim();
    const cloudName = (process.env.CLOUDINARY_NAME || cloudinary.config().cloud_name || "").toString().trim();

    if (!apiSecret || !apiKey || !cloudName) {
      return res.status(500).json({ message: "Cloudinary credentials missing on server" });
    }

    // Prefer Cloudinary SDK signing helper to ensure compatibility
    let signature;
    try {
      if (cloudinary.utils && typeof cloudinary.utils.api_sign_request === "function") {
        signature = cloudinary.utils.api_sign_request({ public_id: publicId, timestamp }, apiSecret);
      } else {
        signature = crypto.createHash("sha1").update(stringToSign + apiSecret).digest("hex");
      }
    } catch (e) {
      console.error("Error computing signature:", e);
      signature = crypto.createHash("sha1").update(stringToSign + apiSecret).digest("hex");
    }

    const signedUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/download?timestamp=${timestamp}&public_id=${encodeURIComponent(publicId)}&signature=${signature}&api_key=${apiKey}`;

    return res.json({ publicId, stringToSign, signature, signedUrl });
  } catch (err) {
    console.error("Signed debug error:", err);
    res.status(500).json({ message: "Failed to generate signed debug info", error: err.message });
  }
};

