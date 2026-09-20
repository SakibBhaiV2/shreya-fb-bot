const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ENV_FILE_PATH = path.join(__dirname, "..", ".env");

// Default settings state initialized from process.env
const settings = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "Sakib@7890",
  FB_PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN || "",
  FB_VERIFY_TOKEN: process.env.FB_VERIFY_TOKEN || "",
  FB_APP_SECRET: process.env.FB_APP_SECRET || "",
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  MODEL: process.env.MODEL || "openai/gpt-oss-120b",
  MAX_HISTORY: process.env.MAX_HISTORY || "30",
  MONGODB_URI: process.env.MONGODB_URI || "",
  FIRST_MSG_AI_DISABLED: process.env.FIRST_MSG_AI_DISABLED !== "false", // default true: pause AI on 1st msg to allow Meta automation name echo
};

function isFirstMessageAiDisabled() {
  return settings.FIRST_MSG_AI_DISABLED !== false;
}

function getConfig() {
  return {
    ...settings,
    hasFbToken: Boolean(settings.FB_PAGE_ACCESS_TOKEN),
    hasFbSecret: Boolean(settings.FB_APP_SECRET),
    hasFbVerifyToken: Boolean(settings.FB_VERIFY_TOKEN),
    hasGroqKey: Boolean(settings.GROQ_API_KEY),
    hasMongoUri: Boolean(settings.MONGODB_URI),
  };
}

function getSafeConfig() {
  return {
    ADMIN_PASSWORD: settings.ADMIN_PASSWORD ? "••••••••" : "",
    FB_PAGE_ACCESS_TOKEN: settings.FB_PAGE_ACCESS_TOKEN
      ? settings.FB_PAGE_ACCESS_TOKEN.slice(0, 10) + "..." + settings.FB_PAGE_ACCESS_TOKEN.slice(-6)
      : "",
    FB_VERIFY_TOKEN: settings.FB_VERIFY_TOKEN,
    FB_APP_SECRET: settings.FB_APP_SECRET
      ? settings.FB_APP_SECRET.slice(0, 4) + "••••••••"
      : "",
    GROQ_API_KEY: settings.GROQ_API_KEY
      ? settings.GROQ_API_KEY.slice(0, 6) + "..." + settings.GROQ_API_KEY.slice(-4)
      : "",
    MODEL: settings.MODEL,
    MAX_HISTORY: settings.MAX_HISTORY,
    MONGODB_URI: settings.MONGODB_URI
      ? settings.MONGODB_URI.replace(/:([^@]+)@/, ":••••••@")
      : "",
    FIRST_MSG_AI_DISABLED: settings.FIRST_MSG_AI_DISABLED,
    hasFbToken: Boolean(settings.FB_PAGE_ACCESS_TOKEN),
    hasFbSecret: Boolean(settings.FB_APP_SECRET),
    hasFbVerifyToken: Boolean(settings.FB_VERIFY_TOKEN),
    hasGroqKey: Boolean(settings.GROQ_API_KEY),
    hasMongoUri: Boolean(settings.MONGODB_URI),
  };
}

// Load config from MongoDB when DB connects
async function loadConfigFromDb() {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const SystemConfig = require("../models/SystemConfig");
    const doc = await SystemConfig.findOne({ key: "active_config" });
    if (doc) {
      if (doc.ADMIN_PASSWORD) settings.ADMIN_PASSWORD = doc.ADMIN_PASSWORD;
      if (doc.FB_PAGE_ACCESS_TOKEN) settings.FB_PAGE_ACCESS_TOKEN = doc.FB_PAGE_ACCESS_TOKEN;
      if (doc.FB_VERIFY_TOKEN) settings.FB_VERIFY_TOKEN = doc.FB_VERIFY_TOKEN;
      if (doc.FB_APP_SECRET) settings.FB_APP_SECRET = doc.FB_APP_SECRET;
      if (doc.GROQ_API_KEY) settings.GROQ_API_KEY = doc.GROQ_API_KEY;
      if (doc.MODEL) settings.MODEL = doc.MODEL;
      if (doc.MAX_HISTORY) settings.MAX_HISTORY = doc.MAX_HISTORY;
      if (doc.MONGODB_URI && !settings.MONGODB_URI) settings.MONGODB_URI = doc.MONGODB_URI;
      if (doc.FIRST_MSG_AI_DISABLED !== undefined) settings.FIRST_MSG_AI_DISABLED = doc.FIRST_MSG_AI_DISABLED;

      // Sync into process.env as well
      process.env.ADMIN_PASSWORD = settings.ADMIN_PASSWORD;
      process.env.FB_PAGE_ACCESS_TOKEN = settings.FB_PAGE_ACCESS_TOKEN;
      process.env.FB_VERIFY_TOKEN = settings.FB_VERIFY_TOKEN;
      process.env.FB_APP_SECRET = settings.FB_APP_SECRET;
      process.env.GROQ_API_KEY = settings.GROQ_API_KEY;
      process.env.MODEL = settings.MODEL;
      process.env.MAX_HISTORY = settings.MAX_HISTORY;

      if (doc.SYSTEM_PROMPT) {
        try {
          const { setSystemPrompt } = require("./groq");
          setSystemPrompt(doc.SYSTEM_PROMPT);
        } catch {}
      }
      console.log("✅ System configuration & prompt loaded from MongoDB");
    }
  } catch (err) {
    console.warn("⚠️ Could not load config from MongoDB:", err.message);
  }
}

