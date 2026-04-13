import db from "../config/db.js";

/**
 * Create or get existing conversation between user and provider
 * @param {number} userId - User ID
 * @param {number} providerId - Provider ID
 * @returns {Object} Conversation object
 */
export const createConversation = async (userId, providerId) => {
  // Validate inputs
  if (!userId || !providerId || isNaN(userId) || isNaN(providerId)) {
    throw new Error('Invalid user or provider ID');
  }

  // Check if conversation already exists
  const [rows] = await db.execute(
    `SELECT * FROM conversations
     WHERE user_id = ? AND provider_id = ? LIMIT 1`,
    [userId, providerId]
  );

  if (rows && rows.length) return rows[0];

  // Create new conversation
  const [result] = await db.execute(
    `INSERT INTO conversations (user_id, provider_id, created_at, last_updated)
     VALUES (?, ?, NOW(), NOW())`,
    [userId, providerId]
  );

  if (!result || !result.insertId) {
    throw new Error('Failed to create conversation - no insertId');
  }

  // Return the created conversation
  const [newRow] = await db.execute(
    `SELECT * FROM conversations WHERE id = ?`,
    [result.insertId]
  );

  if (!newRow || !newRow.length) {
    throw new Error('Failed to retrieve created conversation');
  }

  return newRow[0];
};

/**
 * Get all conversations for a provider with user details
 * @param {number} providerId - Provider ID
 * @returns {Array} Array of conversation objects with user details
 */
export const getProviderConversations = async (providerId) => {
  if (!providerId || isNaN(providerId)) {
    throw new Error('Invalid provider ID');
  }

  const [rows] = await db.execute(
    `SELECT
       c.id,
       c.user_id,
       c.provider_id,
       c.last_message,
       c.last_updated,
       c.created_at,
       u.name as user_name,
       u.email as user_email,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read_flag = 0 AND m.sender_role = 'user') as unread_count
     FROM conversations c
     JOIN users u ON c.user_id = u.id
     WHERE c.provider_id = ?
     ORDER BY c.last_updated DESC`,
    [providerId]
  );

  return rows || [];
};

/**
 * Get messages for a conversation with pagination
 * @param {number} conversationId - Conversation ID
 * @param {number} limit - Maximum messages to return (default: 50)
 * @param {number} offset - Offset for pagination (default: 0)
 * @returns {Array} Array of message objects
 */
export const getMessages = async (conversationId, limit = 50, offset = 0) => {
  if (!conversationId || isNaN(conversationId)) {
    throw new Error('Invalid conversation ID');
  }

  limit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100)); // Ensure valid integer, max 100
  offset = Math.max(0, parseInt(offset, 10) || 0); // Ensure valid integer, min 0
  conversationId = parseInt(conversationId, 10); // Ensure integer

  // Note: LIMIT and OFFSET must be concatenated for mysql2 prepared statements
  const [rows] = await db.execute(
    `SELECT
       m.id,
       m.conversation_id,
       m.sender_role,
       m.sender_id,
       m.text,
       m.read_flag,
       m.created_at,
       CASE
         WHEN m.sender_role = 'user' THEN u.name
         WHEN m.sender_role = 'provider' THEN p.company_name
         ELSE 'System'
       END as sender_name
     FROM messages m
     LEFT JOIN users u ON m.sender_role = 'user' AND m.sender_id = u.id
     LEFT JOIN providers p ON m.sender_role = 'provider' AND m.sender_id = p.id
     WHERE m.conversation_id = ?
     ORDER BY m.created_at ASC
     LIMIT ${limit} OFFSET ${offset}`,
    [conversationId]
  );

  return rows || [];
};

/**
 * Create a new message and update conversation
 * @param {number} conversationId - Conversation ID
 * @param {number} senderId - Sender ID
 * @param {string} senderRole - 'user' or 'provider'
 * @param {string} text - Message text
 * @returns {Object} Created message object
 */
