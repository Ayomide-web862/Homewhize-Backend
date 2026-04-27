import { sendEmailSafely, getDefaultFrom } from "../config/emailConfig.js";
import db from "../config/db.js";
import crypto from "crypto";
import { createBooking, getBookingByReference, updateBookingPaymentStatus } from "../models/bookingModel.js";
import { createBookedDates } from "../models/bookedDatesModel.js";
import { getSubaccountByUserId, updateSubaccountRecipientCode } from "../models/subaccountModel.js";
import { updateTransactionStatus } from "../models/transactionModel.js";
import { calculateShortletPayment } from "./paymentCalculationService.js";
import { createTransferRecipient, createPaystackTransfer } from "./paystackService.js";
import { sendBookingConfirmationEmail } from "../utils/emailService.js";

const parseJson = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
};

export const fetchPropertyById = async (property_id) => {
  const [rows] = await db.execute(
    `SELECT id, price, caution_fee, admin_id, admin_name, admin_email, slug FROM properties WHERE id = ? LIMIT 1`,
    [property_id]
  );
  return rows && rows.length > 0 ? rows[0] : null;
};

export const buildBookingSnapshotFromRequest = async ({ property_id, user_id, full_name, email, phone, check_in, check_out, guests, booking_reference }) => {
  const property = await fetchPropertyById(property_id);
  if (!property) {
    throw new Error("Property not found");
  }

  const checkIn = new Date(check_in);
  const checkOut = new Date(check_out);
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
    throw new Error("Invalid check-in/check-out dates");
  }

  const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
  const paymentSummary = calculateShortletPayment({
    price_per_night: Number(property.price) || 0,
    nights,
    caution_fee: Number(property.caution_fee) || 0,
  });

  return {
    property_id: property.id,
    property_slug: property.slug,
    user_id,
    owner_user_id: property.admin_id || null,
    full_name,
    email,
    phone,
    check_in,
    check_out,
    nights,
    guests: Number(guests) || 1,
    price_per_night: Number(property.price) || 0,
    caution_fee: Number(property.caution_fee) || 0,
    total_amount: paymentSummary.gross_paid,
    booking_reference,
    payment_breakdown_json: {
      base_rent: paymentSummary.base_rent,
      platform_fee_percentage: paymentSummary.platform_fee_percentage,
      platform_fee_amount: paymentSummary.platform_fee_amount,
      owner_earnings_amount: paymentSummary.owner_earnings_amount,
      caution_fee: paymentSummary.caution_fee,
      gross_paid: paymentSummary.gross_paid,
    },
  };
};

export const buildPaystackMetadata = (booking_reference, bookingSnapshot) => {
  return {
    booking_reference,
    booking_source: "shortlet",
    property_id: bookingSnapshot.property_id,
    property_slug: bookingSnapshot.property_slug,
  };
};

