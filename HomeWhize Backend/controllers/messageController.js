import db from "../config/db.js";
import {
  createConversation,
  getProviderConversations,
  getUserConversations,
  getMessages,
  createMessage,
  canAccessConversation,
  markMessagesAsRead
} from "../models/messageModel.js";
import { getProviderById } from "../models/providerModel.js";

/**
 * Sanitize text input by trimming and basic validation
 */
const sanitizeText = (text) => {
  if (typeof text !== 'string') return '';
  return text.trim().replace(/[<>]/g, ''); // Basic XSS prevention
};

/**
 * Rate limiting store for message sending
 * Simple in-memory store (use Redis in production)
 */
const messageRateLimit = new Map();

const MESSAGE_RATE_LIMIT = 10; // messages per minute
const MESSAGE_RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

/**
 * Check if user is within rate limit
 */
const checkRateLimit = (userId) => {
  const now = Date.now();
  const userLimits = messageRateLimit.get(userId) || [];

  // Remove old entries outside the window
  const validLimits = userLimits.filter(time => now - time < MESSAGE_RATE_WINDOW);

  if (validLimits.length >= MESSAGE_RATE_LIMIT) {
    return false; // Rate limit exceeded
  }

  // Add current request
  validLimits.push(now);
  messageRateLimit.set(userId, validLimits);

  return true;
};

/**
 * Start a new conversation or return existing one
 */
export const startConversation = async (req, res, next) => {
  try {
    const user = req.user;
    const { providerId } = req.body;

    // Validate authentication
    if (!user || !user.id) {
      console.error('[MSG] No authenticated user');
      return res.status(401).json({ message: "Authentication required" });
    }

    // Validate providerId
    if (!providerId || isNaN(providerId)) {
      console.error('[MSG] Invalid providerId:', providerId);
      return res.status(400).json({ message: "Valid provider ID required" });
    }

    // Verify provider exists
    const provider = await getProviderById(providerId);
    if (!provider) {
      console.error('[MSG] Provider not found for ID:', providerId);
      return res.status(404).json({ message: "Provider not found" });
    }

    // Check rate limit for conversation creation
    if (!checkRateLimit(user.id)) {
      console.warn('[MSG] Rate limit exceeded for user:', user.id);
      return res.status(429).json({
        message: "Too many requests. Please wait before creating another conversation."
      });
    }

    const conversation = await createConversation(user.id, parseInt(providerId));
    
    if (!conversation || !conversation.id) {
      console.error('[MSG] Failed to create conversation: invalid response');
      return res.status(500).json({ message: "Failed to create conversation" });
    }

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        user_id: conversation.user_id,
        provider_id: conversation.provider_id,
        created_at: conversation.created_at
      }
    });

  } catch (err) {
    console.error('[MSG] Start conversation error - User:', req.user?.id, 'Error:', err.message, 'Stack:', err.stack);
    next(err);
  }
};

/**
 * Get all conversations for the authenticated user
 */
