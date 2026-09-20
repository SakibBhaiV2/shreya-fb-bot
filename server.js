require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { initWebSocket } = require("./services/realtime");

const webhookRouter = require("./routes/webhook");
const chatRouter = require("./routes/chat");
const adminRouter = require("./routes/admin");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.warn("⚠️  MONGODB_URI missing — using in-memory store for sessions and messages");
}
if (!process.env.GROQ_API_KEY) {
  console.warn("⚠️  GROQ_API_KEY missing — AI replies will use fallback responses until configured");
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
    dbConnected: mongoose.connection.readyState === 1,
    time: new Date().toISOString(),
  });
});

// Facebook webhook (GET verify + POST events)
app.use("/", webhookRouter);

// লোকাল টেস্ট API
app.use("/api", chatRouter);

// এডমিন ড্যাশবোর্ড API
app.use("/api/admin", adminRouter);

// Database offline fallback error handler
app.use((err, req, res, next) => {
  if (
    err.name === "MongooseError" ||
    err.name === "MongoNetworkError" ||
    (err.message && err.message.includes("buffering timed out"))
  ) {
    console.warn("[AI Studio] Database offline — returning mock empty response");
    if (req.method === "GET") {
      return res.json(req.path.endsWith("s") || req.path.endsWith("s/") ? [] : {});
    }
    return res.status(503).json({ error: "Service temporarily unavailable (database offline)" });
  }
  next(err);
});

// Fallback: index.html serve করো
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Fail fast for Mongoose operations instead of hanging
mongoose.set("bufferCommands", false);

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
      console.log("✅ MongoDB connected");
      try {
        const { loadConfigFromDb } = require("./services/config");
        await loadConfigFromDb();
      } catch (e) {
        console.warn("⚠️ Error loading config from MongoDB:", e.message);
      }
    })
    .catch((err) =>
      console.warn("⚠️ MongoDB connection failed — using in-memory store:", err.message)
    );
}

const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server on http://0.0.0.0:${PORT}`);
  console.log(`   Webhook URL:  /webhook`);
  console.log(`   Admin panel:  http://0.0.0.0:${PORT}/`);
  console.log(`   WebSocket on: ws://0.0.0.0:${PORT}/ws`);
});