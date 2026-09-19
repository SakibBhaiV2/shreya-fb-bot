require("dotenv").config();

const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const webhookRouter = require("./routes/webhook");
const chatRouter = require("./routes/chat");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI missing");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY missing");
  process.exit(1);
}
if (!process.env.FB_PAGE_ACCESS_TOKEN) {
  console.warn("⚠️  FB_PAGE_ACCESS_TOKEN missing — Facebook-এ reply যাবে না");
}
if (!process.env.FB_VERIFY_TOKEN) {
  console.warn("⚠️  FB_VERIFY_TOKEN missing — webhook verify হবে না");
}

const app = express();
app.use(cors());

// ⚠️ Facebook signature verify করার জন্য raw body দরকার
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// টেস্ট চ্যাট UI (public/index.html)
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: process.env.MODEL || "openai/gpt-oss-120b",
    time: new Date().toISOString(),
  });
});

// Facebook webhook (GET verify + POST events)
app.use("/", webhookRouter);

// লোকাল টেস্ট API
app.use("/api", chatRouter);

// Fallback: index.html serve করো
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("✅ MongoDB connected");
    app.listen(PORT, () => {
      console.log(`🚀 Server on http://localhost:${PORT}`);
      console.log(`   Webhook URL:  /webhook`);
      console.log(`   Test chat UI: http://localhost:${PORT}/`);
    });
  } catch (err) {
    console.error("❌ Mongo error:", err.message);
    process.exit(1);
  }
}

start();