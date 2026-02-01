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
  phase: "lobby", // lobby | initiative | placement | combat
  players: [],
  walls: [],
  turnOrder: [],
  currentTurnIndex: 0,
  log: []
};

// ================== USERS ==================
let users = []; // {id, name, role, ws}

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
  users.forEach(u => {
    if (u.ws.readyState === WebSocket.OPEN) u.ws.send(msg);
  });
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
  const u = getUser(ws);
  return u && u.role === "GM";
}

function ownsPlayer(ws, player) {
  const u = getUser(ws);
  return u && player.ownerId === u.id;
}

function autoPlacePlayers() {
  let x = 0;
  let y = 0;

  gameState.players.forEach(p => {
    p.x = x;
    p.y = y;
    x++;
    if (x >= gameState.boardWidth) {
      x = 0;
      y++;
    }
  });
}

// ================== WS ==================
wss.on("connection", ws => {

  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      // ---------- REGISTER ----------
      case "register": {
        if (data.role === "GM" && users.some(u => u.role === "GM")) {
          ws.send(JSON.stringify({ type:"error", message:"GM уже есть" }));
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

        broadcastUsers();
        broadcast();
        logEvent(`${user.name} вошел как ${user.role}`);
        break;
      }

      // ---------- ADD PLAYER ----------
      case "addPlayer": {
        const user = getUser(ws);
        if (!user) return;

        gameState.players.push({
          id: uuidv4(),
          name: data.player.name,
          color: data.player.color,
          size: data.player.size,
          x: null,
          y: null,
          initiative: null,
          hasRolledInitiative: false,
          ownerId: user.id,
          ownerName: user.name
        });

        logEvent(`Игрок ${data.player.name} создан`);
        broadcast();
        break;
      }

      // ---------- INITIATIVE PHASE ----------
      case "startInitiative": {
        if (!isGM(ws)) return;

        gameState.phase = "initiative";
        gameState.players.forEach(p => {
          p.initiative = null;
          p.hasRolledInitiative = false;
        });

        logEvent("GM начал фазу инициативы");
        broadcast();
        break;
      }

      case "rollInitiative": {
        if (gameState.phase !== "initiative") return;

        const user = getUser(ws);
        if (!user) return;

        gameState.players
          .filter(p => p.ownerId === user.id && !p.hasRolledInitiative)
          .forEach(p => {
            p.initiative = Math.floor(Math.random() * 20) + 1;
            p.hasRolledInitiative = true;
            logEvent(`${p.name} бросил инициативу: ${p.initiative}`);
          });

        broadcast();
        break;
      }

      case "finishInitiative": {
        if (!isGM(ws)) return;

        if (!gameState.players.every(p => p.hasRolledInitiative)) return;

        gameState.turnOrder = [...gameState.players]
          .sort((a,b)=>b.initiative-a.initiative)
          .map(p=>p.id);

        gameState.phase = "placement";
        logEvent("Все инициативы брошены. Фаза размещения");
        broadcast();
        break;
      }

      // ---------- COMBAT ----------
      case "startCombat": {
        if (!isGM(ws)) return;
        if (gameState.phase !== "placement") return;

        autoPlacePlayers();
        gameState.phase = "combat";
        gameState.currentTurnIndex = 0;

        const first = gameState.players.find(
          p => p.id === gameState.turnOrder[0]
        );

        logEvent(`Бой начался. Первый ход: ${first?.name}`);
        broadcast();
        break;
      }

      case "endTurn": {
        if (gameState.phase !== "combat") return;
        if (!isGM(ws)) return;

        gameState.currentTurnIndex =
          (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;

        const p = gameState.players.find(
          p => p.id === gameState.turnOrder[gameState.currentTurnIndex]
        );

        logEvent(`Ход игрока ${p?.name}`);
        broadcast();
        break;
      }

      // ---------- MOVE ----------
      case "movePlayer": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        if (!isGM(ws) && !ownsPlayer(ws,p)) return;

        if (gameState.phase === "combat") {
          const currentId = gameState.turnOrder[gameState.currentTurnIndex];
          if (p.id !== currentId) return;
        }

        p.x = data.x;
        p.y = data.y;
        broadcast();
        break;
      }

      // ---------- RESET ----------
      case "resetGame": {
        if (!isGM(ws)) return;

        gameState.players = [];
        gameState.walls = [];
        gameState.turnOrder = [];
        gameState.phase = "lobby";
        gameState.currentTurnIndex = 0;
        gameState.log = ["Игра сброшена"];
        broadcast();
        break;
      }
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