export const finalizeShortletBooking = async (params) => {
  // Support both webhook and direct call formats
  const transaction = params.transaction || params;
  const paystackData = params.paystack_data || params.paystackPayload;

  if (!transaction) {
    throw new Error("Transaction is required for booking finalization");
  }

  const snapshot = typeof transaction.booking_snapshot_json === "object"
    ? transaction.booking_snapshot_json
    : parseJson(transaction.booking_snapshot_json) || {};
  const metadata = (paystackData && paystackData.metadata) || (transaction.paystack_payload && transaction.paystack_payload.metadata) || {};
  const bookingReference = transaction.booking_reference || metadata.booking_reference || snapshot.booking_reference;

  if (!bookingReference) {
    throw new Error("Missing booking reference for finalized booking");
  }

  // Start transaction for atomic booking creation
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    // Lock and check transaction status
    const [txRows] = await connection.execute(
      'SELECT * FROM transactions WHERE reference = ? FOR UPDATE',
      [transaction.reference]
    );

    if (txRows.length === 0) {
      throw new Error(`Transaction ${transaction.reference} not found`);
    }

    const tx = txRows[0];

    // Check if already finalized
    if (tx.status === 'success' && tx.booking_id) {
      await connection.commit();
      console.log(`Booking ${bookingReference} already finalized (idempotent)`);
      return {
        success: true,
        booking_reference: bookingReference,
        booking_id: tx.booking_id,
        already_exists: true,
      };
    }

    // Verify Paystack amount matches expected amount
    if (paystackData && paystackData.amount) {
      const expectedAmount = Math.round(Number(snapshot.total_amount || 0) * 100); // Convert to kobo
      const actualAmount = Number(paystackData.amount);
      if (expectedAmount !== actualAmount) {
        throw new Error(`Amount mismatch: expected ${expectedAmount} kobo, got ${actualAmount} kobo`);
      }
    }

    // Check for existing booking with same reference
    const [existingBookingRows] = await connection.execute(
      'SELECT id, payment_status FROM bookings WHERE booking_reference = ?',
      [bookingReference]
    );

    if (existingBookingRows.length > 0) {
      const existingBooking = existingBookingRows[0];
      if (existingBooking.payment_status !== "paid") {
        await connection.execute(
          'UPDATE bookings SET payment_status = ? WHERE id = ?',
          ["paid", existingBooking.id]
        );
      }
      await connection.execute(
        'UPDATE transactions SET status = ?, booking_id = ? WHERE reference = ?',
        ['success', existingBooking.id, transaction.reference]
      );
      await connection.commit();
      console.log(`Booking ${bookingReference} already exists, updated status (idempotent)`);
      return {
        success: true,
        booking_reference: bookingReference,
        booking_id: existingBooking.id,
        already_exists: true,
      };
    }

    // Re-check availability at finalization time
    if (!snapshot.property_id || !snapshot.check_in || !snapshot.check_out) {
      throw new Error("Incomplete booking snapshot for availability check");
    }

    const [availabilityCheck] = await connection.execute(`
      SELECT COUNT(*) as conflicting_bookings FROM booked_dates bd
      INNER JOIN bookings b ON bd.booking_id = b.id
      WHERE bd.property_id = ?
      AND bd.booked_date >= ?
      AND bd.booked_date < ?
      AND b.payment_status = 'paid'
      AND b.id != ?
    `, [
      snapshot.property_id,
      snapshot.check_in,
      snapshot.check_out,
      transaction.booking_id || 0
    ]);

    if (availabilityCheck[0].conflicting_bookings > 0) {
      // Mark transaction for manual review instead of failing
      await connection.execute(
        'UPDATE transactions SET status = ?, notes = ? WHERE reference = ?',
        ['requires_review', 'Dates no longer available after payment', transaction.reference]
      );
      await connection.commit();
      console.warn(`Booking ${bookingReference} dates no longer available, marked for review`);
      throw new Error("Booking dates are no longer available. Transaction marked for manual review.");
    }

    const bookingData = snapshot || {};
    if (!bookingData.property_id || !bookingData.user_id) {
      throw new Error("Incomplete booking snapshot for finalization");
    }

    // Ensure the final amount is authoritative from the booking snapshot and property data
    const property = await fetchPropertyById(bookingData.property_id);
    if (!property) {
      throw new Error("Property referenced in booking snapshot no longer exists");
    }

    const paymentSummary = calculateShortletPayment({
      price_per_night: Number(property.price) || 0,
      nights: Number(bookingData.nights) || 0,
      caution_fee: Number(property.caution_fee) || 0,
    });

    // Generate unique access code for booking verification
    const accessCode = `HWZ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const bookingPayload = {
      property_id: property.id,
      user_id: bookingData.user_id,
      owner_user_id: property.admin_id || null,
      full_name: bookingData.full_name,
      email: bookingData.email,
      phone: bookingData.phone,
      check_in: bookingData.check_in,
      check_out: bookingData.check_out,
      nights: bookingData.nights,
      guests: Number(bookingData.guests) || 1,
      price_per_night: Number(property.price) || 0,
      total_amount: paymentSummary.gross_paid,
      booking_reference: bookingReference,
      caution_fee: paymentSummary.caution_fee,
      platform_fee_amount: paymentSummary.platform_fee_amount,
      owner_earnings_amount: paymentSummary.owner_earnings_amount,
      owner_payout_amount: paymentSummary.owner_earnings_amount,
      payment_breakdown_json: {
        base_rent: paymentSummary.base_rent,
        platform_fee_percentage: paymentSummary.platform_fee_percentage,
        platform_fee_amount: paymentSummary.platform_fee_amount,
        owner_earnings_amount: paymentSummary.owner_earnings_amount,
        caution_fee: paymentSummary.caution_fee,
        gross_paid: paymentSummary.gross_paid,
        paystack_reference: transaction.reference,
      },
      caution_fee_status: "held",
      owner_payout_status: "pending",
      stay_outcome: "pending",
      access_code: accessCode,
    };

    // Create booking
    const [bookingResult] = await connection.execute(
      `INSERT INTO bookings (
        property_id, user_id, owner_user_id, full_name, email, phone,
        check_in, check_out, nights, guests, price_per_night, total_amount,
        booking_reference, caution_fee, platform_fee_amount, owner_earnings_amount,
        owner_payout_amount, payment_breakdown_json, caution_fee_status,
        owner_payout_status, stay_outcome, access_code, payment_status,
        dispute_status, payout_review_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        bookingPayload.property_id,
        bookingPayload.user_id,
        bookingPayload.owner_user_id,
        bookingPayload.full_name,
        bookingPayload.email,
        bookingPayload.phone,
        bookingPayload.check_in,
        bookingPayload.check_out,
        bookingPayload.nights,
        bookingPayload.guests,
        bookingPayload.price_per_night,
        bookingPayload.total_amount,
        bookingPayload.booking_reference,
        bookingPayload.caution_fee,
        bookingPayload.platform_fee_amount,
        bookingPayload.owner_earnings_amount,
        bookingPayload.owner_payout_amount,
        JSON.stringify(bookingPayload.payment_breakdown_json),
        bookingPayload.caution_fee_status,
        bookingPayload.owner_payout_status,
        bookingPayload.stay_outcome,
        bookingPayload.access_code,
        "paid",
        "none",
        "awaiting_review"
      ]
    );

    const bookingId = bookingResult.insertId;
    if (!bookingId) {
      throw new Error("Failed to create booking record after payment verification");
    }

