const express = require("express");
const crypto = require("crypto");
const Session = require("../models/Session");
const Message = require("../models/Message");
const { generateReply, isGlobalAiEnabled } = require("../services/groq");
const {
  sendMessengerText,
  replyToComment,
  getUserName,
} = require("../services/facebook");
const { getConfig, isFirstMessageAiDisabled } = require("../services/config");
const { broadcast } = require("../services/realtime");

const router = express.Router();

function getVerifyToken() {
  return getConfig().FB_VERIFY_TOKEN || process.env.FB_VERIFY_TOKEN;
}

function getAppSecret() {
  return getConfig().FB_APP_SECRET || process.env.FB_APP_SECRET;
}

/* ---------- Signature verification ---------- */
function verifySignature(req) {
  const secret = getAppSecret();
  if (!secret) return true; // APP_SECRET না থাকলে skip (dev mode)
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/* ---------- Webhook verification ---------- */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = getVerifyToken();
  if (mode === "subscribe" && token === expectedToken) {
    console.log("✅ Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  console.warn("❌ Webhook verification failed - token mismatch or invalid mode");
  res.sendStatus(403);
});

/* ---------- Main webhook ---------- */
router.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    console.warn("❌ Invalid webhook signature");
    return res.sendStatus(401);
  }

  res.status(200).send("EVENT_RECEIVED");

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      /* ----- 1) Messenger messages ----- */
      for (const event of entry.messaging || []) {
        // Handle echo message (outgoing from Page, including Meta Business Suite automation)
        if (event.message?.is_echo) {
          const userPsid = event.recipient?.id;
          const text = event.message?.text;
          if (userPsid && text) {
            await handleEchoMessage({
              platform: "facebook",
              externalId: userPsid,
              text,
              appId: event.message.app_id,
              metadata: event.message.metadata,
            });
          }
          continue;
        }

        if (!event.message?.text) continue;

        const psid = event.sender?.id;
        const text = event.message.text;
        if (!psid || !text) continue;

        await handleIncoming({
          platform: "facebook",
          externalId: psid,
          text,
          source: "messenger",
          replyFn: (reply) => sendMessengerText(psid, reply),
        });
      }

      /* ----- 2) Comments on Page Posts ----- */
      for (const change of entry.changes || []) {
        if (change.field !== "feed") continue;
        const v = change.value || {};
        if (v.item !== "comment" || v.verb !== "add") continue;
        if (!v.message || !v.comment_id) continue;

        if (v.from?.id === entry.id) continue;

        const commenterId = v.from?.id || "unknown";
        await handleIncoming({
          platform: "facebook",
          externalId: "comment:" + commenterId,
          text: v.message,
          source: "comment",
          replyFn: (reply) => replyToComment(v.comment_id, reply),
        });
      }
    }
  } catch (err) {
    console.error("webhook handler error:", err?.response?.data || err.message);
  }
});

/* ---------- Handle Echo / Meta Business Suite Automation Outgoing Message ---------- */
async function handleEchoMessage({ platform, externalId, text, appId, metadata }) {
  try {
    let session = await Session.findOne({ platform, externalId });
    const cleanText = (text || "").trim();

    if (!session) {
      session = await Session.create({
        platform,
        externalId,
        sessionId: `${platform}:${externalId}`,
        displayName: cleanText,
        nameCaptured: true,
        firstMessageHandled: true,
        userMessageCount: 1,
      });
      console.log(`[Meta Automation Name Capture] Created new user with name: "${cleanText}" (PSID: ${externalId})`);
    } else {
      // If displayName is not set yet or name was not captured, save this echo message as the user's name
      if (!session.nameCaptured || !session.displayName) {
        session.displayName = cleanText;
        session.nameCaptured = true;
        console.log(`[Meta Automation Name Capture] Saved user name: "${cleanText}" for session: ${session.sessionId}`);
      }
      session.lastActive = new Date();
      await session.save();
    }

    // Save the outgoing automated message into message history
    const echoMsg = await Message.create({
      sessionId: session.sessionId,
      role: "assistant",
      content: cleanText,
      source: "meta_automation",
    });

    // Broadcast in real-time to admin dashboard
    broadcast("session_update", {
      sessionId: session.sessionId,
      platform: session.platform,
      externalId: session.externalId,
      displayName: session.displayName,
      lastActive: session.lastActive,
      nameCaptured: session.nameCaptured,
      firstMessageHandled: session.firstMessageHandled,
    });

    broadcast("new_message", {
      sessionId: session.sessionId,
      message: {
        id: echoMsg._id || echoMsg.createdAt,
        role: echoMsg.role,
        content: echoMsg.content,
        source: echoMsg.source,
        createdAt: echoMsg.createdAt,
      },
    });
  } catch (err) {
    console.error("handleEchoMessage error:", err.message);
  }
}

