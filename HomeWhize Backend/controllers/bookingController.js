import { createBooking } from "../models/bookingModel.js";
import db from "../config/db.js";
import crypto from "crypto";

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
      price_per_night
    } = req.body;

    if (
      !property_id ||
      !full_name ||
      !email ||
      !phone ||
      !check_in ||
      !check_out ||
      !price_per_night
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

    // Prevent double-booking: ensure there is no paid booking that overlaps requested dates
    try {
      const overlapSql = `
        SELECT COUNT(*) AS cnt FROM bookings b
        WHERE b.property_id = ?
          AND b.payment_status = 'paid'
          AND NOT (b.check_out <= ? OR b.check_in >= ?)
      `;
      const [rows] = await db.execute(overlapSql, [property_id, checkIn.toISOString().slice(0,10), checkOut.toISOString().slice(0,10)]);
      const cnt = rows && rows[0] && rows[0].cnt ? Number(rows[0].cnt) : 0;
      if (cnt > 0) {
        return res.status(409).json({ message: 'Selected dates are already booked' });
      }
    } catch (checkErr) {
      console.warn('Failed to check overlapping bookings:', checkErr);
    }

    const total_amount = nights * price_per_night;

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
      guests,
      price_per_night,
      total_amount,
      booking_reference
    });

    res.status(201).json({
      message: "Booking created successfully",
      booking_reference,
      total_amount
    });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ message: "Booking failed" });
  }
};
