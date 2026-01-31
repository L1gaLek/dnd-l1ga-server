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
let users = []; // { id, name, role, ws }

// ================== HELPERS ==================
function broadcastState() {
  const msg = JSON.stringify({ type: "state", state: gameState });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function broadcastUsers() {
  const list = users.map(u => ({ id: u.id, name: u.name, role: u.role }));
  const msg = JSON.stringify({ type: "users", users: list });
  users.forEach(u => {
    if (u.ws.readyState === WebSocket.OPEN) u.ws.send(msg);
  });
}

function logEvent(text) {
  const time = new Date().toLocaleTimeString();
  gameState.log.push(`${time} — ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

// ================== WS ==================
wss.on("connection", ws => {

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {

      // ---------- REGISTER ----------
      case "register": {
        const { name, role } = data;
        if (!name || !role) return;

        if (role === "GM" && users.some(u => u.role === "GM")) {
          ws.send(JSON.stringify({ type: "error", message: "GM уже существует" }));
          return;
        }

        const id = uuidv4();
        users.push({ id, name, role, ws });

        ws.send(JSON.stringify({ type: "registered", id, name, role }));

        // 🔑 КРИТИЧЕСКИ ВАЖНО
        ws.send(JSON.stringify({ type: "init", state: gameState }));
        broadcastUsers();
        logEvent(`${name} подключился как ${role}`);
        broadcastState();
        break;
      }

      // ---------- BOARD ----------
      case "resizeBoard":
        gameState.boardWidth = data.width;
        gameState.boardHeight = data.height;
        logEvent("Размер поля изменён");
        broadcastState();
        break;

      // ---------- PLAYERS ----------
      case "addPlayer": {
        const user = users.find(u => u.ws === ws);
        if (!user) return;

        gameState.players.push({
          id: uuidv4(),
          name: data.player.name,
          color: data.player.color,
          size: data.player.size,
          x: null,
          y: null,
          initiative: 0,
          ownerId: user.id,
          ownerName: user.name
        });

        logEvent(`Игрок ${data.player.name} создан (${user.name})`);
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

      case "removePlayerFromBoard": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        p.x = null;
        p.y = null;
        broadcastState();
        break;
      }

      case "removePlayerCompletely":
        gameState.players = gameState.players.filter(p => p.id !== data.id);
        gameState.turnOrder = gameState.turnOrder.filter(id => id !== data.id);
        broadcastState();
        break;

      // ---------- WALLS ----------
      case "addWall":
        if (!gameState.walls.find(w => w.x === data.wall.x && w.y === data.wall.y)) {
          gameState.walls.push(data.wall);
          broadcastState();
        }
        break;

      case "removeWall":
        gameState.walls = gameState.walls.filter(
          w => !(w.x === data.wall.x && w.y === data.wall.y)
        );
        broadcastState();
        break;

      // ---------- INITIATIVE ----------
      case "rollInitiative":
        gameState.players.forEach(p => p.initiative = Math.floor(Math.random() * 20) + 1);
        gameState.turnOrder = [...gameState.players]
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);
        gameState.currentTurnIndex = 0;
        broadcastState();
        break;

      case "endTurn":
        if (gameState.turnOrder.length) {
          gameState.currentTurnIndex =
            (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
          broadcastState();
        }
        break;

      // ---------- RESET ----------
      case "resetGame":
        gameState.players = [];
        gameState.walls = [];
        gameState.turnOrder = [];
        gameState.currentTurnIndex = 0;
        gameState.log = ["Игра сброшена"];
        broadcastState();
        break;
    }
  });

  ws.on("close", () => {
    users = users.filter(u => u.ws !== ws);
    broadcastUsers();
    broadcastState(); // 🔑 ОБЯЗАТЕЛЬНО
  });
});

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server running on", PORT));
