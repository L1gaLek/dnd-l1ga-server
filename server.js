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
        broadcastUsers();
        logEvent(`${name} присоединился как ${role}`);
        break;
      }

      // ================= ИГРОВОЙ ЛОГИК =================
      case "resizeBoard":
        gameState.boardWidth = data.width;
        gameState.boardHeight = data.height;
        logEvent("Поле изменено");
        broadcast();
        break;

      case "addPlayer":
       gameState.players.push({
  id: data.player.id || uuidv4(),
  name: data.player.name,
  color: data.player.color,
  size: data.player.size,
  x: data.player.x ?? null,
  y: data.player.y ?? null,
  initiative: 0,
  owner: data.player.owner || null
});
        logEvent(`Игрок ${data.player.name} добавлен в список`);
        broadcast();
        break;

      case "movePlayer": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        p.x = data.x;
        p.y = data.y;
        logEvent(`${p.name} перемещен в (${p.x},${p.y})`);
        broadcast();
        break;
      }

      case "removePlayerFromBoard": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        p.x = null;
        p.y = null;
        logEvent(`${p.name} удален с поля`);
        broadcast();
        break;
      }

      case "removePlayerCompletely": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        gameState.players = gameState.players.filter(pl => pl.id !== data.id);
        gameState.turnOrder = gameState.turnOrder.filter(id => id !== data.id);
        logEvent(`Игрок ${p.name} полностью удален`);
        broadcast();
        break;
      }

      case "addWall":
        if (!gameState.walls.find(w => w.x === data.wall.x && w.y === data.wall.y)) {
          gameState.walls.push(data.wall);
          logEvent(`Стена добавлена (${data.wall.x},${data.wall.y})`);
          broadcast();
        }
        break;

      case "removeWall":
        gameState.walls = gameState.walls.filter(
          w => !(w.x === data.wall.x && w.y === data.wall.y)
        );
        logEvent(`Стена удалена (${data.wall.x},${data.wall.y})`);
        broadcast();
        break;

      case "rollInitiative":
        gameState.players.forEach(p => p.initiative = Math.floor(Math.random() * 20) + 1);
        gameState.turnOrder = [...gameState.players]
          .sort((a,b)=>b.initiative - a.initiative)
          .map(p=>p.id);
        gameState.currentTurnIndex = 0;
        logEvent("Инициатива брошена");
        broadcast();
        break;

      case "endTurn":
        if (gameState.turnOrder.length > 0) {
          gameState.currentTurnIndex =
            (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
          const currentId = gameState.turnOrder[gameState.currentTurnIndex];
          const current = gameState.players.find(p => p.id === currentId);
          logEvent(`Ход игрока ${current?.name || '-'}`);
          broadcast();
        }
        break;

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
        gameState.players = [];
        gameState.walls = [];
        gameState.turnOrder = [];
        gameState.currentTurnIndex = 0;
        gameState.log = ["Игра полностью сброшена"];
        logEvent("Сброс игры");
        broadcast();
        break;

      case "clearBoard":
        gameState.walls = [];
        logEvent("Доска очищена от стен");
        broadcast();
        break;

    }
  });

  ws.on("close", () => {
    // удаляем пользователя при отключении
    users = users.filter(u => u.ws !== ws);
    broadcastUsers();
  });
});

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server on", PORT));


