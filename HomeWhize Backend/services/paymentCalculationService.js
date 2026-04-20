const getPlatformFeePercentage = () => {
  const raw = Number(
    process.env.SHORTLET_PLATFORM_FEE_PERCENTAGE ||
    process.env.PAYSTACK_COMMISSION_PERCENTAGE ||
    "8"
  );

  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) {
    return raw;
  }

  return 8;
};

export const calculateShortletPayment = ({ price_per_night = 0, nights = 0, caution_fee = 0, platformFeePercentage = getPlatformFeePercentage() } = {}) => {
  const base_rent = Number(price_per_night) * Number(nights);
  const platform_fee_amount = Number((base_rent * (platformFeePercentage / 100)).toFixed(2));
  const owner_earnings_amount = Number((base_rent - platform_fee_amount).toFixed(2));
  const gross_paid = Number((base_rent + Number(caution_fee)).toFixed(2));

  return {
    base_rent,
    caution_fee: Number(caution_fee),
    gross_paid,
    platform_fee_amount,
    owner_earnings_amount,
    platform_fee_percentage: platformFeePercentage,
  };
};
