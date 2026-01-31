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
let users = [];

// ================== HELPERS ==================
function broadcast() {
  const msg = JSON.stringify({ type: "state", state: gameState });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function broadcastUsers() {
  const msg = JSON.stringify({
    type: "users",
    users: users.map(u => ({ id: u.id, name: u.name, role: u.role }))
  });
  users.forEach(u => u.ws.readyState === WebSocket.OPEN && u.ws.send(msg));
}

function logEvent(text) {
  const time = new Date().toLocaleTimeString();
  gameState.log.push(`${time} — ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

function getUser(ws) {
  return users.find(u => u.ws === ws);
}

function isGM(ws) {
  return getUser(ws)?.role === "GM";
}

function ownsPlayer(ws, player) {
  return getUser(ws)?.id === player.ownerId;
}

function getCurrentPlayerId() {
  return gameState.turnOrder[gameState.currentTurnIndex] || null;
}

// ================== WS ==================
wss.on("connection", ws => {

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      // ===== REGISTER =====
      case "register": {
        if (data.role === "GM" && users.some(u => u.role === "GM")) {
          ws.send(JSON.stringify({ type: "error", message: "GM уже существует" }));
          return;
        }

        const id = uuidv4();
        users.push({ id, name: data.name, role: data.role, ws });

        ws.send(JSON.stringify({ type: "registered", id, name: data.name, role: data.role }));
        sendFullSync(ws);
        broadcastUsers();
        broadcast();
        logEvent(`${data.name} вошёл как ${data.role}`);
        break;
      }

      // ===== ADD PLAYER =====
      case "addPlayer": {
        const u = getUser(ws);
        if (!u) return;

        gameState.players.push({
          id: uuidv4(),
          ...data.player,
          x: null,
          y: null,
          initiative: null,
          ownerId: u.id,
          ownerName: u.name
        });

        logEvent(`Игрок ${data.player.name} создан (${u.name})`);
        broadcast();
        break;
      }

      // ===== MOVE PLAYER =====
      case "movePlayer": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;

        const currentId = getCurrentPlayerId();

        if (!isGM(ws)) {
          if (!ownsPlayer(ws, p)) return;
          if (p.id !== currentId) return;
        }

        p.x = data.x;
        p.y = data.y;
        broadcast();
        break;
      }

      // ===== ROLL INITIATIVE (ONE PLAYER) =====
      case "rollInitiative": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;

        if (!isGM(ws) && !ownsPlayer(ws, p)) return;

        p.initiative = Math.floor(Math.random() * 20) + 1;
        logEvent(`${p.name} бросил инициативу: ${p.initiative}`);

        gameState.turnOrder = [...gameState.players]
          .filter(p => p.initiative !== null)
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);

        if (gameState.currentTurnIndex >= gameState.turnOrder.length) {
          gameState.currentTurnIndex = 0;
        }

        broadcast();
        break;
      }

      // ===== END TURN =====
      case "endTurn": {
        const currentId = getCurrentPlayerId();
        const current = gameState.players.find(p => p.id === currentId);
        if (!current) return;

        if (!isGM(ws) && !ownsPlayer(ws, current)) return;

        gameState.currentTurnIndex =
          (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;

        const next = gameState.players.find(p => p.id === getCurrentPlayerId());
        logEvent(`Ход → ${next?.name || "-"}`);
        broadcast();
        break;
      }

      // ===== WALLS / RESET (GM ONLY) =====
      case "addWall":
      case "removeWall":
      case "resizeBoard":
      case "resetGame":
      case "clearBoard":
        if (!isGM(ws)) return;
        // логика без изменений
        break;
    }
  });

  ws.on("close", () => {
    users = users.filter(u => u.ws !== ws);
    broadcastUsers();
    broadcast();
  });
});

function sendFullSync(ws) {
  ws.send(JSON.stringify({ type: "init", state: gameState }));
  ws.send(JSON.stringify({
    type: "users",
    users: users.map(u => ({ id: u.id, name: u.name, role: u.role }))
  }));
}

// ================== START ==================
server.listen(10000, () => console.log("🟢 Server on 10000"));
