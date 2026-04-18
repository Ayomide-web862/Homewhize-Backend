import db from "../config/db.js";
import crypto from "crypto";
import { createTransaction, getTransactionByReference, updateTransactionStatus, listTransactions } from "../models/transactionModel.js";
import { createBooking, updateBookingPaymentStatus } from "../models/bookingModel.js";
import { updateServiceBookingPaymentStatus } from "../models/serviceBookingModel.js";
import { createBookedDates, isDateRangeAvailable } from "../models/bookedDatesModel.js";
import { sendBookingConfirmationEmail } from "../utils/emailService.js";
import {
  buildBookingSnapshotFromRequest,
  buildPaystackMetadata,
  finalizeShortletBooking,
} from "../services/bookingPaymentService.js";

// Initialize a Paystack transaction (server-side uses secret key)
export const initializePayment = async (req, res) => {
  try {
    const { email, amount, booking_reference, booking_id } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ message: "Email and amount are required" });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ message: "Paystack not configured" });
    }

    const callback_url =
      process.env.PAYSTACK_CALLBACK_URL ||
      `${req.protocol}://${req.get("host")}/api/payments/callback`;

    const payload = {
      email,
      amount: Math.round(Number(amount) * 100), // convert to kobo
      callback_url,
      metadata: {
        booking_reference,
        booking_id,
      },
    };

    const resp = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!data.status) {
      console.error("Paystack initialize error:", data);
      return res.status(502).json({
        message: "Failed to initialize payment",
      });
    }

    const reference = data.data.reference;

    await createTransaction({
      reference,
      booking_reference,
      booking_id,
      amount: Number(amount),
      currency: "NGN",
      customer_email: email,
      provider_id: null,
      paystack_payload: data.data,
    });

    return res.json({
      authorization_url: data.data.authorization_url,
      reference,
    });
  } catch (error) {
    console.error("initializePayment error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Initialize payment for booking (creates booking only on successful payment)
export const initializeBookingPayment = async (req, res) => {
  try {
    const {
      property_id,
      full_name,
      email,
      phone,
      check_in,
      check_out,
      guests,
    } = req.body;

    if (
      !property_id ||
      !full_name ||
      !email ||
      !phone ||
      !check_in ||
      !check_out
    ) {
      return res.status(400).json({ message: "Missing required booking fields" });
    }

    const checkIn = new Date(check_in);
    const checkOut = new Date(check_out);

    if (checkOut <= checkIn) {
      return res.status(400).json({ message: "Check-out must be after check-in" });
    }

    const isAvailable = await isDateRangeAvailable(property_id, check_in, check_out);
    if (!isAvailable) {
      return res.status(409).json({ message: 'Selected dates are already booked' });
    }

    const booking_reference = `PADUP-${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;

    let bookingSnapshot;
    try {
      bookingSnapshot = await buildBookingSnapshotFromRequest({
        property_id,
        user_id: req.user.id,
        full_name,
        email,
        phone,
        check_in,
        check_out,
        guests,
        booking_reference,
      });
    } catch (snapshotError) {
      if (snapshotError.message === "Property not found") {
        return res.status(404).json({ message: "Property not found" });
      }
      return res.status(400).json({ message: snapshotError.message || "Invalid booking details" });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ message: "Paystack not configured" });
    }

    const callback_url =
      process.env.PAYSTACK_CALLBACK_URL ||
      `${req.protocol}://${req.get("host")}/api/payments/callback`;

    const payload = {
      email,
      amount: Math.round(Number(bookingSnapshot.total_amount) * 100),
      callback_url,
      metadata: buildPaystackMetadata(booking_reference, bookingSnapshot),
    };

    const resp = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!data.status) {
      console.error("Paystack initialize error:", data);
      return res.status(502).json({
        message: "Failed to initialize payment",
      });
    }

    const reference = data.data.reference;

    await createTransaction({
      reference,
      booking_reference,
      booking_id: null,
      amount: bookingSnapshot.total_amount,
      currency: "NGN",
      customer_email: email,
      provider_id: bookingSnapshot.owner_user_id || null,
      paystack_payload: data.data,
      booking_snapshot_json: bookingSnapshot,
    });

    return res.json({
      authorization_url: data.data.authorization_url,
      reference,
      booking_reference,
    });
  } catch (error) {
    console.error("initializeBookingPayment error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify transaction by reference
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ message: "No reference provided" });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

    const resp = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
        },
      }
    );

    const data = await resp.json();

    if (!data.status || data.data.status !== "success") {
      return res.json({ verified: false });
    }

    const tx = await getTransactionByReference(reference);

    let bookingType = null;
    let bookingReference = null;
    let bookingCreated = false;
    let bookingAlreadyExists = false;

    if (tx) {
      bookingReference = tx.booking_reference;
      await updateTransactionStatus(reference, "success", data.data);

      const metadata = tx.paystack_payload && tx.paystack_payload.metadata ? tx.paystack_payload.metadata : null;
      const isShortletBooking = tx.booking_snapshot_json || (metadata && metadata.booking_source === "shortlet");

      if (isShortletBooking) {
        try {
          const result = await finalizeShortletBooking(tx, data.data);
          bookingReference = result.booking_reference || bookingReference;
          bookingCreated = result.created || false;
          bookingAlreadyExists = result.already_exists || false;
          bookingType = "shortlet";
          if (result.created && result.bookingData) {
            await sendBookingConfirmationEmail(result.bookingData);
          }
        } catch (finalizeError) {
          console.error("Shortlet booking finalization failed:", finalizeError);
        }
      } else if (metadata && metadata.booking_data) {
        const bookingData = metadata.booking_data;
        const bookingResult = await createBooking(bookingData);
        const bookingId = bookingResult[0].insertId;

        await createBookedDates(bookingData.property_id, bookingId, bookingData.check_in, bookingData.check_out);

        try {
          await sendBookingConfirmationEmail(bookingData);
        } catch (emailErr) {
          console.warn('Failed to send booking confirmation email:', emailErr);
        }
      } else if (metadata && metadata.booking_type === 'service') {
        bookingType = 'service';
        await updateServiceBookingPaymentStatus(tx.booking_reference, 'paid');
      } else if (tx.booking_reference) {
        await updateBookingPaymentStatus(tx.booking_reference, "paid");
      }

      try {
        if (global.__publicPropertiesCache) global.__publicPropertiesCache = {};
      } catch (e) {
        console.warn('Failed to invalidate public properties cache', e);
      }
    }

    return res.json({
      verified: true,
      data: data.data,
      booking_type: bookingType,
      booking_reference: bookingReference,
      booking_created: bookingCreated,
      booking_already_exists: bookingAlreadyExists,
    });
  } catch (error) {
    console.error("verifyPayment error:", error);
    res.status(500).json({ message: "Verification failed" });
  }
};

