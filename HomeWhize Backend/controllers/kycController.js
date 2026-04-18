import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import crypto from "crypto";
import http from "http";
import https from "https";
import { createSubaccountForUser } from "./paystackSubaccountController.js";
import { getSubaccountByUserId, saveSubaccount } from "../models/subaccountModel.js";

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

const persistAccountNameIfExists = async (id, account_name) => {
  if (!account_name) return;

  try {
    await db.execute("UPDATE kyc_requests SET account_name = ? WHERE id = ?", [account_name, id]);
  } catch (err) {
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      console.warn("account_name column missing in kyc_requests; skipping persist of account name.");
      return;
    }
    throw err;
  }
};

const safeKycUpdate = async (sql, params) => {
  try {
    return await db.execute(sql, params);
  } catch (err) {
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      console.warn("Skipping KYC DB update due to missing optional field:", err.sql || sql, err.message);
      return null;
    }
    throw err;
  }
};

/* ADMIN SUBMIT KYC - WITH DUPLICATE CHECK */
export const submitKYC = async (req, res) => {
  try {
    // Validate required fields
    const { fullName, email, phone, address, bankName, bankCode, accountNumber } = req.body;

    if (!fullName || !email || !phone || !address || !bankName || !bankCode || !accountNumber) {
      return res.status(400).json({
        message: "All fields (fullName, email, phone, address, bankName, bankCode, accountNumber) are required"
      });
    }

    // Validate bank_code format (should be numeric)
    if (!/^\d+$/.test(bankCode)) {
      return res.status(400).json({ message: "Invalid bank code format" });
    }

    // Validate account_number format (should be 10 digits)
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ message: "Account number must be 10 digits" });
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
    const optionalColumns = ['account_name', 'provisioning_status', 'provisioning_error', 'provisioned_at'];
    const columnChecks = await Promise.all(
      optionalColumns.map((column) => db.execute(`SHOW COLUMNS FROM kyc_requests LIKE '${column}'`))
    );

    const selectedColumns = [
      'id',
      'user_id',
      'full_name',
      'email',
      'phone',
      'address',
      'bank_name',
      'bank_code',
      'account_number',
    ];

    columnChecks.forEach((result, index) => {
      const [rows] = result;
      if (rows && rows.length > 0) {
        selectedColumns.push(optionalColumns[index]);
      }
    });

    selectedColumns.push('id_document_url', 'ownership_document_url', 'status', 'created_at', 'updated_at');

    const [rows] = await db.execute(
      `SELECT ${selectedColumns.join(', ')} FROM kyc_requests ORDER BY created_at DESC`
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

    const kycRecord = existing[0];

    // If approving, perform provisioning automation
    if (status === "Approved") {
      try {
        const userId = kycRecord.user_id;

        // Validate required bank fields
        if (!kycRecord.bank_code || !kycRecord.account_number) {
          return res.status(400).json({
            message: "Cannot approve KYC: Bank code and account number are required"
          });
        }

        // Check if subaccount already exists
        const existingSub = await getSubaccountByUserId(userId);

        if (!existingSub) {
          // Resolve bank account with Paystack
          const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
          if (!paystackSecret) {
            throw new Error("Paystack secret key is not configured");
          }

          const resolveResponse = await fetch(
            `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(kycRecord.account_number)}&bank_code=${encodeURIComponent(kycRecord.bank_code)}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${paystackSecret}`,
                "Content-Type": "application/json",
              },
            }
          );

          const resolved = await resolveResponse.json();
          if (!resolved || !resolved.status || !resolved.data) {
            throw new Error("Invalid bank account details provided");
          }

          const account_name = resolved.data.account_name;
          if (!account_name) {
            throw new Error("Bank account verification failed - no account name returned");
          }

          // Update KYC record with resolved account name when the column exists
          await persistAccountNameIfExists(id, account_name);

          // Create Paystack subaccount
          const percentageCharge = Number(process.env.PAYSTACK_COMMISSION_PERCENTAGE || "10");
          const business_name = kycRecord.full_name || "Untitled Business";

          const subaccountPayload = {
            business_name,
            settlement_bank: kycRecord.bank_code,
            account_number: kycRecord.account_number,
            account_name,
            percentage_charge: Number.isFinite(percentageCharge) ? percentageCharge : 10,
            primary_contact: kycRecord.full_name || business_name,
            primary_contact_email: kycRecord.email || null,
          };

          const subaccountResp = await fetch("https://api.paystack.co/subaccount", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${paystackSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(subaccountPayload),
          });

          const subaccountData = await subaccountResp.json();
          if (!subaccountData || !subaccountData.status || !subaccountData.data || !subaccountData.data.subaccount_code) {
            console.error("Paystack subaccount creation failed", subaccountData);
            throw new Error("Failed to create Paystack subaccount");
          }

          const subaccount_code = subaccountData.data.subaccount_code;

          // Create transfer recipient
          const recipientPayload = {
            type: "nuban",
            name: business_name,
            account_number: kycRecord.account_number,
            bank_code: kycRecord.bank_code,
            currency: "NGN",
            email: kycRecord.email || undefined,
          };

          const recipientResp = await fetch("https://api.paystack.co/transferrecipient", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${paystackSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(recipientPayload),
          });

          const recipientData = await recipientResp.json();
          if (!recipientData || !recipientData.status || !recipientData.data || !recipientData.data.recipient_code) {
            console.error("Paystack transfer recipient creation failed", recipientData);
            throw new Error("Failed to create Paystack transfer recipient");
          }

          const transfer_recipient_code = recipientData.data.recipient_code;

          // Save subaccount to database
          await saveSubaccount(userId, subaccount_code, {
            bank_name: kycRecord.bank_name,
            bank_code: kycRecord.bank_code,
            account_number: kycRecord.account_number,
          }, transfer_recipient_code);

          // Update provisioning status
          await safeKycUpdate(
            "UPDATE kyc_requests SET provisioning_status = 'success', provisioned_at = NOW() WHERE id = ?",
            [id]
          );

        } else {
          // Subaccount already exists, just mark as provisioned if not already
          await safeKycUpdate(
            "UPDATE kyc_requests SET provisioning_status = 'success', provisioned_at = NOW() WHERE id = ? AND provisioning_status != 'success'",
            [id]
          );
        }
      } catch (provisioningErr) {
        console.error("KYC provisioning error for user:", kycRecord.user_id, provisioningErr);

        // Update provisioning status to failed
        await safeKycUpdate(
          "UPDATE kyc_requests SET provisioning_status = 'failed', provisioning_error = ? WHERE id = ?",
          [provisioningErr.message || "Provisioning failed", id]
        );

        return res.status(500).json({
          message: "KYC approved but provisioning failed",
          error: provisioningErr.message,
          details: "The KYC was approved but Paystack subaccount/recipient creation failed. Please check the provisioning_error field."
        });
      }
    }

    // Update KYC status
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
        
        // For private download URLs, include all parameters in signature
        const params = {
          public_id: publicId,
          timestamp: timestamp.toString(),
          api_key: apiKey
        };
        
        // Sort parameters alphabetically and create string to sign
        const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
        const signature = crypto.createHash("sha1").update(sortedParams + apiSecret).digest("hex");
        
        signedUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/download?${sortedParams}&signature=${signature}`;
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
        // Fallback: generate signed URL manually for consistency
        const timestamp = Math.floor(Date.now() / 1000);
        const apiSecret = (process.env.CLOUDINARY_API_SECRET || cloudinary.config().api_secret || "").toString().trim();
        const apiKey = (process.env.CLOUDINARY_API_KEY || cloudinary.config().api_key || "").toString().trim();
        const cloudName = (process.env.CLOUDINARY_NAME || cloudinary.config().cloud_name || "").toString().trim();
        
        // For signed URLs, include all parameters in signature
        const params = {
          public_id: publicId,
          timestamp: timestamp.toString(),
          api_key: apiKey
        };
        
        // Sort parameters alphabetically and create string to sign
        const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
        const signature = crypto.createHash("sha1").update(sortedParams + apiSecret).digest("hex");
        
        signedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${sortedParams}&signature=${signature}`;
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

/* GET PAYSTACK BANKS LIST - Protected endpoint for frontend dropdown */
export const getBanksList = async (req, res) => {
  try {
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ message: "Paystack not configured" });
    }

    const resp = await fetch("https://api.paystack.co/bank", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
    });

    const data = await resp.json();
    if (!data || !data.status) {
      console.error("Paystack banks list error:", data);
      return res.status(502).json({ message: "Failed to fetch banks list" });
    }

    // Return frontend-friendly format
    const banks = (data.data || []).map(bank => ({
      name: bank.name,
      code: bank.code
    }));

    res.json({ banks });
  } catch (error) {
    console.error("getBanksList error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

