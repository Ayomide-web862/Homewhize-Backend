import { createBooking, getBookingById, updateBookingSettlement } from "../models/bookingModel.js";
import db from "../config/db.js";
import crypto from "crypto";
import { getTransferRecipientCodeForUser, settleBookingOwnerPayout } from "../services/bookingPaymentService.js";

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
      "SELECT price, caution_fee FROM properties WHERE id = ? LIMIT 1",
      [property_id]
    );

    if (!propertyRows || propertyRows.length === 0) {
      return res.status(404).json({ message: "Property not found" });
    }

    const pricePerNight = Number(propertyRows[0].price) || 0;
    const caution_fee = Number(propertyRows[0].caution_fee) || 0;

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

    const total_amount = Number((nights * pricePerNight) + caution_fee).toFixed(2);

    const booking_reference = `PADUP-${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;

    await createBooking({
      property_id,
      user_id: req.user.id,
      full_name,
      email,
      phone,
      check_in,
      check_out,
      nights,
      guests: Number(guests) || 1,
      price_per_night: pricePerNight,
      total_amount,
      booking_reference,
      caution_fee,
    });

    res.status(201).json({
      message: "Booking created successfully",
      booking_reference,
      total_amount,
      caution_fee,
    });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ message: "Booking failed" });
  }
};

export const settleBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking id is required" });
    }

    const booking = await getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Only paid bookings can be settled" });
    }

    if (booking.owner_payout_status === "paid") {
      return res.status(200).json({ message: "Booking already settled", booking_id: bookingId });
    }

    const now = new Date();
    const checkOut = new Date(booking.check_out);
    if (checkOut > now) {
      return res.status(400).json({ message: "Cannot settle booking before the stay has completed" });
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
      caution_fee_status: "released",
      stay_outcome: "completed",
    });

    res.json({
      message: "Booking settled successfully",
      booking_id: booking.id,
      transfer: transferResult,
    });
  } catch (error) {
    console.error("Booking settlement error:", error);
    res.status(500).json({ message: error.message || "Failed to settle booking" });
  }
};

/* CANCEL BOOKING - ADMIN ONLY */
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

    if (booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Only paid bookings can be cancelled" });
    }

    if (booking.stay_outcome === "cancelled") {
      return res.status(200).json({ message: "Booking already cancelled", booking_id: bookingId });
    }

    // Update booking status to cancelled
    await updateBookingSettlement(booking.id, {
      payment_status: "cancelled",
      stay_outcome: "cancelled",
      cancelled_at: new Date(),
      cancelled_by: req.user.id,
      caution_fee_status: "refunded", // Mark caution fee for refund
    });

    // TODO: Implement actual refund logic here if needed
    // For now, just mark as cancelled - refund can be handled manually

    res.json({
      message: "Booking cancelled successfully",
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
    });
  } catch (error) {
    console.error("Booking cancellation error:", error);
    res.status(500).json({ message: error.message || "Failed to cancel booking" });
  }
};

/* GET ALL BOOKINGS FOR ADMIN - WITH STATS */
export const getAllBookings = async (req, res) => {
  try {
    const status = req.query.status || "paid";
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const offset = Number(req.query.offset) || 0;

    console.log("Fetching bookings with:", { status, limit, offset });

    // Build WHERE clause
    let whereClause = "";
    if (status && status !== "all") {
      whereClause = `WHERE b.payment_status = '${status}'`;
    }

    // Get paginated bookings with property info
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
        p.name as property_name
      FROM bookings b
      LEFT JOIN properties p ON b.property_id = p.id
      ${whereClause}
      ORDER BY b.check_in DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    console.log("Executing booking query...");
    const [bookings] = await db.execute(bookingSql);
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
      FROM bookings
    `;
    
    console.log("Executing stats query...");
    const [statsRows] = await db.execute(statsSql);
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
    console.error("❌ Error in getAllBookings:", error.message);
    res.status(500).json({ 
      message: "Failed to fetch bookings",
      error: error.message 
    });
  }
};