export const createMessage = async (conversationId, senderId, senderRole, text) => {
  // Validate inputs
  if (!conversationId || !senderId || !senderRole || !text) {
    throw new Error('Missing required message data');
  }

  if (!['user', 'provider', 'system'].includes(senderRole)) {
    throw new Error('Invalid sender role');
  }

  // Trim and validate message length
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    throw new Error('Message cannot be empty');
  }

  if (trimmedText.length > 2000) {
    throw new Error('Message too long (max 2000 characters)');
  }

  // Verify conversation exists and user has access
  const [convCheck] = await db.execute(
    `SELECT id FROM conversations WHERE id = ?`,
    [conversationId]
  );

  if (convCheck.length === 0) {
    throw new Error('Conversation not found');
  }

  // Insert message
  const [result] = await db.execute(
    `INSERT INTO messages (conversation_id, sender_id, sender_role, text, created_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [conversationId, senderId, senderRole, trimmedText]
  );

  // Update conversation's last message and timestamp
  await db.execute(
    `UPDATE conversations
     SET last_message = LEFT(?, 255), last_updated = NOW()
     WHERE id = ?`,
    [trimmedText, conversationId]
  );

  // Return the created message with sender info
  const [rows] = await db.execute(
    `SELECT
       m.*,
       CASE
         WHEN m.sender_role = 'user' THEN u.name
         WHEN m.sender_role = 'provider' THEN p.company_name
         ELSE 'System'
       END as sender_name
     FROM messages m
     LEFT JOIN users u ON m.sender_role = 'user' AND m.sender_id = u.id
     LEFT JOIN providers p ON m.sender_role = 'provider' AND m.sender_id = p.id
     WHERE m.id = ?`,
    [result.insertId]
  );

  return rows[0];
};

/**
 * Mark messages as read in a conversation
 * @param {number} conversationId - Conversation ID
 * @param {number} userId - User ID who is reading
 * @param {string} userRole - 'user' or 'provider'
 */
export const markMessagesAsRead = async (conversationId, userId, userRole) => {
  if (!conversationId || !userId || !userRole) {
    console.warn('[MSG] Missing parameters for markMessagesAsRead');
    return; // Don't throw, just skip marking as read
  }

  try {
    // Mark messages as read (only messages not sent by this user)
    await db.execute(
      `UPDATE messages
       SET read_flag = 1
       WHERE conversation_id = ? AND sender_id != ? AND sender_role != ?`,
      [conversationId, userId, userRole]
    );
  } catch (err) {
    // Don't fail the whole operation if marking as read fails
    console.warn('[MSG] Error marking messages as read:', err.message);
  }
};

/**
 * Get all conversations for a user
 * @param {number} userId - User ID
 * @returns {Array} Array of conversation objects with provider details
 */
export const getUserConversations = async (userId) => {
  if (!userId || isNaN(userId)) {
    throw new Error('Invalid user ID');
  }

  const [rows] = await db.execute(
    `SELECT
       c.id,
       c.user_id,
       c.provider_id,
       c.last_message,
       c.last_updated,
       c.created_at,
       p.company_name as provider_name,
       p.email as provider_email,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read_flag = 0 AND m.sender_role = 'provider') as unread_count
     FROM conversations c
     JOIN providers p ON c.provider_id = p.id
     WHERE c.user_id = ?
     ORDER BY c.last_updated DESC`,
    [userId]
  );

  return rows || [];
};

/**
 * Check if user has access to conversation
 * @param {number} conversationId - Conversation ID
 * @param {number} userId - User ID
 * @param {string} userRole - 'user' or 'provider'
 * @returns {boolean} True if user has access
 */
export const canAccessConversation = async (conversationId, userId, userRole) => {
  if (!conversationId || !userId || !userRole) {
    console.error('[MSG] Invalid params for canAccessConversation');
    return false;
  }

  const [rows] = await db.execute(
    `SELECT id FROM conversations
     WHERE id = ? AND ${
       userRole === 'user' ? 'user_id = ?' : 'provider_id = ?'
     }`,
    [conversationId, userId]
  );

  return rows && rows.length > 0;
};