const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    // platform + platform-specific user id (Facebook PSID বা web session)
    platform: { type: String, enum: ["facebook", "web"], required: true },
    externalId: { type: String, required: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: "" },
    aiEnabled: { type: Boolean, default: true },
    userMessageCount: { type: Number, default: 0 },
    firstMessageHandled: { type: Boolean, default: false },
    nameCaptured: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// একই Facebook user এর জন্য যেন duplicate না হয়
sessionSchema.index({ platform: 1, externalId: 1 }, { unique: true });

const MongooseSession = mongoose.model("Session", sessionSchema);

// In-memory fallback when MongoDB is not connected
const memorySessions = new Map();

class InMemorySessionQuery {
  constructor(items) {
    this._items = [...items];
  }

  sort(sortObj = {}) {
    if (sortObj.lastActive === -1) {
      this._items.sort((a, b) => new Date(b.lastActive || b.createdAt) - new Date(a.lastActive || a.createdAt));
    } else if (sortObj.lastActive === 1) {
      this._items.sort((a, b) => new Date(a.lastActive || a.createdAt) - new Date(b.lastActive || b.createdAt));
    } else if (sortObj.createdAt === -1) {
      this._items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

class InMemorySession {
  constructor(data) {
    this.platform = data.platform;
    this.externalId = data.externalId;
    this.sessionId = data.sessionId;
    this.displayName = data.displayName || "";
    this.aiEnabled = data.aiEnabled !== undefined ? data.aiEnabled : true;
    this.userMessageCount = data.userMessageCount || 0;
    this.firstMessageHandled = Boolean(data.firstMessageHandled);
    this.nameCaptured = Boolean(data.nameCaptured);
    this.lastActive = data.lastActive || new Date();
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  async save() {
    this.updatedAt = new Date();
    memorySessions.set(this.sessionId, this);
    return this;
  }
}

const Session = {
  async create(data) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseSession.create(data);
    }
    const session = new InMemorySession(data);
    memorySessions.set(session.sessionId, session);
    return session;
  },

  find(query = {}) {
    if (mongoose.connection.readyState === 1) {
      return MongooseSession.find(query);
    }
    const items = Array.from(memorySessions.values()).filter((s) => {
      if (query.platform && s.platform !== query.platform) return false;
      return true;
    });
    return new InMemorySessionQuery(items);
  },

  async countDocuments(query = {}) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseSession.countDocuments(query);
    }
    const items = Array.from(memorySessions.values()).filter((s) => {
      if (query.platform && s.platform !== query.platform) return false;
      return true;
    });
    return items.length;
  },

  async findOne(query) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseSession.findOne(query);
    }
    if (query.sessionId) {
      return memorySessions.get(query.sessionId) || null;
    }
    if (query.platform && query.externalId) {
      for (const s of memorySessions.values()) {
        if (s.platform === query.platform && s.externalId === query.externalId) {
          return s;
        }
      }
    }
    return null;
  },

  schema: sessionSchema,
};

module.exports = Session;