const express = require("express");
const crypto = require("crypto");
const Session = require("../models/Session");
const Message = require("../models/Message");
const { generateReply, isGlobalAiEnabled } = require("../services/groq");
const { broadcast } = require("../services/realtime");

const router = express.Router();

router.post("/session", async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const session = await Session.create({
      platform: "web",
      externalId: sessionId,
      sessionId,
      displayName: "ওয়েব ভিজিটর",
    });
    broadcast("session_update", {
      sessionId,
      platform: "web",
      externalId: sessionId,
      displayName: "ওয়েব ভিজিটর",
      lastActive: session.lastActive,
    });
    res.json({ sessionId });
  } catch (err) {
    res.status(500).json({ error: "Could not create session" });
  }
});

router.get("/history/:sessionId", async (req, res) => {
  try {
    const msgs = await Message.find({ sessionId: req.params.sessionId })
      .sort({ createdAt: 1 })
      .lean();
    res.json({
      messages: msgs.map((m) => ({
        id: m._id || m.createdAt,
        role: m.role,
        content: m.content,
        source: m.source || "web",
        createdAt: m.createdAt,
      })),
    });
  } catch {
    res.status(500).json({ error: "Could not load history" });
  }
});

router.post("/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message?.trim())
      return res.status(400).json({ error: "sessionId and message required" });

    const session = await Session.findOne({ sessionId });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const userMsg = await Message.create({
      sessionId,
      role: "user",
      content: message.trim(),
      source: "web",
    });

    session.lastActive = new Date();
    await session.save();

    broadcast("new_message", {
      sessionId,
      message: {
        id: userMsg._id || userMsg.createdAt,
        role: userMsg.role,
        content: userMsg.content,
        source: userMsg.source,
        createdAt: userMsg.createdAt,
      },
    });

    const aiActive = isGlobalAiEnabled() && session.aiEnabled !== false;
    if (!aiActive) {
      return res.json({
        reply: "AI রিপ্লাই অফ আছে। এডমিন শীঘ্রই আপনার সাথে যোগাযোগ করবেন।",
        aiDisabled: true,
      });
    }

    const recent = await Message.find({ sessionId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    recent.reverse();

    const history = recent.map((m) => ({ role: m.role, content: m.content }));
    const reply = await generateReply(history);

    const assistantMsg = await Message.create({
      sessionId,
      role: "assistant",
      content: reply,
      source: "web",
    });

    session.lastActive = new Date();
    await session.save();

    broadcast("new_message", {
      sessionId,
      message: {
        id: assistantMsg._id || assistantMsg.createdAt,
        role: assistantMsg.role,
        content: assistantMsg.content,
        source: assistantMsg.source,
        createdAt: assistantMsg.createdAt,
      },
    });

    res.json({ reply, aiDisabled: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat failed", detail: err.message });
  }
});

module.exports = router;
