const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const Session = require("../models/Session");
const Message = require("../models/Message");
const {
  isGlobalAiEnabled,
  setGlobalAiEnabled,
  getSystemPrompt,
  setSystemPrompt,
  resetSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
} = require("../services/groq");
const {
  sendMessengerText,
  sendMessengerTextAdmin,
  getUserName,
  isValidPersonName,
} = require("../services/facebook");
const { getConfig, getSafeConfig, updateConfig } = require("../services/config");
const { broadcast, registerSseClient } = require("../services/realtime");

const router = express.Router();
const activeTokens = new Set();

// Helper to broadcast fresh stats
async function broadcastStats() {
  try {
    const totalUsers = await Session.countDocuments();
    const fbUsers = await Session.countDocuments({ platform: "facebook" });
    const webUsers = await Session.countDocuments({ platform: "web" });
    const totalMessages = await Message.countDocuments();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let allSessions = await Session.find().lean();
    if (!Array.isArray(allSessions)) allSessions = [];
    const activeUsers = allSessions.filter(
      (s) => new Date(s.lastActive || s.createdAt) >= yesterday
    ).length;

    broadcast("stats_update", {
      totalUsers,
      activeUsers,
      fbUsers,
      webUsers,
      totalMessages,
      globalAiEnabled: isGlobalAiEnabled(),
    });
  } catch {}
}

// Admin Authentication Middleware
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : req.headers["x-admin-token"];

  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

// 1. Admin Login
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  const currentPass = getConfig().ADMIN_PASSWORD || "Sakib@7890";
  if (password === currentPass) {
    const token = "shreya_adm_" + crypto.randomBytes(24).toString("hex");
    activeTokens.add(token);
    return res.json({ success: true, token });
  }
  return res.status(401).json({ error: "ভুল পাসওয়ার্ড! সঠিক পাসওয়ার্ড দিন।" });
});

// 2. Admin Logout
router.post("/logout", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : req.headers["x-admin-token"];
  if (token) activeTokens.delete(token);
  res.json({ success: true });
});

// 3. Verify session
router.get("/me", requireAdminAuth, (req, res) => {
  res.json({
    authenticated: true,
    globalAiEnabled: isGlobalAiEnabled(),
  });
});

// 4. SSE Events Endpoint (Realtime Fallback)
router.get("/events", requireAdminAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  registerSseClient(res);
  res.write(`data: ${JSON.stringify({ type: "connected", time: Date.now() })}\n\n`);
});

