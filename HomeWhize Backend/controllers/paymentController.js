import db from "../config/db.js";
import crypto from "crypto";
import { createTransaction, getTransactionByReference, updateTransactionStatus, listTransactions } from "../models/transactionModel.js";
import { updateBookingPaymentStatus } from "../models/bookingModel.js";

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

    if (tx) {
      await updateTransactionStatus(reference, "success", data.data);

      if (tx.booking_reference) {
        await updateBookingPaymentStatus(tx.booking_reference, "paid");
        // Invalidate public properties cache so availability reflects payment immediately
        try {
          if (global.__publicPropertiesCache) global.__publicPropertiesCache = {};
        } catch (e) {
          console.warn('Failed to invalidate public properties cache', e);
        }
      }
    }

    return res.json({
      verified: true,
      data: data.data,
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
      // Try to find local transaction to get booking_reference
      try {
        const tx = await getTransactionByReference(reference);
        if (tx && tx.booking_reference) {
          await updateBookingPaymentStatus(tx.booking_reference, 'paid');
          // Invalidate public properties cache so availability reflects payment immediately
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
