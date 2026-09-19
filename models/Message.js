const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    source: { type: String, default: "messenger" }, // messenger | comment | web
  },
  { timestamps: true }
);

messageSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);