import db from "../config/db.js";

// Initialize a Paystack transaction (server-side uses secret key)
export const initializePayment = async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || !amount) return res.status(400).json({ message: "Email and amount are required" });

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) return res.status(500).json({ message: "Paystack secret key not configured" });

    const callback_url = process.env.PAYSTACK_CALLBACK_URL || `${req.protocol}://${req.get("host")}/api/payments/callback`;

    // Paystack expects amount in kobo (multiply Naira by 100)
    const payload = { email, amount: Math.round(Number(amount) * 100), callback_url };

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
      console.error("Paystack initialize failed:", data);
      return res.status(502).json({ message: "Failed to initialize payment", details: data });
    }

    // Return authorization_url and reference to frontend
    return res.status(200).json({ authorization_url: data.data.authorization_url, reference: data.data.reference });
  } catch (error) {
    console.error("initializePayment error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify transaction by reference
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) return res.status(500).json({ message: "Paystack secret key not configured" });

    const resp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });

    const data = await resp.json();
    if (!data.status) {
      console.error("Paystack verify failed:", data);
      return res.status(502).json({ message: "Failed to verify payment", details: data });
    }

    // Example: you could persist payment info to DB here
    // For now, return verification payload
    return res.status(200).json({ verified: true, data: data.data });
  } catch (error) {
    console.error("verifyPayment error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
