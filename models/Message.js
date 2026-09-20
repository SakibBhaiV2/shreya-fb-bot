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

const MongooseMessage = mongoose.model("Message", messageSchema);

// In-memory store when MongoDB is not connected
const memoryMessages = [];

class InMemoryQuery {
  constructor(messages) {
    this._items = [...messages];
  }

  sort(sortObj = {}) {
    if (sortObj.createdAt === -1) {
      this._items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortObj.createdAt === 1) {
      this._items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    return this;
  }

  limit(count) {
    if (typeof count === "number") {
      this._items = this._items.slice(0, count);
    }
    return this;
  }

  lean() {
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this._items).then(resolve, reject);
  }
}

const Message = {
  async create(data) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseMessage.create(data);
    }
    const item = {
      sessionId: data.sessionId,
      role: data.role,
      content: data.content,
      source: data.source || "messenger",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryMessages.push(item);
    return item;
  },

  find(query = {}) {
    if (mongoose.connection.readyState === 1) {
      return MongooseMessage.find(query);
    }
    const filtered = memoryMessages.filter((m) => {
      if (query.sessionId && m.sessionId !== query.sessionId) return false;
      return true;
    });
    return new InMemoryQuery(filtered);
  },

  async countDocuments(query = {}) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseMessage.countDocuments(query);
    }
    const filtered = memoryMessages.filter((m) => {
      if (query.sessionId && m.sessionId !== query.sessionId) return false;
      return true;
    });
    return filtered.length;
  },

  schema: messageSchema,
};

module.exports = Message;