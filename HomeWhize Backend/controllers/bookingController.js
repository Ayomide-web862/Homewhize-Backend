import { createBooking, getBookingById, updateBookingSettlement } from "../models/bookingModel.js";
import db from "../config/db.js";
import crypto from "crypto";
import { getTransferRecipientCodeForUser, settleBookingOwnerPayout } from "../services/bookingPaymentService.js";
import { refundPaystackTransaction } from "../services/paystackService.js";

export const createNewBooking = async (req, res) => {
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

    const nights = Math.ceil(
      (checkOut - checkIn) / (1000 * 60 * 60 * 24)
    );

    const [propertyRows] = await db.execute(
      "SELECT price, caution_fee, admin_id FROM properties WHERE id = ? LIMIT 1",
      [property_id]
    );

    if (!propertyRows || propertyRows.length === 0) {
      return res.status(404).json({ message: "Property not found" });
    }

    const pricePerNight = Number(propertyRows[0].price) || 0;
    const cautionFee = Number(propertyRows[0].caution_fee) || 0;
    const ownerUserId = propertyRows[0].admin_id;

    // Prevent overlapping bookings
    const overlapSql = `
      SELECT COUNT(*) AS cnt FROM bookings b
      WHERE b.property_id = ?
        AND b.payment_status = 'paid'
        AND NOT (b.check_out <= ? OR b.check_in >= ?)
    `;
    const [overlapRows] = await db.execute(overlapSql, [property_id, checkIn.toISOString().slice(0,10), checkOut.toISOString().slice(0,10)]);
    const overlapCount = overlapRows && overlapRows[0] && overlapRows[0].cnt ? Number(overlapRows[0].cnt) : 0;
    if (overlapCount > 0) {
      return res.status(409).json({ message: 'Selected dates are already booked' });
    }

    const booking_reference = `PADUP-${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;

    await createBooking({
      property_id,
      user_id: req.user.id,
      owner_user_id: ownerUserId,
      full_name,
      email,
      phone,
      check_in,
      check_out,
      nights,
      guests: Number(guests) || 1,
      price_per_night: pricePerNight,
      booking_reference,
      caution_fee: cautionFee,
    });

    res.status(201).json({
      message: "Booking created successfully",
      booking_reference,
    });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ message: "Booking failed" });
  }
};

export const approveOwnerPayout = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking id is required" });
    }

    const { review_note } = req.body;

    const booking = await getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Only paid bookings can be processed" });
    }

    if (booking.owner_payout_status === "paid") {
      return res.status(200).json({ message: "Owner payout already completed", booking_id: bookingId });
    }

    // Check if stay has completed (checkout date has passed)
    const now = new Date();
    const checkOut = new Date(booking.check_out);
    if (checkOut > now) {
      return res.status(400).json({ message: "Cannot process payout before the stay has completed" });
    }

    const providerId = booking.owner_user_id;
    if (!providerId) {
      return res.status(400).json({ message: "Provider account not available for this booking" });
    }

    const recipientCode = await getTransferRecipientCodeForUser(providerId);
    const transferReference = `HPSETTLE-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const transferResult = await settleBookingOwnerPayout({
      booking,
      recipientCode,
      reference: transferReference,
    });

    await updateBookingSettlement(booking.id, {
      owner_payout_status: "paid",
      owner_transfer_reference: transferResult.reference || transferResult.transfer_code || null,
      payout_review_status: "completed",
      payout_reviewed_by: req.user.id,
      payout_reviewed_at: new Date(),
      payout_review_note: review_note || null,
      stay_outcome: "completed",
    });

    res.json({
      message: "Owner payout approved and completed successfully",
      booking_id: booking.id,
      transfer: transferResult,
    });
  } catch (error) {
    console.error("Owner payout approval error:", error);
    res.status(500).json({ message: error.message || "Failed to approve owner payout" });
  }
};