// Paystack callback redirect handler - sends user back to frontend verify page
export const paymentCallback = async (req, res) => {
  try {
    const reference = req.query.reference || req.query.tx_ref || req.query.trxref || req.query.transaction || null;
    const frontendUrl = (process.env.PAYSTACK_FRONTEND_REDIRECT || process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

    if (!reference) {
      return res.redirect(frontendUrl + "/payments/verify");
    }

    // Fetch transaction to get metadata for proper redirection
    const tx = await getTransactionByReference(reference);
    if (tx && tx.paystack_payload && tx.paystack_payload.metadata) {
      const metadata = tx.paystack_payload.metadata;
      if (metadata.booking_source === "shortlet" && metadata.property_slug) {
        // Redirect to specific shortlet page with success params
        return res.redirect(`${frontendUrl}/shortlets/${metadata.property_slug}?booking_success=1&booking_reference=${encodeURIComponent(metadata.booking_reference)}`);
      }
    }

    // Fallback to verify page
    return res.redirect(`${frontendUrl}/payments/verify?reference=${encodeURIComponent(reference)}`);
  } catch (err) {
    console.error('paymentCallback error:', err);
    return res.status(500).send('server error');
  }
};

// Raw body webhook handler for Paystack events
export const paystackWebhook = async (req, res) => {
  try {
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];

    // req.body is a Buffer when using express.raw middleware for this route
    const rawBody = req.body;
    if (!rawBody) return res.status(400).send('No body');

    const computed = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
    if (signature !== computed) {
      console.warn('Invalid Paystack webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = payload.event;
    const data = payload.data;

    const reference = data && data.reference;
    if (!reference) {
      console.warn('Webhook without reference');
      return res.status(400).send('no reference');
    }

    if (event === 'charge.success' || (data && data.status === 'success')) {
      await updateTransactionStatus(reference, 'success', data);
      try {
        const tx = await getTransactionByReference(reference);
        if (tx) {
          const metadata = tx.paystack_payload && tx.paystack_payload.metadata ? tx.paystack_payload.metadata : null;
          const isShortletBooking = tx.booking_snapshot_json || (metadata && metadata.booking_source === "shortlet");

          if (isShortletBooking) {
            try {
              await finalizeShortletBooking(tx, data);
            } catch (finalizeError) {
              console.error('Shortlet booking finalization failed from webhook:', finalizeError);
            }
          } else if (metadata && metadata.booking_data) {
            const bookingData = metadata.booking_data;
            const bookingResult = await createBooking(bookingData);
            const bookingId = bookingResult[0].insertId;

            await createBookedDates(bookingData.property_id, bookingId, bookingData.check_in, bookingData.check_out);

            try {
              await sendBookingConfirmationEmail(bookingData);
            } catch (emailErr) {
              console.warn('Failed to send booking confirmation email:', emailErr);
            }
          } else if (metadata && metadata.booking_type === 'service') {
            await updateServiceBookingPaymentStatus(tx.booking_reference, 'paid');
          } else if (tx.booking_reference) {
            await updateBookingPaymentStatus(tx.booking_reference, 'paid');
          }

          try {
            if (global.__publicPropertiesCache) global.__publicPropertiesCache = {};
          } catch (e) {
            console.warn('Failed to invalidate public properties cache', e);
          }
        }
      } catch (uerr) {
        console.warn('Failed to update booking status from webhook:', uerr);
      }
    } else if (event === 'charge.failed') {
      await updateTransactionStatus(reference, 'failed', data);
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('paystackWebhook error:', err);
    res.status(500).send('server error');
  }
};

export const listTransactionsHandler = async (req, res, next) => {
  try {
    const rows = await listTransactions();
    res.json({ transactions: rows });
  } catch (err) {
    next(err);
  }
};
