const axios = require("axios");
const { getConfig } = require("./config");

const GRAPH = "https://graph.facebook.com/v21.0";

// Memory cache to track recently sent outgoing bot & admin messages (to prevent echo reflection loops)
const recentSentMessages = new Map(); // key: `${recipientId}:::${normalizedText}` => timestamp

function normalizeText(text) {
  return (text || "").trim().replace(/\s+/g, " ");
}

function recordOutgoingMessage(recipientId, text) {
  if (!recipientId || !text) return;
  const key = `${recipientId}:::${normalizeText(text)}`;
  recentSentMessages.set(key, Date.now());

  // Clean up entries older than 5 minutes
  if (recentSentMessages.size > 200) {
    const now = Date.now();
    for (const [k, time] of recentSentMessages.entries()) {
      if (now - time > 300000) {
        recentSentMessages.delete(k);
      }
    }
  }
}

function isOurOutgoingMessage(recipientId, text, metadata) {
  if (metadata === "SHREYA_AI_BOT" || metadata === "SHREYA_ADMIN_MANUAL") {
    return true;
  }
  if (!recipientId || !text) return false;
  const key = `${recipientId}:::${normalizeText(text)}`;
  const sentTime = recentSentMessages.get(key);
  if (sentTime && Date.now() - sentTime < 180000) {
    return true;
  }
  return false;
}

function getPageToken() {
  return getConfig().FB_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN;
}

function ensureToken() {
  const token = getPageToken();
  if (!token) throw new Error("FB_PAGE_ACCESS_TOKEN missing. Please configure in Settings.");
  return token;
}

/** Messenger-এ টেক্সট মেসেজ পাঠানো (AI বট) */
async function sendMessengerText(recipientId, text) {
  const token = ensureToken();
  const cleanText = text.slice(0, 1900);

  // Record outgoing message so its echo won't be processed as meta automation or become the user's name
  recordOutgoingMessage(recipientId, cleanText);

  const res = await axios.post(
    `${GRAPH}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        text: cleanText,
        metadata: "SHREYA_AI_BOT",
      },
    },
    { params: { access_token: token }, timeout: 15000 }
  );
  return res.data;
}

/** Messenger-এ টেক্সট মেসেজ পাঠানো (এডমিন ম্যানুয়াল) */
async function sendMessengerTextAdmin(recipientId, text) {
  const token = ensureToken();
  const cleanText = text.slice(0, 1900);

  recordOutgoingMessage(recipientId, cleanText);

  const res = await axios.post(
    `${GRAPH}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        text: cleanText,
        metadata: "SHREYA_ADMIN_MANUAL",
      },
    },
    { params: { access_token: token }, timeout: 15000 }
  );
  return res.data;
}

/** Comment-এর নিচে reply দেওয়া */
async function replyToComment(commentId, text) {
  const token = ensureToken();
  const res = await axios.post(
    `${GRAPH}/${commentId}/comments`,
    { message: text.slice(0, 1900) },
    { params: { access_token: token }, timeout: 15000 }
  );
  return res.data;
}

/** Comment-এ private reply (Messenger-এ ইনবক্সে মেসেজ) */
async function privateReplyToComment(commentId, text) {
  const token = ensureToken();
  const res = await axios.post(
    `${GRAPH}/${commentId}/private_replies`,
    { message: text.slice(0, 1900) },
    { params: { access_token: token }, timeout: 15000 }
  );
  return res.data;
}

/** ইউজারের ফেসবুক প্রোফাইল নাম সংগ্রহ (Graph API) */
async function getUserName(psid) {
  try {
    const token = ensureToken();
    const res = await axios.get(`${GRAPH}/${psid}`, {
      params: { fields: "first_name,last_name,name", access_token: token },
      timeout: 10000,
    });
    const data = res.data;
    if (data?.name && data.name.trim()) {
      return data.name.trim();
    }
    if (data?.first_name || data?.last_name) {
      return `${data.first_name || ""} ${data.last_name || ""}`.trim();
    }
    return "";
  } catch (err) {
    // Note: Graph API may require pages_read_user_content or return 400 for some PSIDs
    console.warn("getUserName failed for PSID:", psid, err?.response?.data?.error?.message || err.message);
    return "";
  }
}

/** নাম ভ্যালিডেশন হেল্পার */
function isValidPersonName(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (s.length < 2 || s.length > 50) return false;
  // If it contains punctuation or emojis, it's a message, not a person's name!
  if (/[?!।;:,\n\r]/.test(s)) return false;
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) return false;

  const lower = s.toLowerCase();
  if (
    lower.startsWith("হাই") ||
    lower.startsWith("হ্যালো") ||
    lower.startsWith("কীভাবে") ||
    lower.startsWith("কিভাবে") ||
    lower.startsWith("hello") ||
    lower.startsWith("hi") ||
    lower.startsWith("hey") ||
    lower.includes("সাহায্য করতে")
  ) {
    return false;
  }

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return true;
}

module.exports = {
  sendMessengerText,
  sendMessengerTextAdmin,
  replyToComment,
  privateReplyToComment,
  getUserName,
  isOurOutgoingMessage,
  recordOutgoingMessage,
  isValidPersonName,
};
