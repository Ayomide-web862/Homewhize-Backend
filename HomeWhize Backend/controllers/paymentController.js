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

    const booking_reference = `HOMEWHIZE-${crypto
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
          const result = await finalizeShortletBooking({
            transaction: tx,
            paystack_data: data.data
          });
          bookingReference = result.booking_reference || bookingReference;
          bookingCreated = result.created || false;
          bookingAlreadyExists = result.already_exists || false;
          bookingType = "shortlet";
          
          // Get property information for redirect
          if (result.bookingData && result.bookingData.property_id) {
            const [propertyRows] = await db.execute(
              'SELECT slug FROM properties WHERE id = ? LIMIT 1',
              [result.bookingData.property_id]
            );
            if (propertyRows && propertyRows.length > 0) {
              var propertySlug = propertyRows[0].slug;
            }
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
      property_slug: propertySlug || null,
    });
  } catch (error) {
    console.error("verifyPayment error:", error);
    res.status(500).json({ message: "Verification failed" });
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

// Paystack callback handler (user redirect after payment)
export const paymentCallback = async (req, res) => {
  try {
    const { reference, trxref } = req.query;

    if (!reference) {
      console.error('[CALLBACK] Missing reference in callback');
      return res.status(400).send('Missing payment reference');
    }

    // Get transaction details
    const transaction = await getTransactionByReference(reference);
    if (!transaction) {
      console.error(`[CALLBACK] Transaction not found: ${reference}`);
      return res.status(404).send('Transaction not found');
    }

    // Check if payment was successful by verifying with Paystack
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      console.error('[CALLBACK] Paystack secret not configured');
      return res.status(500).send('Server configuration error');
    }

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
      },
    });

    const verifyData = await verifyResponse.json();

    if (!verifyData.status || verifyData.data.status !== 'success') {
      console.error(`[CALLBACK] Payment verification failed for ${reference}:`, verifyData);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/failed?reference=${reference}&error=verification_failed`);
    }

    // Update transaction status if not already updated by webhook
    if (transaction.status !== 'success') {
      await updateTransactionStatus(reference, 'success');

      // Finalize booking if this is a booking payment
      if (transaction.booking_reference) {
        try {
          const bookingResult = await finalizeShortletBooking({
            transaction: transaction,
            paystack_data: verifyData.data
          });

          if (bookingResult.success !== false) {
            console.log(`[CALLBACK] Booking finalized via callback: ${transaction.booking_reference}`);
          } else {
            console.error(`[CALLBACK] Failed to finalize booking via callback: ${bookingResult.error}`);
          }
        } catch (bookingError) {
          console.error(`[CALLBACK] Booking finalization error:`, bookingError);
          // Continue with success redirect - booking will be handled by webhook if it arrives
        }
      }
    }

    // Redirect to success page
    const successUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/verify?reference=${reference}`;
    console.log(`[CALLBACK] Redirecting to success: ${successUrl}`);
    return res.redirect(successUrl);

  } catch (error) {
    console.error('[CALLBACK] Unexpected error:', error);
    return res.status(500).send('Server error');
  }
};

// Paystack webhook handler for payment verification
export const paystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      console.error('[WEBHOOK] Paystack secret not configured');
      return res.status(500).json({ message: 'Server configuration error' });
    }

    // Get the raw body and signature from Paystack
    const rawBody = req.body;
    const signature = req.headers['x-paystack-signature'];

    if (!signature) {
      console.error('[WEBHOOK] Missing Paystack signature');
      return res.status(400).json({ message: 'Missing signature' });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(rawBody))
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('[WEBHOOK] Invalid signature');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const event = rawBody.event;
    const data = rawBody.data;

    console.log(`[WEBHOOK] Received event: ${event}`, { reference: data?.reference });

    // Only process successful payment events
    if (event === 'charge.success') {
      const reference = data.reference;

      if (!reference) {
        console.error('[WEBHOOK] No reference in charge.success event');
        return res.status(400).json({ message: 'Missing reference' });
      }

      try {
        // Get transaction details
        const transaction = await getTransactionByReference(reference);
        if (!transaction) {
          console.error(`[WEBHOOK] Transaction not found for reference: ${reference}`);
          return res.status(404).json({ message: 'Transaction not found' });
        }

        // Check if already processed
        if (transaction.status === 'success') {
          console.log(`[WEBHOOK] Transaction ${reference} already processed`);
          return res.status(200).json({ message: 'Already processed' });
        }

        // Update transaction status
        await updateTransactionStatus(reference, 'success');

        // If this is a booking payment, finalize the booking
        if (transaction.booking_reference) {
          console.log(`[WEBHOOK] Finalizing booking for reference: ${reference}`);

          // Get booking details from transaction metadata or reference
          const bookingResult = await finalizeShortletBooking({
            transaction: transaction,
            paystack_data: data
          });

          if (bookingResult.success !== false) { // Allow undefined success as success
            console.log(`[WEBHOOK] Booking finalized successfully: ${transaction.booking_reference}`);
          } else {
            console.error(`[WEBHOOK] Failed to finalize booking: ${bookingResult.error}`);
            // Don't return error here - transaction is successful, booking finalization failed
            // This should trigger manual intervention
          }
        }

        console.log(`[WEBHOOK] Payment processed successfully: ${reference}`);
        return res.status(200).json({ message: 'Payment processed' });

      } catch (processingError) {
        console.error(`[WEBHOOK] Error processing payment ${reference}:`, processingError);
        return res.status(500).json({ message: 'Processing error' });
      }
    }

    // Acknowledge other events but don't process them
    console.log(`[WEBHOOK] Unhandled event: ${event}`);
    return res.status(200).json({ message: 'Event acknowledged' });

  } catch (error) {
    console.error('[WEBHOOK] Unexpected error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
