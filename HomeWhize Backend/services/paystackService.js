const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const getHeaders = () => {
  if (!PAYSTACK_SECRET) {
    throw new Error("Paystack secret key is not configured");
  }

  return {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    "Content-Type": "application/json",
  };
};

const parseResponse = async (resp) => {
  const data = await resp.json();
  if (!data || !data.status) {
    const message = data && data.message ? data.message : "Paystack request failed";
    throw new Error(message);
  }
  return data;
};

export const getPaystackBanks = async () => {
  const resp = await fetch("https://api.paystack.co/bank", {
    method: "GET",
    headers: getHeaders(),
  });
  const data = await parseResponse(resp);
  return data.data || [];
};

export const resolveBankAccount = async (account_number, bank_code) => {
  const resp = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );
  const data = await parseResponse(resp);
  return data.data;
};

export const createTransferRecipient = async ({ name, account_number, bank_code, email }) => {
  const resp = await fetch("https://api.paystack.co/transferrecipient", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      type: "nuban",
      name,
      account_number,
      bank_code,
      currency: "NGN",
      email: email || undefined,
    }),
  });

  const data = await parseResponse(resp);
  return data.data.recipient_code;
};

export const createPaystackTransfer = async ({ amount, recipient, reason, reference }) => {
  const resp = await fetch("https://api.paystack.co/transfer", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(Number(amount) * 100),
      recipient,
      reason: reason || "Shortlet owner payout",
      reference,
    }),
  });

  const data = await parseResponse(resp);
  return data.data;
};

export const refundPaystackTransaction = async ({ transaction_reference, amount }) => {
  const payload = {
    transaction: transaction_reference,
  };

  if (typeof amount !== 'undefined' && amount !== null) {
    payload.amount = Math.round(Number(amount) * 100);
  }

  const resp = await fetch("https://api.paystack.co/refund", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await parseResponse(resp);
  return data.data;
};
