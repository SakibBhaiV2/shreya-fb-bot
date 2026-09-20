const { WebSocketServer } = require("ws");

let wss = null;
const clients = new Set();
const sseClients = new Set();

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    clients.add(ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", time: Date.now() }));
        }
      } catch {}
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });

    // Send initial connected event
    ws.send(JSON.stringify({ type: "connected", time: Date.now() }));
  });

  // Keep-alive ping interval
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

function broadcast(type, payload = {}) {
  const messageStr = JSON.stringify({ type, payload, timestamp: Date.now() });

  // 1. Send via WebSocket
  if (wss && wss.clients) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(messageStr);
        } catch (err) {
          console.error("WS send error:", err);
        }
      }
    });
  }

  // 2. Send via SSE clients (if any)
  sseClients.forEach((res) => {
    try {
      res.write(`data: ${messageStr}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  });
}

function registerSseClient(res) {
  sseClients.add(res);
  res.on("close", () => {
    sseClients.delete(res);
  });
}

module.exports = {
  initWebSocket,
  broadcast,
  registerSseClient,
};