// Save config to MongoDB
async function saveConfigToDb(extra = {}) {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const SystemConfig = require("../models/SystemConfig");
    const updateData = {
      ADMIN_PASSWORD: settings.ADMIN_PASSWORD,
      FB_PAGE_ACCESS_TOKEN: settings.FB_PAGE_ACCESS_TOKEN,
      FB_VERIFY_TOKEN: settings.FB_VERIFY_TOKEN,
      FB_APP_SECRET: settings.FB_APP_SECRET,
      GROQ_API_KEY: settings.GROQ_API_KEY,
      MODEL: settings.MODEL,
      MAX_HISTORY: settings.MAX_HISTORY,
      MONGODB_URI: settings.MONGODB_URI,
      FIRST_MSG_AI_DISABLED: settings.FIRST_MSG_AI_DISABLED,
      ...extra,
    };

    await SystemConfig.findOneAndUpdate(
      { key: "active_config" },
      { $set: updateData },
      { upsert: true, new: true }
    );
    console.log("✅ Configuration successfully persisted to MongoDB");
  } catch (err) {
    console.warn("⚠️ Could not persist config to MongoDB:", err.message);
  }
}

async function updateConfig(newValues = {}) {
  const oldMongoUri = settings.MONGODB_URI;

  for (const [key, value] of Object.entries(newValues)) {
    if (value !== undefined) {
      if (key === "FIRST_MSG_AI_DISABLED") {
        settings.FIRST_MSG_AI_DISABLED = Boolean(value);
        continue;
      }
      if (typeof value === "string") {
        // Don't overwrite if masked value was sent back
        if (value.includes("••••") || value.includes("...")) continue;
        const cleanVal = value.trim();
        settings[key] = cleanVal;
        process.env[key] = cleanVal;
      }
    }
  }

  // Persist to .env file if writable
  try {
    const lines = [
      `ADMIN_PASSWORD=${settings.ADMIN_PASSWORD}`,
      `FB_PAGE_ACCESS_TOKEN=${settings.FB_PAGE_ACCESS_TOKEN}`,
      `FB_VERIFY_TOKEN=${settings.FB_VERIFY_TOKEN}`,
      `FB_APP_SECRET=${settings.FB_APP_SECRET}`,
      `GROQ_API_KEY=${settings.GROQ_API_KEY}`,
      `MODEL=${settings.MODEL}`,
      `MAX_HISTORY=${settings.MAX_HISTORY}`,
      `MONGODB_URI=${settings.MONGODB_URI}`,
      `FIRST_MSG_AI_DISABLED=${settings.FIRST_MSG_AI_DISABLED}`,
    ];
    fs.writeFileSync(ENV_FILE_PATH, lines.join("\n") + "\n", "utf8");
  } catch (err) {
    // Expected in read-only / containerized environments like Render
  }

  // Persist to MongoDB
  await saveConfigToDb();

  // If MONGODB_URI changed and is now provided, trigger connection
  if (settings.MONGODB_URI && settings.MONGODB_URI !== oldMongoUri) {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
      }
      await mongoose.connect(settings.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      console.log("✅ Reconnected to updated MongoDB URI");
      await saveConfigToDb();
    } catch (dbErr) {
      console.warn("⚠️ Failed connecting to new MongoDB URI:", dbErr.message);
    }
  }

  return getConfig();
}

module.exports = {
  getConfig,
  getSafeConfig,
  updateConfig,
  loadConfigFromDb,
  saveConfigToDb,
  isFirstMessageAiDisabled,
};
