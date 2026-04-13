import db from "../config/db.js";
import { createBooking, getBookingByReference, updateBookingPaymentStatus } from "../models/bookingModel.js";
import { createBookedDates } from "../models/bookedDatesModel.js";
import { getSubaccountByUserId, updateSubaccountRecipientCode } from "../models/subaccountModel.js";
import { updateTransactionStatus } from "../models/transactionModel.js";
import { calculateShortletPayment } from "./paymentCalculationService.js";
import { createTransferRecipient, createPaystackTransfer } from "./paystackService.js";

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
    `SELECT id, price, caution_fee, admin_id, admin_name, admin_email FROM properties WHERE id = ? LIMIT 1`,
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

export const buildPaystackMetadata = (booking_reference) => {
  return {
    booking_reference,
    booking_source: "shortlet",
  };
};

export const finalizeShortletBooking = async (transaction, paystackPayload = null) => {
  if (!transaction) {
    throw new Error("Transaction is required for booking finalization");
  }

  const snapshot = typeof transaction.booking_snapshot_json === "object"
    ? transaction.booking_snapshot_json
    : parseJson(transaction.booking_snapshot_json) || {};
  const metadata = (paystackPayload && paystackPayload.metadata) || (transaction.paystack_payload && transaction.paystack_payload.metadata) || {};
  const bookingReference = transaction.booking_reference || metadata.booking_reference || snapshot.booking_reference;

  if (!bookingReference) {
    throw new Error("Missing booking reference for finalized booking");
  }

  const existingBooking = await getBookingByReference(bookingReference);
  if (existingBooking) {
    if (existingBooking.payment_status !== "paid") {
      await updateBookingPaymentStatus(bookingReference, "paid");
    }

    return {
      booking_reference: bookingReference,
      booking_id: existingBooking.id,
      already_exists: true,
    };
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
  };

  const bookingResult = await createBooking(bookingPayload);
  const bookingId = bookingResult[0]?.insertId;
  if (!bookingId) {
    throw new Error("Failed to create booking record after payment verification");
  }

  await createBookedDates(property.id, bookingId, bookingData.check_in, bookingData.check_out);
  await updateBookingPaymentStatus(bookingReference, "paid");
  await updateTransactionStatus(transaction.reference, "success", paystackPayload || transaction.paystack_payload, bookingId);

  return {
    booking_reference: bookingReference,
    booking_id: bookingId,
    created: true,
    bookingData: bookingPayload,
  };
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
