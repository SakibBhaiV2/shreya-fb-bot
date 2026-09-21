const express = require("express");
const crypto = require("crypto");
const Session = require("../models/Session");
const Message = require("../models/Message");
const { generateReply, isGlobalAiEnabled } = require("../services/groq");
const {
  sendMessengerText,
  replyToComment,
  getUserName,
  isOurOutgoingMessage,
  isValidPersonName,
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

/* ---------- GET /webhook (Facebook verification) ---------- */
router.get(["/", "/webhook"], (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = getVerifyToken() || "shreya_fb_bot_by_sakib_2026";
  const isMatch =
    Boolean(token) &&
    (token === expectedToken ||
      token.trim() === expectedToken.trim() ||
      token.trim() === "shreya_fb_bot_by_sakib_2026");

  if (mode === "subscribe" && isMatch) {
    console.log("Webhook verified successfully with token:", token);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(String(challenge));
  }
  console.warn("Webhook verification failed. Token received:", token, "Expected:", expectedToken);
  res.sendStatus(403);
});

/* ---------- POST /webhook (Facebook events) ---------- */
router.post(["/", "/webhook"], async (req, res) => {
  if (!verifySignature(req)) {
    console.warn("Invalid webhook signature received");
    return res.status(403).send("Invalid signature");
  }

  // Acknowledge Facebook immediately
  res.status(200).send("EVENT_RECEIVED");

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      const pageId = entry.id;

      // Check both regular messaging and standby (standby is used by Meta Business Suite automations & handover)
      const allMessagingEvents = [
        ...(entry.messaging || []),
        ...(entry.standby || []),
      ];

      /* ----- 1) Messenger messages & Echoes ----- */
      for (const event of allMessagingEvents) {
        // Handle echo message (outgoing messages from Page: Meta Business Suite automation, Page Inbox, or Bot)
        if (event.message?.is_echo) {
          // In echo events, recipient is typically the user PSID, but verify against pageId
          let userPsid = event.recipient?.id;
          if (userPsid === pageId) {
            userPsid = event.sender?.id;
          }
          const text = event.message?.text;

          if (userPsid && text) {
            // Check if this echo is from our own bot reply or admin manual message
            if (isOurOutgoingMessage(userPsid, text, event.message.metadata)) {
              console.log(`[Echo Filter] Ignored echo of our own bot/admin message for user: ${userPsid}`);
              continue;
            }

            // Otherwise, it's a genuine outgoing message from Meta Business Suite automation or Page Inbox!
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

        // Standard incoming message from user
        if (!event.message?.text) continue;

        let psid = event.sender?.id;
        if (psid === pageId) {
          psid = event.recipient?.id;
        }
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
      // Create session if it doesn't exist yet
      session = await Session.create({
        platform,
        externalId,
        sessionId: `${platform}:${externalId}`,
        displayName: isValidPersonName(cleanText) ? cleanText : "",
        nameCaptured: isValidPersonName(cleanText),
        firstMessageHandled: true,
        userMessageCount: 1,
      });
      console.log(`[Meta Automation] Created new session for PSID: ${externalId}`);
    } else {
      // If the incoming text is a valid human name, update displayName
      if (isValidPersonName(cleanText)) {
        if (!session.displayName || !session.nameCaptured || !isValidPersonName(session.displayName)) {
          session.displayName = cleanText;
          session.nameCaptured = true;
          console.log(`[Meta Automation] Captured valid user name: "${cleanText}" for session: ${session.sessionId}`);
        }
      } else {
        console.log(`[Meta Automation] Echo received: "${cleanText}" (not a personal name, stored as automated reply)`);
      }
      session.lastActive = new Date();
      await session.save();
    }

    // Save the automated response into message history so it appears in the Admin Panel Chathistory
    const echoMsg = await Message.create({
      sessionId: session.sessionId,
      role: "assistant",
      content: cleanText,
      source: "meta_automation",
    });

    // Real-time broadcast to Admin Panel
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

  // If user name is missing or corrupted, try to fetch real name from Facebook Graph API
  if (platform === "facebook" && !externalId.startsWith("comment:") && (!session.displayName || !isValidPersonName(session.displayName))) {
    try {
      const fbName = await getUserName(externalId);
      if (fbName && isValidPersonName(fbName)) {
        session.displayName = fbName;
        session.nameCaptured = true;
        console.log(`[Facebook Graph API] Retrieved real user name: "${fbName}" for PSID: ${externalId}`);
      }
    } catch (nameErr) {
      console.warn("Could not fetch user name from Graph API:", nameErr.message);
    }
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
    nameCaptured: session.nameCaptured,
  });

  // User Requirement:
  // "পেজে প্রথমবার কেউ মেসেজ দিলো তখন এআই রিপ্লাই দিবে না,
  // ইউজার প্রথমবার মেসেজ দেওয়ার পর পেজ থেকে অটোমেটিক একটা মেসেজ যাবে (মেটা বিজনেস এর অটোমেশনের মাধ্যমে)
  // প্রথম মেসেজের পর ইউজার কোনো মেসেজ দিলে এআই সেই মেসেজের রিপ্লাই দিবে।"
  if (isFirstMessage && isFirstMessageAiDisabled() && platform === "facebook") {
    console.log(
      `[First Message] User ${externalId} sent first message. Pausing AI reply to let Meta Automation send message.`
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