export const refundCautionFee = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking id is required" });
    }

    const { review_note } = req.body;

    const booking = await getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Only paid bookings can be processed" });
    }

    if (booking.caution_fee_status === "refunded") {
      return res.status(200).json({ message: "Caution fee already refunded", booking_id: bookingId });
    }

    if (Number(booking.caution_fee) <= 0) {
      return res.status(400).json({ message: "No caution fee to refund" });
    }

    // Get the original transaction reference from payment breakdown
    const paymentBreakdown = booking.payment_breakdown_json || {};
    const paystackReference = paymentBreakdown.paystack_reference;

    if (!paystackReference) {
      return res.status(400).json({ message: "Original transaction reference not found" });
    }

    // Process refund
    const refundResult = await refundPaystackTransaction({
      transaction_reference: paystackReference,
      amount: Number(booking.caution_fee) * 100, // Convert to kobo
    });

    await updateBookingSettlement(booking.id, {
      caution_fee_status: "refunded",
      caution_fee_refund_reference: refundResult.reference || refundResult.id || null,
      payout_review_status: "completed",
      payout_reviewed_by: req.user.id,
      payout_reviewed_at: new Date(),
      payout_review_note: review_note || null,
      stay_outcome: "completed",
    });

    res.json({
      message: "Caution fee refunded to guest successfully",
      booking_id: booking.id,
      refund: refundResult,
    });
  } catch (error) {
    console.error("Caution fee refund error:", error);
    res.status(500).json({ message: error.message || "Failed to refund caution fee" });
  }
};

export const releaseCautionFeeToOwner = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking id is required" });
    }

    const { review_note } = req.body;

    const booking = await getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Only paid bookings can be processed" });
    }

    if (booking.caution_fee_status === "forfeited_to_owner") {
      return res.status(200).json({ message: "Caution fee already released to owner", booking_id: bookingId });
    }

    if (Number(booking.caution_fee) <= 0) {
      return res.status(400).json({ message: "No caution fee to release" });
    }

    await updateBookingSettlement(booking.id, {
      caution_fee_status: "forfeited_to_owner",
      payout_review_status: "completed",
      payout_reviewed_by: req.user.id,
      payout_reviewed_at: new Date(),
      payout_review_note: review_note || null,
      stay_outcome: "completed",
    });

    res.json({
      message: "Caution fee released to owner successfully",
      booking_id: booking.id,
    });
  } catch (error) {
    console.error("Caution fee release error:", error);
    res.status(500).json({ message: error.message || "Failed to release caution fee to owner" });
  }
};

export const getBookingsForSettlement = async (req, res) => {
  try {
    const { status = "awaiting_review", limit = 50, offset = 0 } = req.query;

    // Sanitize inputs
    const sanitizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const sanitizedOffset = Math.max(Number(offset) || 0, 0);

    let whereClause = "b.payment_status = 'paid'";
    if (status === "awaiting_review") {
      whereClause += " AND b.check_out < NOW() AND b.payout_review_status = 'awaiting_review'";
    } else if (status === "disputes") {
      whereClause += " AND b.dispute_status = 'open'";
    } else if (status === "completed") {
      whereClause += " AND b.payout_review_status = 'completed'";
    }

    const sql = `
      SELECT
        b.id,
        b.property_id,
        b.user_id,
        b.booking_reference,
        b.full_name as guest_name,
        b.email,
        b.phone,
        b.check_in as check_in_date,
        b.check_out as check_out_date,
        b.nights,
        b.guests,
        b.price_per_night,
        b.total_amount,
        b.caution_fee,
        b.platform_fee_amount,
        b.owner_earnings_amount,
        b.owner_payout_amount,
        b.payment_status,
        b.caution_fee_status,
        b.owner_payout_status,
        b.stay_outcome,
        b.dispute_status,
        b.payout_review_status,
        b.payout_reviewed_by,
        b.payout_reviewed_at,
        b.payout_review_note,
        b.created_at,
        p.name as property_title,
        p.slug as property_slug,
        u.name as owner_name
      FROM bookings b
      LEFT JOIN properties p ON b.property_id = p.id
      LEFT JOIN users u ON p.admin_id = u.id
      WHERE ${whereClause}
      ORDER BY b.check_out DESC
      LIMIT ${sanitizedLimit} OFFSET ${sanitizedOffset}
    `;

    const [bookings] = await db.execute(sql);

    res.json({
      bookings: bookings || [],
      pagination: {
        limit: sanitizedLimit,
        offset: sanitizedOffset,
      },
    });
  } catch (error) {
    console.error("Get bookings for settlement error:", error);
    res.status(500).json({ message: "Failed to fetch bookings for settlement" });
  }
};