// 5. Stats overview
router.get("/stats", requireAdminAuth, async (req, res) => {
  try {
    const totalUsers = await Session.countDocuments();
    const fbUsers = await Session.countDocuments({ platform: "facebook" });
    const webUsers = await Session.countDocuments({ platform: "web" });
    const totalMessages = await Message.countDocuments();

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let allSessions = await Session.find().lean();
    if (!Array.isArray(allSessions)) allSessions = [];
    const activeUsers = allSessions.filter(
      (s) => new Date(s.lastActive || s.createdAt) >= yesterday
    ).length;

    res.json({
      totalUsers,
      activeUsers,
      fbUsers,
      webUsers,
      totalMessages,
      globalAiEnabled: isGlobalAiEnabled(),
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// 6. User List
router.get("/users", requireAdminAuth, async (req, res) => {
  try {
    const { platform, search } = req.query || {};
    let query = {};
    if (platform && platform !== "all") {
      query.platform = platform;
    }

    let sessions = await Session.find(query).sort({ lastActive: -1 }).lean();
    if (!Array.isArray(sessions)) sessions = [];

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      sessions = sessions.filter(
        (s) =>
          (s.displayName && s.displayName.toLowerCase().includes(q)) ||
          (s.externalId && s.externalId.toLowerCase().includes(q)) ||
          (s.sessionId && s.sessionId.toLowerCase().includes(q))
      );
    }

    const enhanced = await Promise.all(
      sessions.map(async (s) => {
        // Auto-heal corrupted names (e.g. accidental bot replies as names)
        if (s.platform === "facebook" && s.displayName && !isValidPersonName(s.displayName)) {
          try {
            const real = await getUserName(s.externalId);
            s.displayName = (real && isValidPersonName(real)) ? real : "";
            s.nameCaptured = Boolean(real && isValidPersonName(real));
            await Session.updateOne({ _id: s._id }, { displayName: s.displayName, nameCaptured: s.nameCaptured });
          } catch {
            s.displayName = "";
            s.nameCaptured = false;
            await Session.updateOne({ _id: s._id }, { displayName: "", nameCaptured: false });
          }
        }

        const lastMsgs = await Message.find({ sessionId: s.sessionId })
          .sort({ createdAt: -1 })
          .limit(1)
          .lean();
        const count = await Message.countDocuments({ sessionId: s.sessionId });
        const lastMsg = lastMsgs && lastMsgs[0] ? lastMsgs[0] : null;

        return {
          sessionId: s.sessionId,
          platform: s.platform,
          externalId: s.externalId,
          displayName: s.displayName || "",
          nameCaptured: Boolean(s.nameCaptured),
          userMessageCount: s.userMessageCount || 0,
          aiEnabled: s.aiEnabled !== false,
          lastActive: s.lastActive || s.createdAt,
          createdAt: s.createdAt,
          messageCount: count,
          lastMessage: lastMsg
            ? {
                content: lastMsg.content,
                role: lastMsg.role,
                source: lastMsg.source,
                createdAt: lastMsg.createdAt,
              }
            : null,
        };
      })
    );

    res.json({ users: enhanced });
  } catch (err) {
    console.error("Users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// 7. Single User & Conversation History
router.get("/users/:sessionId", requireAdminAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
    }

    // Auto-heal corrupted names
    if (session.platform === "facebook" && session.displayName && !isValidPersonName(session.displayName)) {
      try {
        const real = await getUserName(session.externalId);
        session.displayName = (real && isValidPersonName(real)) ? real : "";
        session.nameCaptured = Boolean(real && isValidPersonName(real));
        await session.save();
      } catch {
        session.displayName = "";
        session.nameCaptured = false;
        await session.save();
      }
    }

    const messages = await Message.find({ sessionId })
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      session: {
        sessionId: session.sessionId,
        platform: session.platform,
        externalId: session.externalId,
        displayName: session.displayName || "",
        nameCaptured: Boolean(session.nameCaptured),
        userMessageCount: session.userMessageCount || 0,
        aiEnabled: session.aiEnabled !== false,
        lastActive: session.lastActive || session.createdAt,
        createdAt: session.createdAt,
      },
      messages: (messages || []).map((m) => ({
        id: m._id || m.createdAt,
        role: m.role,
        content: m.content,
        source: m.source || "messenger",
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error("User conversation error:", err);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// 8. Send message to user from Admin
router.post("/users/:sessionId/message", requireAdminAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "মেসেজ খালি হতে পারে না" });
    }

    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
    }

    const trimmedMsg = message.trim();

    // If platform is facebook, send to Messenger
    if (session.platform === "facebook" && !session.externalId.startsWith("comment:")) {
      try {
        await sendMessengerTextAdmin(session.externalId, trimmedMsg);
      } catch (fbErr) {
        console.error("Failed to send Facebook Messenger reply:", fbErr?.response?.data || fbErr.message);
      }
    }

    // Save message in DB with source 'admin'
    const savedMsg = await Message.create({
      sessionId: session.sessionId,
      role: "assistant",
      content: trimmedMsg,
      source: "admin",
    });

    session.lastActive = new Date();
    await session.save();

    const formattedMsg = {
      id: savedMsg._id || savedMsg.createdAt,
      role: savedMsg.role,
      content: savedMsg.content,
      source: savedMsg.source,
      createdAt: savedMsg.createdAt,
    };

    // Broadcast in real-time via WebSocket
    broadcast("new_message", {
      sessionId: session.sessionId,
      message: formattedMsg,
    });
    broadcastStats();

    res.json({
      success: true,
      message: formattedMsg,
    });
  } catch (err) {
    console.error("Admin send message error:", err);
    res.status(500).json({ error: "Failed to send message: " + err.message });
  }
});

// 9. Toggle AI for a specific user
router.patch("/users/:sessionId/ai", requireAdminAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { aiEnabled } = req.body;

    if (aiEnabled === undefined) {
      return res.status(400).json({ error: "aiEnabled boolean required" });
    }

    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
    }

    session.aiEnabled = Boolean(aiEnabled);
    await session.save();

    // Broadcast AI toggle in real-time
    broadcast("ai_toggle", {
      sessionId: session.sessionId,
      aiEnabled: session.aiEnabled,
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      aiEnabled: session.aiEnabled,
    });
  } catch (err) {
    console.error("Toggle user AI error:", err);
    res.status(500).json({ error: "Failed to update AI state for user" });
  }
});

// 9.1 Update user display name
router.patch("/users/:sessionId/name", requireAdminAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { displayName } = req.body || {};

    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
    }

    session.displayName = (displayName || "").trim();
    session.nameCaptured = Boolean(session.displayName);
    await session.save();

    broadcast("session_update", {
      sessionId: session.sessionId,
      displayName: session.displayName,
      nameCaptured: session.nameCaptured,
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      displayName: session.displayName,
    });
  } catch (err) {
    console.error("Update user name error:", err);
    res.status(500).json({ error: "Failed to update user name: " + err.message });
  }
});

