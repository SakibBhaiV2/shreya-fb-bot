const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    // platform + platform-specific user id (Facebook PSID বা web session)
    platform: { type: String, enum: ["facebook", "web"], required: true },
    externalId: { type: String, required: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: "" },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// একই Facebook user এর জন্য যেন duplicate না হয়
sessionSchema.index({ platform: 1, externalId: 1 }, { unique: true });

module.exports = mongoose.model("Session", sessionSchema);