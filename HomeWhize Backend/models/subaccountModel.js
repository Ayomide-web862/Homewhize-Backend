import db from "../config/db.js";

export const saveSubaccount = async (user_id, subaccount_code, bank_details, transfer_recipient_code = null) => {
  // Check if subaccount already exists for this user
  const existing = await getSubaccountByUserId(user_id);

  if (existing) {
    // Update existing subaccount
    const sql = `UPDATE subaccounts SET
                 subaccount_code = ?,
                 bank_name = ?,
                 bank_code = ?,
                 account_number = ?,
                 transfer_recipient_code = COALESCE(?, transfer_recipient_code),
                 updated_at = NOW()
                 WHERE user_id = ?`;
    await db.execute(sql, [
      subaccount_code,
      bank_details.bank_name || null,
      bank_details.bank_code || null,
      bank_details.account_number || null,
      transfer_recipient_code || null,
      user_id
    ]);
    return { id: existing.id, user_id, subaccount_code, transfer_recipient_code: transfer_recipient_code || existing.transfer_recipient_code };
  } else {
    // Insert new subaccount
    const sql = `INSERT INTO subaccounts (user_id, subaccount_code, bank_name, bank_code, account_number, transfer_recipient_code, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`;
    const [result] = await db.execute(sql, [
      user_id,
      subaccount_code,
      bank_details.bank_name || null,
      bank_details.bank_code || null,
      bank_details.account_number || null,
      transfer_recipient_code || null
    ]);
    return { id: result.insertId, user_id, subaccount_code, transfer_recipient_code };
  }
};

export const updateSubaccountRecipientCode = async (user_id, recipient_code) => {
  const sql = `UPDATE subaccounts SET transfer_recipient_code = ? WHERE user_id = ?`;
  await db.execute(sql, [recipient_code, user_id]);
};

export const getSubaccountByUserId = async (user_id) => {
  const [rows] = await db.execute(
    `SELECT * FROM subaccounts WHERE user_id = ? LIMIT 1`,
    [user_id]
  );
  return rows && rows.length > 0 ? rows[0] : null;
};

export default { saveSubaccount, getSubaccountByUserId, updateSubaccountRecipientCode };