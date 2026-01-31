// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

// ================== EXPRESS ==================
const app = express();
app.use(express.static("public"));
const server = http.createServer(app);

// ================== WEBSOCKET ==================
const wss = new WebSocket.Server({ server });

// ================== GAME STATE ==================
let gameState = {
  boardWidth: 10,
  boardHeight: 10,
  players: [],
  walls: [],
  turnOrder: [],
  currentTurnIndex: 0,
  log: []
};

// ================== USERS ==================
let users = []; // {id, name, role, ws}

// ================== HELPERS ==================
function sendFullState(ws) {
  ws.send(JSON.stringify({
    type: "init",
    state: gameState
  }));

  ws.send(JSON.stringify({
    type: "users",
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      role: u.role
    }))
  }));
}

function broadcastState() {
  const msg = JSON.stringify({ type: "state", state: gameState });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function broadcastUsers() {
  const msg = JSON.stringify({
    type: "users",
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      role: u.role
    }))
  });

  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function logEvent(text) {
  const time = new Date().toLocaleTimeString();
  gameState.log.push(`${time} — ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

// ================== WS ==================
wss.on("connection", ws => {

  // 🔑 СРАЗУ шлём полное состояние
  sendFullState(ws);

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      // ===== REG =====
      case "register": {
        if (data.role === "GM" && users.some(u => u.role === "GM")) {
          ws.send(JSON.stringify({ type: "error", message: "GM уже существует" }));
          return;
        }

        const user = {
          id: uuidv4(),
          name: data.name,
          role: data.role,
          ws
        };

        users.push(user);

        ws.send(JSON.stringify({
          type: "registered",
          id: user.id,
          name: user.name,
          role: user.role
        }));

        logEvent(`${user.name} подключился (${user.role})`);

        // 🔑 ОБЯЗАТЕЛЬНО
        sendFullState(ws);
        broadcastUsers();
        broadcastState();
        break;
      }

      // ===== GAME =====
      case "addPlayer": {
        const owner = users.find(u => u.ws === ws);
        if (!owner) return;

        gameState.players.push({
          id: uuidv4(),
          name: data.player.name,
          color: data.player.color,
          size: data.player.size,
          x: null,
          y: null,
          initiative: 0,
          ownerId: owner.id,
          ownerName: owner.name
        });

        logEvent(`Игрок ${data.player.name} создан (${owner.name})`);
        broadcastState();
        break;
      }

      case "movePlayer": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        p.x = data.x;
        p.y = data.y;
        broadcastState();
        break;
      }

      case "addWall":
        if (!gameState.walls.some(w => w.x === data.wall.x && w.y === data.wall.y)) {
          gameState.walls.push(data.wall);
          broadcastState();
        }
        break;

      case "rollInitiative":
        gameState.players.forEach(p => p.initiative = Math.floor(Math.random() * 20) + 1);
        gameState.turnOrder = [...gameState.players]
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);
        gameState.currentTurnIndex = 0;
        broadcastState();
        break;
    }
  });

  ws.on("close", () => {
    users = users.filter(u => u.ws !== ws);
    broadcastUsers();
  });
});

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server on", PORT));
