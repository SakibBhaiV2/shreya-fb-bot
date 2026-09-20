const axios = require("axios");
const { getConfig } = require("./config");

const GRAPH = "https://graph.facebook.com/v21.0";

function getPageToken() {
  return getConfig().FB_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN;
}

function ensureToken() {
  const token = getPageToken();
  if (!token) throw new Error("FB_PAGE_ACCESS_TOKEN missing. Please configure in Settings.");
  return token;
}

/** Messenger-এ টেক্সট মেসেজ পাঠানো */
async function sendMessengerText(recipientId, text) {
  const token = ensureToken();
  const res = await axios.post(
    `${GRAPH}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: text.slice(0, 1900) },
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

/** ইউজারের নাম আনার অপশন (best-effort) */
async function getUserName(psid) {
  try {
    const token = ensureToken();
    const res = await axios.get(`${GRAPH}/${psid}`, {
      params: { fields: "name", access_token: token },
      timeout: 10000,
    });
    return res.data?.name || "";
  } catch {
    return "";
  }
}

module.exports = {
  sendMessengerText,
  replyToComment,
  privateReplyToComment,
  getUserName,
};