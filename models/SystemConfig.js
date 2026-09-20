const mongoose = require("mongoose");

const systemConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "active_config" },
    ADMIN_PASSWORD: { type: String, default: "Sakib@7890" },
    FB_PAGE_ACCESS_TOKEN: { type: String, default: "" },
    FB_VERIFY_TOKEN: { type: String, default: "" },
    FB_APP_SECRET: { type: String, default: "" },
    GROQ_API_KEY: { type: String, default: "" },
    MODEL: { type: String, default: "openai/gpt-oss-120b" },
    MAX_HISTORY: { type: String, default: "30" },
    MONGODB_URI: { type: String, default: "" },
    SYSTEM_PROMPT: { type: String, default: "" },
    FIRST_MSG_AI_DISABLED: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const MongooseSystemConfig = mongoose.model("SystemConfig", systemConfigSchema);

module.exports = MongooseSystemConfig;
