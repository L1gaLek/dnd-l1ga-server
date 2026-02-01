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
  phase: "lobby",
  players: [],      // {id, name, color, size, x, y, initiative, ownerId, ownerName, isBase}
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
        broadcast();
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

      case "addPlayer": {
        const user = users.find(u => u.ws === ws);
        if (!user) return;

        const isBase = !!data.player?.isBase;

// ✅ Основа может быть только одна НА ПОЛЬЗОВАТЕЛЯ
if (isBase) {
  const baseAlreadyExistsForOwner = gameState.players.some(
    p => p.isBase && p.ownerId === user.id
  );
  if (baseAlreadyExistsForOwner) {
    ws.send(JSON.stringify({
      type: "error",
      message: "У вас уже есть Основа. Можно иметь только одну основу на пользователя."
    }));
    return;
  }
}

        gameState.players.push({
          id: data.player.id || uuidv4(),
          name: data.player.name,
          color: data.player.color,
          size: data.player.size,
          x: null,
          y: null,
          initiative: 0,

          isBase,

          // 🔑 СВЯЗЬ С УНИКАЛЬНЫМ ПОЛЬЗОВАТЕЛЕМ
          ownerId: user.id,
          ownerName: user.name
        });

        logEvent(`Игрок ${data.player.name} создан пользователем ${user.name}${isBase ? " (Основа)" : ""}`);
        broadcast();
        break;
      }

      case "movePlayer": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;

        const gm = isGM(ws);
        const owner = ownsPlayer(ws, p);

        // права: GM всегда может, владелец — только своих
        if (!gm && !owner) return;

        // В бою НЕ-GM может двигать:
        // 1) своего персонажа, если сейчас его ход
        // 2) или своего персонажа, если он ещё не выставлен на поле (x/y null)
        if (gameState.phase === "combat" && !gm) {
          const currentId = gameState.turnOrder[gameState.currentTurnIndex];
          const notPlacedYet = (p.x === null || p.y === null);
          if (p.id !== currentId && !notPlacedYet) return;
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

      case "log": {
        if (typeof data.text === "string" && data.text.trim()) {
          logEvent(data.text.trim());
          broadcast();
        }
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

      case "rollInitiative": {
        if (gameState.phase !== "initiative") return;

        const user = getUserByWS(ws);
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

        const allRolled = gameState.players.every(p => p.hasRolledInitiative);
        if (!allRolled) return;

        gameState.turnOrder = [...gameState.players]
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);

        gameState.phase = "placement";
        logEvent("Все инициативы определены. Фаза размещения");
        broadcast();
        break;
      }

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

      case "endTurn":
        if (!isGM(ws)) return;

        if (gameState.turnOrder.length > 0) {
          gameState.currentTurnIndex =
            (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
          const currentId = gameState.turnOrder[gameState.currentTurnIndex];
          const current = gameState.players.find(p => p.id === currentId);
          logEvent(`Ход игрока ${current?.name || '-'}`);
          broadcast();
        }
        break;

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
        gameState.players.forEach(p => {
          p.x = null;
          p.y = null;
        });

        logEvent("Поле очищено: стены удалены, все персонажи убраны с поля");
        broadcast();
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

function autoPlacePlayers() {
  let x = 0;
  let y = 0;

  gameState.players.forEach(p => {
    if (p.x !== null && p.y !== null) return;

    p.x = x;
    p.y = y;

    x++;
    if (x >= gameState.boardWidth) {
      x = 0;
      y++;
    }
  });
}

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server on", PORT));

