const express = require("express");
const crypto = require("crypto");
const Session = require("../models/Session");
const Message = require("../models/Message");
const { generateReply } = require("../services/groq");
const {
  sendMessengerText,
  replyToComment,
  getUserName,
} = require("../services/facebook");

const router = express.Router();

const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const APP_SECRET = process.env.FB_APP_SECRET;

/* ---------- Signature verification (নিরাপত্তার জন্য) ---------- */
function verifySignature(req) {
  if (!APP_SECRET) return true; // APP_SECRET না থাকলে skip (dev)
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/* ---------- Webhook verification (Facebook একবার GET করে) ---------- */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  console.warn("❌ Webhook verification failed");
  res.sendStatus(403);
});

/* ---------- Main webhook (Facebook POST করে) ---------- */
router.post("/webhook", async (req, res) => {
  // Signature চেক
  if (!verifySignature(req)) {
    console.warn("❌ Invalid signature");
    return res.sendStatus(401);
  }

  // Facebook কে দ্রুত 200 ফেরত দাও (নাহলে বারবার retry করবে)
  res.status(200).send("EVENT_RECEIVED");

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      /* ----- 1) Messenger messages ----- */
      for (const event of entry.messaging || []) {
        if (event.message?.is_echo) continue; // নিজের পাঠানো message skip
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

      /* ----- 2) Comments (feed change) ----- */
      for (const change of entry.changes || []) {
        if (change.field !== "feed") continue;
        const v = change.value || {};
        if (v.item !== "comment" || v.verb !== "add") continue;
        if (!v.message || !v.comment_id) continue;

        // পেজ নিজে যে কমেন্ট করছে সেটা skip
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

/* ---------- Common handler ---------- */
async function handleIncoming({ platform, externalId, text, source, replyFn }) {
  // Session খোঁজো বা বানাও
  let session = await Session.findOne({ platform, externalId });
  if (!session) {
    const displayName =
      source === "messenger" ? await getUserName(externalId).catch(() => "") : "";
    session = await Session.create({
      platform,
      externalId,
      sessionId: `${platform}:${externalId}`,
      displayName,
    });
  }

  // ইউজারের মেসেজ সেভ
  await Message.create({
    sessionId: session.sessionId,
    role: "user",
    content: text,
    source,
  });

  // সাম্প্রতিক history লোড করো
  const recent = await Message.find({ sessionId: session.sessionId })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  recent.reverse();

  const history = recent.map((m) => ({ role: m.role, content: m.content }));

  // Groq reply
  let reply;
  try {
    reply = await generateReply(history);
  } catch (e) {
    console.error("Groq error:", e?.message || e);
    reply = "একটু সমস্যা হয়েছে 😔 আবার মেসেজ দিন।";
  }

  // Facebook-এ পাঠাও
  try {
    await replyFn(reply);
  } catch (e) {
    console.error("FB send error:", e?.response?.data || e.message);
  }

  // reply সেভ করো
  await Message.create({
    sessionId: session.sessionId,
    role: "assistant",
    content: reply,
    source,
  });

  session.lastActive = new Date();
  await session.save();
}

module.exports = router;