export const cancelBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking id is required" });
    }

    const booking = await getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Check if booking can be cancelled
    if (booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Only paid bookings can be cancelled" });
    }

    if (booking.stay_outcome === "completed" || booking.stay_outcome === "cancelled") {
      return res.status(400).json({ message: "Booking is already completed or cancelled" });
    }

    // Check if check-in date has passed
    const now = new Date();
    const checkIn = new Date(booking.check_in);
    if (checkIn <= now) {
      return res.status(400).json({ message: "Cannot cancel booking after check-in time" });
    }

    await updateBookingSettlement(booking.id, {
      stay_outcome: "cancelled",
      payout_review_status: "completed",
      payout_reviewed_by: req.user.id,
      payout_reviewed_at: new Date(),
      cancelled_at: new Date(),
      cancelled_by: req.user.id,
    });

    res.json({
      message: "Booking cancelled successfully",
      booking_id: booking.id,
    });
  } catch (error) {
    console.error("Cancel booking error:", error);
    res.status(500).json({ message: error.message || "Failed to cancel booking" });
  }
};

export const getAllBookings = async (req, res) => {
  try {
    const status = req.query.status || "paid";
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const offset = Number(req.query.offset) || 0;
    const user = req.user;

    console.log("Fetching bookings with:", { status, limit, offset, userRole: user.role });

    let whereClause = "";
    if (status && status !== "all") {
      whereClause = `WHERE b.payment_status = '${status}'`;
    }

    // Add ownership filter for admin users - they can only see bookings for their own properties
    if (user.role === "admin") {
      const ownershipCondition = whereClause ? " AND p.admin_id = ?" : " WHERE p.admin_id = ?";
      whereClause += ownershipCondition;
    }

    const bookingSql = `
      SELECT 
        b.id,
        b.property_id,
        b.user_id,
        b.booking_reference,
        b.full_name,
        b.email,
        b.phone,
        b.check_in,
        b.check_out,
        b.nights,
        b.guests,
        b.price_per_night,
        b.total_amount,
        b.payment_status,
        b.created_at,
        p.name as property_name,
        p.location as property_location,
        u.name as admin_name,
        u.email as admin_email
      FROM bookings b
      LEFT JOIN properties p ON b.property_id = p.id
      LEFT JOIN users u ON p.admin_id = u.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    console.log("Executing booking query...");
    const queryParams = user.role === "admin" ? [user.id] : [];
    const [bookings] = await db.execute(bookingSql, queryParams);
    console.log("✓ Fetched", bookings.length, "bookings");

    // Get booking stats
    const statsSql = `
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_bookings,
        COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_bookings,
        COUNT(CASE WHEN payment_status = 'cancelled' THEN 1 END) as cancelled_bookings,
        COUNT(CASE WHEN check_in > NOW() THEN 1 END) as upcoming_checkins,
        COUNT(CASE WHEN check_out < NOW() THEN 1 END) as completed_stays,
        SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END) as total_revenue
      FROM bookings b
      LEFT JOIN properties p ON b.property_id = p.id
      ${user.role === "admin" ? "WHERE p.admin_id = ?" : ""}
    `;
    
    console.log("Executing stats query...");
    const statsParams = user.role === "admin" ? [user.id] : [];
    const [statsRows] = await db.execute(statsSql, statsParams);
    const stats = statsRows[0] || {};
    console.log("✓ Stats calculated");

    const totalBookings = Number(stats.total_bookings) || 0;
    const cancelledBookings = Number(stats.cancelled_bookings) || 0;
    const cancellationRate = totalBookings > 0 
      ? ((cancelledBookings / totalBookings) * 100).toFixed(2)
      : 0;

    res.json({
      bookings: bookings || [],
      stats: {
        total_bookings: totalBookings,
        paid_bookings: Number(stats.paid_bookings) || 0,
        pending_bookings: Number(stats.pending_bookings) || 0,
        cancelled_bookings: cancelledBookings,
        upcoming_checkins: Number(stats.upcoming_checkins) || 0,
        completed_stays: Number(stats.completed_stays) || 0,
        total_revenue: Number(stats.total_revenue) || 0,
        cancellation_rate: cancellationRate,
      },
    });
  } catch (error) {
    console.error(" Error in getAllBookings:", error.message);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
};