import { getSubaccountByUserId, saveSubaccount } from "../models/subaccountModel.js";

export const createSubaccountForUser = async (user) => {
  if (!user) throw new Error("User object is required");

  const { business_name, bank_code, account_number, bank_name, user_id, email } = user;

  if (!business_name || !bank_code || !account_number || !user_id) {
    throw new Error("business_name, bank_code, account_number, and user_id are required to create subaccount");
  }

  const existing = await getSubaccountByUserId(user_id);
  if (existing) {
    return existing.subaccount_code;
  }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecret) {
    throw new Error("Paystack secret key is not configured");
  }

  // Validate bank details via Paystack to avoid trusting frontend bank data
  const resolveResponse = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
    }
  );

  const resolved = await resolveResponse.json();
  if (!resolved || !resolved.status || !resolved.data) {
    throw new Error("Invalid bank account details provided");
  }

  const account_name = resolved.data.account_name;
  if (!account_name) {
    throw new Error("Bank account verification failed");
  }

  const percentageCharge = Number(process.env.PAYSTACK_COMMISSION_PERCENTAGE || "10");

  const payload = {
    business_name: business_name,
    settlement_bank: bank_code,
    account_number,
    account_name,
    percentage_charge: Number.isFinite(percentageCharge) ? percentageCharge : 10,
    primary_contact: user.full_name || business_name,
    primary_contact_email: email || null,
  };

  const resp = await fetch("https://api.paystack.co/subaccount", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (!data || !data.status || !data.data || !data.data.subaccount_code) {
    console.error("Paystack subaccount creation failed", data);
    throw new Error("Failed to create Paystack subaccount");
  }

  const subaccount_code = data.data.subaccount_code;
  await saveSubaccount(user_id, subaccount_code, {
    bank_name: bank_name || null,
    bank_code,
    account_number,
  });

  return subaccount_code;
};

export default { createSubaccountForUser };