// 10. AI Prompt Settings: Get
router.get("/settings/prompt", requireAdminAuth, (req, res) => {
  res.json({
    prompt: getSystemPrompt(),
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
  });
});

// 11. AI Prompt Settings: Update
router.post("/settings/prompt", requireAdminAuth, (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: "প্রম্পট খালি রাখা যাবে না" });
  }
  const updated = setSystemPrompt(prompt);
  broadcast("prompt_update", { prompt: updated });
  res.json({ success: true, prompt: updated });
});

// 12. AI Prompt Settings: Reset
router.post("/settings/prompt/reset", requireAdminAuth, (req, res) => {
  const reset = resetSystemPrompt();
  broadcast("prompt_update", { prompt: reset });
  res.json({ success: true, prompt: reset });
});

// 13. Global AI Toggle
router.post("/settings/global-ai", requireAdminAuth, (req, res) => {
  const { enabled } = req.body;
  if (enabled === undefined) {
    return res.status(400).json({ error: "enabled boolean required" });
  }
  const newState = setGlobalAiEnabled(enabled);
  broadcast("global_ai_toggle", { globalAiEnabled: newState });
  broadcastStats();
  res.json({ success: true, globalAiEnabled: newState });
});

// 14. System Configuration: Get all configuration
router.get("/settings/system", requireAdminAuth, (req, res) => {
  res.json({
    config: getConfig(),
  });
});

// 15. System Configuration: Update configuration
router.post("/settings/system", requireAdminAuth, (req, res) => {
  try {
    const updated = updateConfig(req.body);
    broadcast("settings_update", { config: updated });
    res.json({
      success: true,
      config: updated,
      message: "সকল সেটিংস সফলভাবে আপডেট ও সংরক্ষিত হয়েছে!",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings: " + err.message });
  }
});

// 16. Test connection (Facebook or Groq)
router.post("/settings/test-connection", requireAdminAuth, async (req, res) => {
  const { type } = req.body;
  const cfg = getConfig();

  if (type === "facebook") {
    const token = cfg.FB_PAGE_ACCESS_TOKEN;
    if (!token) {
      return res.status(400).json({ ok: false, message: "FB_PAGE_ACCESS_TOKEN খালি রয়েছে!" });
    }
    try {
      const resp = await axios.get("https://graph.facebook.com/v21.0/me", {
        params: { fields: "id,name", access_token: token },
        timeout: 8000,
      });
      return res.json({
        ok: true,
        message: `ফেসবুক পেজ কানেকশন সফল! পেজের নাম: "${resp.data?.name || resp.data?.id}"`,
        data: resp.data,
      });
    } catch (fbErr) {
      return res.status(400).json({
        ok: false,
        message: "ফেসবুক টোকেন ইনভ্যালিড অথবা মেয়াদ শেষ: " + (fbErr.response?.data?.error?.message || fbErr.message),
      });
    }
  }

  if (type === "groq") {
    const apiKey = cfg.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ ok: false, message: "GROQ_API_KEY খালি রয়েছে!" });
    }
    try {
      const Groq = require("groq-sdk");
      const client = new Groq({ apiKey });
      const test = await client.chat.completions.create({
        model: cfg.MODEL || "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      });
      return res.json({
        ok: true,
        message: `Groq AI API কানেকশন সফল! (মডেল: ${cfg.MODEL || "openai/gpt-oss-120b"})`,
        data: test.choices?.[0]?.message?.content,
      });
    } catch (gErr) {
      return res.status(400).json({
        ok: false,
        message: "Groq API কী ইনভ্যালিড: " + gErr.message,
      });
    }
  }

  res.status(400).json({ ok: false, message: "অজানা টেস্ট টাইপ" });
});

module.exports = router;
