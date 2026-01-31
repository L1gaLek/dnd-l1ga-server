// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid"); // уникальные id

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
  players: [],      // {id, name, color, size, x, y, initiative}
  walls: [],        // {x, y}
  turnOrder: [],    // массив id игроков по инициативе
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
  const userList = users.map(u => ({ id: u.id, name: u.name, role: u.role }));
  const msg = JSON.stringify({ type: "users", users: userList });
  users.forEach(u => {
    if (u.ws.readyState === WebSocket.OPEN) u.ws.send(msg);
  });
}

function logEvent(text) {
  const time = new Date().toLocaleTimeString();
  gameState.log.push(`${time} — ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

function getUserByWS(ws) {
  return users.find(u => u.ws === ws);
}

function isGM(ws) {
  const u = getUserByWS(ws);
  return u && u.role === "GM";
}

function ownsPlayer(ws, player) {
  const u = getUserByWS(ws);
  return u && player.ownerId === u.id;
}

function getCurrentPlayerId() {
  return gameState.turnOrder[gameState.currentTurnIndex] || null;
}

// ================== WS HANDLERS ==================
wss.on("connection", ws => {
  // Инициализация у нового клиента
  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      // ================= РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ =================
      case "register": {
        const { name, role } = data;

        if (!name || !role) {
          ws.send(JSON.stringify({ type: "error", message: "Имя и роль обязательны" }));
          return;
        }

        // Только один GM
        if (role === "GM" && users.some(u => u.role === "GM")) {
          ws.send(JSON.stringify({ type: "error", message: "GM уже существует" }));
          return;
        }

        const id = uuidv4();
        users.push({ id, name, role, ws });

ws.send(JSON.stringify({ type: "registered", id, role, name }));

// 🔑 ПОЛНАЯ СИНХРОНИЗАЦИЯ ТОЛЬКО ЭТОМУ КЛИЕНТУ
sendFullSync(ws);

// остальные — как и раньше
broadcastUsers();
broadcast(); // ← ДОБАВИТЬ
logEvent(`${name} присоединился как ${role}`);
break;
      }

      // ================= ИГРОВОЙ ЛОГИК =================
case "resizeBoard":
  if (!isGM(ws)) return;

  gameState.boardWidth = data.width;
  gameState.boardHeight = data.height;
  logEvent("Поле изменено");
  broadcast();
  break;

      case "addPlayer": {
  const user = users.find(u => u.ws === ws);
  if (!user) return;

  gameState.players.push({
    id: data.player.id || uuidv4(),
    name: data.player.name,
    color: data.player.color,
    size: data.player.size,
    x: null,
    y: null,
    initiative: null,

    // 🔑 СВЯЗЬ С УНИКАЛЬНЫМ ПОЛЬЗОВАТЕЛЕМ
    ownerId: user.id,
    ownerName: user.name
  });

  logEvent(`Игрок ${data.player.name} создан пользователем ${user.name}`);
  broadcast();
  break;
}

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
  logEvent(`${p.name} перемещен в (${p.x},${p.y})`);
  broadcast();
  break;
}

case "removePlayerFromBoard": {
  const p = gameState.players.find(p => p.id === data.id);
  if (!p) return;

  if (!isGM(ws) && !ownsPlayer(ws, p)) return;

  p.x = null;
  p.y = null;
  logEvent(`${p.name} удален с поля`);
  broadcast();
  break;
}

case "removePlayerCompletely": {
  const p = gameState.players.find(p => p.id === data.id);
  if (!p) return;

  if (!isGM(ws) && !ownsPlayer(ws, p)) return;

  gameState.players = gameState.players.filter(pl => pl.id !== data.id);
  gameState.turnOrder = gameState.turnOrder.filter(id => id !== data.id);
  logEvent(`Игрок ${p.name} полностью удален`);
  broadcast();
  break;
}

case "addWall":
  if (!isGM(ws)) return;

  if (!gameState.walls.find(w => w.x === data.wall.x && w.y === data.wall.y)) {
    gameState.walls.push(data.wall);
    logEvent(`Стена добавлена (${data.wall.x},${data.wall.y})`);
    broadcast();
  }
  break;

case "removeWall":
  if (!isGM(ws)) return;

  gameState.walls = gameState.walls.filter(
    w => !(w.x === data.wall.x && w.y === data.wall.y)
  );
  logEvent(`Стена удалена (${data.wall.x},${data.wall.y})`);
  broadcast();
  break;

  { type: "rollInitiative", id: playerId }      

case "rollInitiative": {
  const p = gameState.players.find(p => p.id === data.id);
  if (!p) return;

  // права
  if (!isGM(ws) && !ownsPlayer(ws, p)) return;

  // бросок
  p.initiative = Math.floor(Math.random() * 20) + 1;
  logEvent(`${p.name} бросил инициативу: ${p.initiative}`);

  // пересобираем очередь ТОЛЬКО из тех, кто кинул
  gameState.turnOrder = gameState.players
    .filter(pl => pl.initiative !== null)
    .sort((a, b) => b.initiative - a.initiative)
    .map(pl => pl.id);

  // защита индекса
  if (gameState.currentTurnIndex >= gameState.turnOrder.length) {
    gameState.currentTurnIndex = 0;
  }

  broadcast();
  break;
}

ccase "endTurn": {
  const currentId = getCurrentPlayerId();
  const current = gameState.players.find(p => p.id === currentId);
  if (!current) return;

  // может пропустить только текущий игрок или GM
  if (!isGM(ws) && !ownsPlayer(ws, current)) return;

  gameState.currentTurnIndex =
    (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;

  const next = gameState.players.find(
    p => p.id === getCurrentPlayerId()
  );

  logEvent(`Ход переходит к ${next?.name || "-"}`);
  broadcast();
  break;
}

      case "rollDice": {
        const sides = data.sides || 6;
        const roller = gameState.players.find(p => p.id === data.id);
        if (roller) {
          const result = Math.floor(Math.random() * sides) + 1;
          logEvent(`${roller.name} бросил d${sides}: ${result}`);
          broadcast();
        }
        break;
      }

case "resetGame":
  if (!isGM(ws)) return;

  gameState.players = [];
  gameState.walls = [];
  gameState.turnOrder = [];
  gameState.currentTurnIndex = 0;
  gameState.log = ["Игра полностью сброшена"];
  broadcast();
  break;

case "clearBoard":
  if (!isGM(ws)) return;

  gameState.walls = [];
  logEvent("Доска очищена от стен");
  broadcast();
  break;

    }
  });

ws.on("close", () => {
  users = users.filter(u => u.ws !== ws);
  broadcastUsers();
  broadcast(); // чтобы все пересинхронизировались
});
});

function sendFullSync(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;

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

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server on", PORT));

