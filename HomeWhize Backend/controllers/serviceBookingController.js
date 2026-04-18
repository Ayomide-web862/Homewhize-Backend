import crypto from "crypto";
import db from "../config/db.js";
import { createTransaction } from "../models/transactionModel.js";
import {
  createServiceBooking,
  getServiceBookingById,
  getServiceBookingByReference,
  getUserServiceBookings,
  getProviderServiceBookings as fetchProviderServiceBookings,
  updateServiceBookingStatus,
  updateServiceBookingPaymentStatus,
  attachPaystackReferenceToServiceBooking,
} from "../models/serviceBookingModel.js";

const generateBookingReference = () => {
  return `SBKG-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
};

const adminRoles = ["admin", "superadmin", "master"];

export const submitServiceBookingRequest = async (req, res) => {
  try {
    const {
      service_id,
      full_name,
      email,
      phone,
      alternate_phone,
      service_date,
      service_time,
      address,
      notes,
      property_type,
      room_count,
      urgency_level,
      amount,
      currency,
    } = req.body;

    if (!service_id || !full_name || !email || !phone || !service_date || !service_time || !address) {
      return res.status(400).json({ message: "Missing required booking fields" });
    }

    const [serviceRows] = await db.execute(`SELECT * FROM services WHERE id = ? LIMIT 1`, [service_id]);
    if (!serviceRows || serviceRows.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }

    const service = serviceRows[0];
    const providerId = Number(service.provider_id);
    const bookingAmount = Number(amount ?? service.price ?? 0);

    const bookingReference = generateBookingReference();

    const [result] = await createServiceBooking({
      booking_reference: bookingReference,
      user_id: req.user.id,
      provider_id: providerId,
      service_id: service_id,
      full_name: full_name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      alternate_phone: alternate_phone ? String(alternate_phone).trim() : null,
      service_date,
      service_time: String(service_time).trim(),
      address: String(address).trim(),
      notes: notes ? String(notes).trim() : null,
      property_type: property_type ? String(property_type).trim() : null,
      room_count: room_count ? Number(room_count) : null,
      urgency_level: urgency_level ? String(urgency_level).trim() : null,
      amount: Number.isNaN(bookingAmount) ? 0 : bookingAmount,
      currency: currency || "NGN",
      payment_status: "unpaid",
      booking_status: "pending",
    });

    return res.status(201).json({
      message: "Service booking request submitted",
      booking_id: result[0].insertId,
      booking_reference: bookingReference,
    });
  } catch (error) {
    console.error("submitServiceBookingRequest error:", error);
    res.status(500).json({ message: "Unable to submit booking request" });
  }
};

export const getMyServiceBookings = async (req, res) => {
  try {
    const bookings = await getUserServiceBookings(req.user.id);
    res.json({ bookings });
  } catch (error) {
    console.error("getMyServiceBookings error:", error);
    res.status(500).json({ message: "Unable to fetch bookings" });
  }
};

export const getProviderServiceBookings = async (req, res) => {
  try {
    let providerId = null;

    if (adminRoles.includes(req.user.role)) {
      const bookings = await fetchProviderServiceBookings(null);
      return res.json({ bookings });
    }

    const [rows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Provider profile not found" });
    }

    providerId = rows[0].id;
    const bookings = await fetchProviderServiceBookings(providerId);
    res.json({ bookings });
  } catch (error) {
    console.error("getProviderServiceBookings error:", error);
    res.status(500).json({ message: "Unable to fetch provider bookings" });
  }
};

const verifyBookingOwnershipOrProvider = async (req, booking) => {
  if (!booking) return false;

  if (booking.user_id === req.user.id) return true;
  if (adminRoles.includes(req.user.role) || req.user.role === "master") return true;

  if (req.user.role === "cleaner") {
    const [rows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    return rows && rows.length > 0 && rows[0].id === booking.provider_id;
  }

  return false;
};

export const getServiceBookingDetails = async (req, res) => {
  try {
    const booking = await getServiceBookingById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (!(await verifyBookingOwnershipOrProvider(req, booking))) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ booking });
  } catch (error) {
    console.error("getServiceBookingDetails error:", error);
    res.status(500).json({ message: "Unable to fetch booking details" });
  }
};

export const acceptServiceBooking = async (req, res) => {
  try {
    const booking = await getServiceBookingById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.booking_status !== "pending") {
      return res.status(400).json({ message: "Only pending bookings can be accepted" });
    }

    const [providerRows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    if (!providerRows || providerRows.length === 0 || providerRows[0].id !== booking.provider_id) {
      return res.status(403).json({ message: "Only the assigned provider can accept this booking" });
    }

    const note = req.body.note ? String(req.body.note).trim() : null;
    await updateServiceBookingStatus(booking.id, "accepted", note);
    await updateServiceBookingPaymentStatus(booking.booking_reference, "awaiting_payment");

    res.json({ message: "Booking accepted and awaiting payment" });
  } catch (error) {
    console.error("acceptServiceBooking error:", error);
    res.status(500).json({ message: "Unable to accept booking" });
  }
};

export const rejectServiceBooking = async (req, res) => {
  try {
    const booking = await getServiceBookingById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.booking_status !== "pending") {
      return res.status(400).json({ message: "Only pending bookings can be rejected" });
    }

    const [providerRows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    if (!providerRows || providerRows.length === 0 || providerRows[0].id !== booking.provider_id) {
      return res.status(403).json({ message: "Only the assigned provider can reject this booking" });
    }

    const note = req.body.note ? String(req.body.note).trim() : null;
    await updateServiceBookingStatus(booking.id, "rejected", note);
    res.json({ message: "Booking rejected" });
  } catch (error) {
    console.error("rejectServiceBooking error:", error);
    res.status(500).json({ message: "Unable to reject booking" });
  }
};

export const cancelServiceBooking = async (req, res) => {
  try {
    const booking = await getServiceBookingById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const isOwner = booking.user_id === req.user.id;
    const [providerRows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    const isProviderOwner = providerRows && providerRows.length > 0 && providerRows[0].id === booking.provider_id;
    if (!isOwner && !isProviderOwner && !adminRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!["pending", "accepted", "awaiting_payment"].includes(booking.booking_status)) {
      return res.status(400).json({ message: "Booking cannot be cancelled at this stage" });
    }

    await updateServiceBookingStatus(booking.id, "cancelled", null);
    res.json({ message: "Booking cancelled" });
  } catch (error) {
    console.error("cancelServiceBooking error:", error);
    res.status(500).json({ message: "Unable to cancel booking" });
  }
};

export const markServiceBookingInProgress = async (req, res) => {
  try {
    const booking = await getServiceBookingById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const [providerRows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    if (!providerRows || providerRows.length === 0 || providerRows[0].id !== booking.provider_id) {
      return res.status(403).json({ message: "Only the assigned provider can update this booking" });
    }

    if (booking.booking_status !== "confirmed" && booking.booking_status !== "accepted") {
      return res.status(400).json({ message: "Booking must be confirmed or accepted before starting work" });
    }

    if (booking.amount > 0 && booking.payment_status !== "paid") {
      return res.status(400).json({ message: "Cannot start work until payment is completed" });
    }

    await updateServiceBookingStatus(booking.id, "in_progress", null);
    res.json({ message: "Booking marked in progress" });
  } catch (error) {
    console.error("markServiceBookingInProgress error:", error);
    res.status(500).json({ message: "Unable to update booking status" });
  }
};

export const markServiceBookingCompleted = async (req, res) => {
  try {
    const booking = await getServiceBookingById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const [providerRows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [req.user.id]);
    if (!providerRows || providerRows.length === 0 || providerRows[0].id !== booking.provider_id) {
      return res.status(403).json({ message: "Only the assigned provider can complete this booking" });
    }

    if (booking.booking_status !== "in_progress") {
      return res.status(400).json({ message: "Only in-progress bookings can be completed" });
    }

    await updateServiceBookingStatus(booking.id, "completed", null);
    res.json({ message: "Booking marked completed" });
  } catch (error) {
    console.error("markServiceBookingCompleted error:", error);
    res.status(500).json({ message: "Unable to complete booking" });
  }
};

export const initializeServiceBookingPayment = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const booking = await getServiceBookingById(bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.user_id !== req.user.id) {
      return res.status(403).json({ message: "Only the booking owner may initialize payment" });
    }

    if (booking.booking_status !== "accepted" && booking.booking_status !== "awaiting_payment") {
      return res.status(400).json({ message: "Booking is not ready for payment" });
    }

    if (booking.payment_status === "paid") {
      return res.status(400).json({ message: "Booking payment has already been completed" });
    }

    const amount = Number(booking.amount || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: "This booking does not require payment" });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ message: "Paystack not configured" });
    }

    const callback_url = process.env.PAYSTACK_CALLBACK_URL || `${req.protocol}://${req.get("host")}/api/payments/callback`;

    const payload = {
      email: booking.email,
      amount: Math.round(amount * 100),
      callback_url,
      metadata: {
        booking_type: "service",
        service_booking_id: booking.id,
        booking_reference: booking.booking_reference,
        provider_id: booking.provider_id,
        user_id: booking.user_id,
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
      console.error("Service booking Paystack initialize error:", data);
      return res.status(502).json({ message: "Failed to initialize payment" });
    }

    const reference = data.data.reference;
    await createTransaction({
      reference,
      booking_reference: booking.booking_reference,
      booking_id: booking.id,
      amount,
      currency: booking.currency || "NGN",
      customer_email: booking.email,
      provider_id: booking.provider_id,
      paystack_payload: data.data,
    });

    await attachPaystackReferenceToServiceBooking(booking.id, reference);

    res.json({ authorization_url: data.data.authorization_url, reference, booking_reference: booking.booking_reference });
  } catch (error) {
    console.error("initializeServiceBookingPayment error:", error);
    res.status(500).json({ message: "Unable to initialize payment" });
  }
};

