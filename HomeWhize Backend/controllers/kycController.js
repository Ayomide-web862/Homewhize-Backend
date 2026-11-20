import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
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

const getKycDocument = async (req, res, attachment) => {
  const { id, docType } = req.params;
  if (!/^\d+$/.test(String(id))) {
    return res.status(400).json({ message: "Invalid KYC request ID" });
  }
  if (!["id", "ownership"].includes(docType)) {
    return res.status(400).json({ message: "Invalid document type" });
  }

  const [rows] = await db.execute(
    "SELECT user_id, id_document_url, ownership_document_url FROM kyc_requests WHERE id = ?",
    [id]
  );
  if (!rows.length) return res.status(404).json({ message: "KYC request not found" });

  const record = rows[0];
  if (!["superadmin", "master"].includes(req.user.role) && Number(record.user_id) !== Number(req.user.id)) {
    return res.status(403).json({ message: "Not authorized to access this document" });
  }

  const documentUrl = docType === "id" ? record.id_document_url : record.ownership_document_url;
  if (!documentUrl) return res.status(404).json({ message: "Document not found" });

  let url;
  try {
    url = new URL(documentUrl);
  } catch {
    return res.status(502).json({ message: "Stored document URL is invalid" });
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") {
    return res.status(502).json({ message: "Stored document URL is not a trusted Cloudinary URL" });
  }

  const filename = decodeURIComponent(url.pathname.split("/").pop() || `${docType}-document`)
    .replace(/[\r\n"]/g, "_");
  const disposition = attachment ? "attachment" : "inline";

  return new Promise((resolve) => {
    const request = https.get(url, (remoteResponse) => {
      if (remoteResponse.statusCode !== 200) {
        remoteResponse.resume();
        if (!res.headersSent) {
          res.status(502).json({ message: "Cloudinary could not return the stored document" });
        }
        resolve();
        return;
      }

      res.status(200);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", remoteResponse.headers["content-type"] || "application/octet-stream");
      res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      remoteResponse.on("error", (error) => {
        console.error("Cloudinary document stream failed:", error);
        if (!res.headersSent) res.status(502).json({ message: "Document stream failed" });
        else res.destroy(error);
      });
      remoteResponse.pipe(res);
      remoteResponse.on("end", resolve);
    });

    request.setTimeout(60000, () => {
      request.destroy(new Error("Timed out while fetching KYC document from Cloudinary"));
    });
    request.on("error", (error) => {
      console.error("Cloudinary document request failed:", error);
      if (!res.headersSent) res.status(502).json({ message: "Could not retrieve document from Cloudinary" });
      else res.destroy(error);
      resolve();
    });
  });
};

export const downloadDocument = async (req, res) => {
  try {
    return await getKycDocument(req, res, true);
  } catch (error) {
    console.error("KYC document download error:", error);
    if (!res.headersSent) return res.status(500).json({ message: "Document download failed" });
    return res.destroy(error);
  }
};

export const viewDocument = async (req, res) => {
  try {
    return await getKycDocument(req, res, false);
  } catch (error) {
    console.error("KYC document preview error:", error);
    if (!res.headersSent) return res.status(500).json({ message: "Document preview failed" });
    return res.destroy(error);
  }
};

export const getSignedDocumentUrl = async (req, res) => {
  try {
    const { id, docType } = req.params;
    if (!/^\d+$/.test(String(id))) return res.status(400).json({ message: "Invalid KYC request ID" });
    if (!["id", "ownership"].includes(docType)) {
      return res.status(400).json({ message: "Invalid document type" });
    }

    const [rows] = await db.execute(
      "SELECT id_document_url, ownership_document_url FROM kyc_requests WHERE id = ?",
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: "KYC request not found" });

    const url = docType === "id" ? rows[0].id_document_url : rows[0].ownership_document_url;
    if (!url) return res.status(404).json({ message: "Document not found" });
    return res.json({ url });
  } catch (error) {
    console.error("Get KYC document URL error:", error);
    return res.status(500).json({ message: "Failed to get document URL" });
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
