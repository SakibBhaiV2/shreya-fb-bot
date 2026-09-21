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

/** ফেসবুক পেজকে অ্যাপের ওয়েববুকের সাথে সাবস্ক্রাইব করানো */
async function subscribePageToWebhooks(customToken) {
  const token = customToken || getPageToken();
  if (!token) return { success: false, message: "টোকেন পাওয়া যায়নি" };

  try {
    const res = await axios.post(
      `${GRAPH}/me/subscribed_apps`,
      null,
      {
        params: {
          subscribed_fields: "messages,messaging_postbacks,message_echoes,standby",
          access_token: token,
        },
        timeout: 10000,
      }
    );
    console.log("Successfully subscribed Facebook Page to webhooks:", res.data);
    return { success: true, data: res.data };
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.warn("Could not auto-subscribe page to webhooks:", errMsg);
    return { success: false, error: errMsg };
  }
}

/** ফেসবুক টোকেন ভেরিফিকেশন ও ডায়াগনস্টিক */
async function verifyFacebookToken(customToken) {
  const token = customToken || getPageToken();
  if (!token) {
    return { ok: false, message: "FB_PAGE_ACCESS_TOKEN খালি রয়েছে! দয়া করে টোকেন দিন।" };
  }

  let pageId = null;
  let pageName = null;
  let subscribed = false;
  let lastError = null;

  // 1. Try standard /me with id,name
  try {
    const res = await axios.get(`${GRAPH}/me`, {
      params: { fields: "id,name", access_token: token },
      timeout: 8000,
    });
    pageId = res.data?.id;
    pageName = res.data?.name;
  } catch (err) {
    lastError = err.response?.data?.error || { message: err.message };
    console.log("Facebook /me?fields=id,name notice:", lastError.message);

    // 2. Fallback: In Graph API v19+, if pages_read_engagement is missing, fields=name fails with Error 100.
    // Try querying just id
    try {
      const resId = await axios.get(`${GRAPH}/me`, {
        params: { fields: "id", access_token: token },
        timeout: 8000,
      });
      pageId = resId.data?.id;
      lastError = null;
    } catch (errId) {
      // 3. Fallback: Test with subscribed_apps check
      try {
        const subCheck = await axios.get(`${GRAPH}/me/subscribed_apps`, {
          params: { access_token: token },
          timeout: 8000,
        });
        if (subCheck.data) {
          lastError = null;
        }
      } catch (errSub) {
        lastError = errSub.response?.data?.error || lastError;
      }
    }
  }

  // 4. Try auto-subscribing to webhooks
  const subResult = await subscribePageToWebhooks(token);
  if (subResult.success) {
    subscribed = true;
    lastError = null; // Subscription succeeded, so token IS a valid page token!
  }

  if (pageId || subscribed || !lastError) {
    const namePart = pageName ? `পেজের নাম: "${pageName}"` : (pageId ? `পেজ আইডি: ${pageId}` : "পেজ ভ্যালিড");
    const subPart = subscribed ? " এবং ওয়েববুক সফলভাবে পেজের সাথে যুক্ত (সাবস্ক্রাইব) হয়েছে!" : "";
    return {
      ok: true,
      message: `ফেসবুক পেজ কানেকশন সফল! ${namePart}${subPart}`,
      data: { pageId, pageName, subscribed },
    };
  }

  // Detailed troubleshooting guidance
  const rawMsg = lastError?.message || "Unknown error";
  let explanation = rawMsg;

  if (rawMsg.includes("pages_read_engagement") || rawMsg.includes("Object does not exist") || lastError?.code === 100) {
    explanation = "টোকেনটি সম্ভবত 'User Token' অথবা পারমিশন মিসিং। Graph API Explorer-এ 'User or Page' ড্রপডাউনে ইউজার টোকেন না দিয়ে আপনার ফেসবুক পেজ সিলেক্ট করুন এবং 'pages_messaging' ও 'pages_read_engagement' পারমিশন যুক্ত করে Page Access Token জেনারেট করুন।";
  } else if (lastError?.code === 190) {
    explanation = "ফেসবুক টোকেনের মেয়াদ শেষ হয়ে গেছে বা ইনভ্যালিড। নতুন একটি Page Access Token জেনারেট করুন।";
  }

  return {
    ok: false,
    message: `ফেসবুক টোকেন সমস্যা: ${explanation}`,
    rawError: rawMsg,
  };
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
  subscribePageToWebhooks,
  verifyFacebookToken,
};