/* ---------- Common incoming handler ---------- */
async function handleIncoming({ platform, externalId, text, source, replyFn }) {
  let session = await Session.findOne({ platform, externalId });
  let isBrandNew = false;

  if (!session) {
    isBrandNew = true;
    session = await Session.create({
      platform,
      externalId,
      sessionId: `${platform}:${externalId}`,
      displayName: "",
      userMessageCount: 0,
      firstMessageHandled: false,
      nameCaptured: false,
    });
  }

  const userMsg = await Message.create({
    sessionId: session.sessionId,
    role: "user",
    content: text,
    source,
  });

  // Check if this is the user's very first message
  const isFirstMessage =
    isBrandNew ||
    !session.firstMessageHandled ||
    (session.userMessageCount || 0) === 0;

  session.userMessageCount = (session.userMessageCount || 0) + 1;
  session.lastActive = new Date();
  if (isFirstMessage) {
    session.firstMessageHandled = true;
  }
  await session.save();

  // Broadcast user message to real-time websocket
  broadcast("new_message", {
    sessionId: session.sessionId,
    message: {
      id: userMsg._id || userMsg.createdAt,
      role: userMsg.role,
      content: userMsg.content,
      source: userMsg.source,
      createdAt: userMsg.createdAt,
    },
  });

  broadcast("session_update", {
    sessionId: session.sessionId,
    platform: session.platform,
    externalId: session.externalId,
    displayName: session.displayName,
    lastActive: session.lastActive,
    userMessageCount: session.userMessageCount,
    firstMessageHandled: session.firstMessageHandled,
  });

  // User Requirement:
  // "পেজে প্রথমবার কেউ মেসেজ দিলো তখন এআই রিপ্লাই দিবে না,
  // ইউজার প্রথমবার মেসেজ দেওয়ার পর পেজ থেকে অটোমেটিক একটা মেসেজ যাবে (মেটা বিজনেস এর অটোমেশনের মাধ্যমে আমি সেট করবো যেন কেউ প্রথবার পেজে মেসেজ দিলে ঐ অটোমেশন ঐ ইউজারের ফুল নাম মেসেজ হিসেবে পাঠাবে)
  // প্রথম মেসেজের পর ইউজার কোনো মেসেজ দিলে এআই সেই মেসেজের রিপ্লাই দিবে।"
  if (isFirstMessage && isFirstMessageAiDisabled() && platform === "facebook") {
    console.log(
      `[First Message] User ${externalId} sent first message. Pausing AI reply to let Meta Automation send user's name.`
    );
    return;
  }

  // AI check
  const aiActive = isGlobalAiEnabled() && session.aiEnabled !== false;
  if (!aiActive) {
    console.log(`[AI Auto-reply Disabled] session: ${session.sessionId}`);
    return;
  }

  // Generate AI reply for subsequent messages
  const recent = await Message.find({ sessionId: session.sessionId })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  recent.reverse();

  const history = recent.map((m) => ({ role: m.role, content: m.content }));

  let reply;
  try {
    reply = await generateReply(history);
  } catch (e) {
    console.error("Groq error:", e?.message || e);
    reply = "একটু সমস্যা হয়েছে 😔 আবার মেসেজ দিন।";
  }

  try {
    await replyFn(reply);
  } catch (e) {
    console.error("FB send error:", e?.response?.data || e.message);
  }

  const assistantMsg = await Message.create({
    sessionId: session.sessionId,
    role: "assistant",
    content: reply,
    source,
  });

  // Broadcast assistant reply to real-time websocket
  broadcast("new_message", {
    sessionId: session.sessionId,
    message: {
      id: assistantMsg._id || assistantMsg.createdAt,
      role: assistantMsg.role,
      content: assistantMsg.content,
      source: assistantMsg.source,
      createdAt: assistantMsg.createdAt,
    },
  });
}

module.exports = router;