export const fetchUserConversations = async (req, res, next) => {
  try {
    const user = req.user;

    // Validate authentication
    if (!user || !user.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const conversations = await getUserConversations(user.id);

    res.json({
      success: true,
      conversations: conversations.map(conv => ({
        id: conv.id,
        user_id: conv.user_id,
        provider_id: conv.provider_id,
        provider_name: conv.provider_name,
        provider_email: conv.provider_email,
        last_message: conv.last_message,
        last_updated: conv.last_updated,
        unread_count: conv.unread_count || 0
      }))
    });

  } catch (err) {
    console.error('Fetch user conversations error:', err);
    next(err);
  }
};

/**
 * Fetch conversations for a provider
 */

export const fetchProviderConversations = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user || !user.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // 🔥 GET PROVIDER ID FROM USER
    const [providerRows] = await db.execute(
      `SELECT id FROM providers WHERE user_id = ? LIMIT 1`,
      [user.id]
    );

    if (!providerRows.length) {
      return res.status(403).json({ message: "Provider not found for this user" });
    }

    const providerId = providerRows[0].id;

    const conversations = await getProviderConversations(providerId);

    res.json({
      success: true,
      conversations
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Get messages for a specific conversation
 */
export const fetchMessages = async (req, res, next) => {
  try {
    const user = req.user;
    const { conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Validate authentication
    if (!user || !user.id) {
      console.error('[MSG] No authenticated user for fetchMessages');
      return res.status(401).json({ message: "Authentication required" });
    }

    // Validate conversationId
    if (!conversationId || isNaN(conversationId)) {
      console.error('[MSG] Invalid conversationId:', conversationId);
      return res.status(400).json({ message: "Valid conversation ID required" });
    }

    // Determine if user is a provider
    const [providerRows] = await db.execute(
      `SELECT id FROM providers WHERE user_id = ? LIMIT 1`,
      [user.id]
    );

    const role = providerRows && providerRows.length ? 'provider' : 'user';
    const actorId = providerRows && providerRows.length ? providerRows[0].id : user.id;

    // Check if user has access to this conversation
    const hasAccess = await canAccessConversation(
      parseInt(conversationId),
      actorId,
      role
    );

    if (!hasAccess) {
      console.warn('[MSG] Access denied - User:', user.id, 'Conversation:', conversationId, 'Role:', role);
      return res.status(403).json({ message: "Access denied to this conversation" });
    }

    // Mark messages as read for this user
    await markMessagesAsRead(
      parseInt(conversationId),
      actorId,
      role
    );

    const messages = await getMessages(
      parseInt(conversationId),
      parseInt(limit),
      parseInt(offset)
    );

    res.json({
      success: true,
      messages: (messages || []).map(msg => ({
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_role: msg.sender_role,
        sender_id: msg.sender_id,
        sender_name: msg.sender_name,
        text: msg.text,
        read_flag: msg.read_flag,
        created_at: msg.created_at
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: messages && messages.length === parseInt(limit)
      }
    });

  } catch (err) {
    console.error('[MSG] Fetch messages error - User:', req.user?.id, 'ConvID:', req.params.conversationId, 'Error:', err.message);
    next(err);
  }
};

/**
 * Send a message in a conversation
 */
export const sendMessage = async (req, res, next) => {
  try {
    const user = req.user;
    const { conversationId, text } = req.body;

    // Validate authentication
    if (!user || !user.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Validate inputs
    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ message: "Valid conversation ID required" });
    }

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ message: "Message text is required" });
    }

    // Sanitize input
    const sanitizedText = sanitizeText(text);
    if (!sanitizedText) {
      return res.status(400).json({ message: "Message cannot be empty after sanitization" });
    }

    // Check rate limit
    if (!checkRateLimit(user.id)) {
      return res.status(429).json({
        message: "Too many messages sent. Please wait before sending another message.",
        retry_after: MESSAGE_RATE_WINDOW / 1000
      });
    }

    // Determine sender role (check if user is a provider)
    const [providerRows] = await db.execute(
      `SELECT id FROM providers WHERE user_id = ? LIMIT 1`,
      [user.id]
    );

    const senderRole = providerRows.length ? 'provider' : 'user';
    const senderId = providerRows.length ? providerRows[0].id : user.id;

    // Check if user has access to this conversation
    const hasAccess = await canAccessConversation(
      parseInt(conversationId),
      senderId,
      senderRole
    );

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied to this conversation" });
    }

    // Create and send the message
    const message = await createMessage(
      parseInt(conversationId),
      senderId,
      senderRole,
      sanitizedText
    );

    res.status(201).json({
      success: true,
      message: {
        id: message.id,
        conversation_id: message.conversation_id,
        sender_role: message.sender_role,
        sender_id: message.sender_id,
        sender_name: message.sender_name,
        text: message.text,
        read_flag: message.read_flag,
        created_at: message.created_at
      }
    });

  } catch (err) {
    console.error('Send message error:', err);

    // Handle specific validation errors
    if (err.message.includes('Message cannot be empty') ||
        err.message.includes('Message too long')) {
      return res.status(400).json({ message: err.message });
    }

    if (err.message.includes('Conversation not found')) {
      return res.status(404).json({ message: err.message });
    }

    next(err);
  }
};