export const getProviderDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get provider ID
    const [providerRows] = await db.execute(`SELECT id FROM providers WHERE user_id = ? LIMIT 1`, [userId]);
    if (!providerRows || providerRows.length === 0) {
      return res.status(404).json({ message: "Provider not found" });
    }
    const providerId = providerRows[0].id;

    // Get service bookings for this provider
    const bookings = await fetchProviderServiceBookings(providerId);

    // Compute stats
    const total = bookings.length;
    const pending = bookings.filter(b => b.booking_status === "pending").length;
    const active = bookings.filter(b => ["accepted", "confirmed", "in_progress"].includes(b.booking_status)).length;
    const completed = bookings.filter(b => b.booking_status === "completed").length;
    const totalEarnings = bookings
      .filter(b => b.booking_status === "completed" && b.payment_status === "paid")
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    // Get unread messages count
    const [unreadRows] = await db.execute(`
      SELECT COUNT(*) as unread_count FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.provider_id = ? AND m.read_flag = 0 AND m.sender_role = 'user'
    `, [providerId]);
    const unreadMessages = unreadRows[0]?.unread_count || 0;

    res.json({
      stats: {
        totalBookings: total,
        pendingRequests: pending,
        activeJobs: active,
        completedJobs: completed,
        unreadMessages,
        totalEarnings,
      }
    });
  } catch (error) {
    console.error("getProviderDashboardStats error:", error);
    res.status(500).json({ message: "Unable to fetch dashboard stats" });
  }
};

export default {
  submitServiceBookingRequest,
  getMyServiceBookings,
  getProviderServiceBookings,
  getServiceBookingDetails,
  acceptServiceBooking,
  rejectServiceBooking,
  cancelServiceBooking,
  markServiceBookingInProgress,
  markServiceBookingCompleted,
  initializeServiceBookingPayment,
  getProviderDashboardStats,
};
