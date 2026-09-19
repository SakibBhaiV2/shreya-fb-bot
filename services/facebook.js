const axios = require("axios");

const GRAPH = "https://graph.facebook.com/v21.0";
const PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

function ensureToken() {
  if (!PAGE_TOKEN) throw new Error("FB_PAGE_ACCESS_TOKEN missing");
}

/** Messenger-এ টেক্সট মেসেজ পাঠানো */
async function sendMessengerText(recipientId, text) {
  ensureToken();
  const res = await axios.post(
    `${GRAPH}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: text.slice(0, 1900) },
    },
    { params: { access_token: PAGE_TOKEN }, timeout: 15000 }
  );
  return res.data;
}

/** Comment-এর নিচে reply দেওয়া */
async function replyToComment(commentId, text) {
  ensureToken();
  const res = await axios.post(
    `${GRAPH}/${commentId}/comments`,
    { message: text.slice(0, 1900) },
    { params: { access_token: PAGE_TOKEN }, timeout: 15000 }
  );
  return res.data;
}

/** Comment-এ private reply (Messenger-এ ইনবক্সে মেসেজ) */
async function privateReplyToComment(commentId, text) {
  ensureToken();
  const res = await axios.post(
    `${GRAPH}/${commentId}/private_replies`,
    { message: text.slice(0, 1900) },
    { params: { access_token: PAGE_TOKEN }, timeout: 15000 }
  );
  return res.data;
}

/** ইউজারের নাম আনার অপশন (best-effort) */
async function getUserName(psid) {
  try {
    ensureToken();
    const res = await axios.get(`${GRAPH}/${psid}`, {
      params: { fields: "name", access_token: PAGE_TOKEN },
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