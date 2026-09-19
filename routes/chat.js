const express = require("express");
const crypto = require("crypto");
const Session = require("../models/Session");
const Message = require("../models/Message");
const { generateReply } = require("../services/groq");

const router = express.Router();

router.post("/session", async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    await Session.create({
      platform: "web",
      externalId: sessionId,
      sessionId,
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
        role: m.role,
        content: m.content,
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

    await Message.create({
      sessionId,
      role: "user",
      content: message.trim(),
      source: "web",
    });

    const recent = await Message.find({ sessionId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    recent.reverse();

    const history = recent.map((m) => ({ role: m.role, content: m.content }));
    const reply = await generateReply(history);

    await Message.create({
      sessionId,
      role: "assistant",
      content: reply,
      source: "web",
    });

    session.lastActive = new Date();
    await session.save();

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat failed", detail: err.message });
  }
});

module.exports = router;