// Create booked dates (bulk insert with parameterized query)
    const checkIn = new Date(bookingData.check_in);
    const checkOut = new Date(bookingData.check_out);
    const dates = [];
    for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    if (dates.length > 0) {
      // Use parameterized bulk insert
      const placeholders = dates.map(() => '(?, ?, ?)').join(', ');
      const values = [];
      dates.forEach(date => {
        values.push(property.id, bookingId, date);
      });

      const bulkInsertQuery = `
        INSERT INTO booked_dates (property_id, booking_id, booked_date)
        VALUES ${placeholders}
      `;
      await connection.execute(bulkInsertQuery, values);
    }

    // Update transaction
    await connection.execute(
      'UPDATE transactions SET status = ?, booking_id = ? WHERE reference = ?',
      ['success', bookingId, transaction.reference]
    );

    await connection.commit();

    console.log(`Booking ${bookingReference} finalized successfully with ID ${bookingId}`);

    // Send booking confirmation email asynchronously (don't block on email)
    try {
      await sendBookingConfirmationEmail(bookingPayload);
      console.log(`Booking confirmation email sent for ${bookingReference}`);
    } catch (emailError) {
      console.error(`Failed to send booking confirmation email for ${bookingReference}:`, emailError);
      // Don't fail the booking if email fails - log and continue
    }

    return {
      success: true,
      booking_reference: bookingReference,
      booking_id: bookingId,
      created: true,
      bookingData: bookingPayload,
    };

  } catch (error) {
    await connection.rollback();
    console.error("finalizeShortletBooking transaction failed:", error);
    return {
      success: false,
      error: error.message,
      booking_reference: bookingReference,
    };
  } finally {
    connection.release();
  }
};

export const getTransferRecipientCodeForUser = async (user_id) => {
  const subaccount = await getSubaccountByUserId(user_id);
  if (!subaccount) {
    throw new Error("Provider subaccount not found for user");
  }

  if (subaccount.transfer_recipient_code) {
    return subaccount.transfer_recipient_code;
  }

  if (!subaccount.bank_code || !subaccount.account_number) {
    throw new Error("Bank details are missing for transfer recipient creation");
  }

  const recipientCode = await createTransferRecipient({
    name: subaccount.bank_name || `Provider ${user_id}`,
    account_number: subaccount.account_number,
    bank_code: subaccount.bank_code,
    email: null,
  });

  await updateSubaccountRecipientCode(user_id, recipientCode);
  return recipientCode;
};

export const settleBookingOwnerPayout = async ({ booking, recipientCode, reference }) => {
  if (!booking || !recipientCode) {
    throw new Error("Booking and recipient code are required for owner payout settlement");
  }

  const amount = Number(booking.owner_payout_amount || 0);
  if (amount <= 0) {
    throw new Error("No owner payout amount specified");
  }

  const transfer = await createPaystackTransfer({
    amount,
    recipient: recipientCode,
    reason: `Owner payout for booking ${booking.booking_reference}`,
    reference,
  });

  return transfer;
};
