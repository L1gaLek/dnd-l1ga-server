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

// ================== WS HANDLERS ==================
wss.on("connection", ws => {
  // Инициализация у нового клиента
  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

        case "readyForCombat": {
  if (gameState.phase !== "combat") return;

  const user = getUserByWS(ws);
  if (!user) return;

  const gm = isGM(ws);
  const currentId = gameState.turnOrder?.[gameState.currentTurnIndex] ?? null;

  // Берём всех pending этого пользователя (или всех, если GM)
  const toReady = gameState.players.filter(p => {
    if (!p.pendingJoinCombat) return false;
    if (!gm && p.ownerId !== user.id) return false;
    // надо чтобы была инициатива и размещение
    if (!p.hasRolledInitiative || p.initiative === null) return false;
    if (p.x === null || p.y === null) return false;
    return true;
  });

  if (toReady.length === 0) {
    broadcast();
    return;
  }

  toReady.forEach(p => (p.pendingJoinCombat = false));
  logEvent(`В бой введены: ${toReady.map(p => p.name).join(", ")}`);

  // Пересобираем порядок, не сбивая текущий ход
  gameState.turnOrder = [...gameState.players]
    .filter(pl => pl.hasRolledInitiative && !pl.pendingJoinCombat)
    .sort((a,b) => (b.initiative ?? -1) - (a.initiative ?? -1))
    .map(pl => pl.id);

  if (currentId) {
    const idx = gameState.turnOrder.indexOf(currentId);
    if (idx >= 0) gameState.currentTurnIndex = idx;
  }

  broadcast();
  break;
}

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
  const user = getUserByWS(ws);
  if (!user) return;

  // создаём игрока (пока без боевой логики)
  const inCombat = (gameState.phase === "combat");
  const inherit = !!data.inheritInitiative;
  const sourceId = data.sourceId; // текущий ходящий (передаст клиент)
  const source = sourceId ? gameState.players.find(pp => pp.id === sourceId) : null;

  const p = {
    id: (data.player && data.player.id) ? data.player.id : uuidv4(),
    name: data.player?.name || "Unknown",
    color: data.player?.color || "#ffffff",
    size: data.player?.size || 1,

    // если призыв в бою — по умолчанию ставим в клетку призывателя (если она известна)
    x: (inCombat && source && source.x !== null) ? source.x : null,
    y: (inCombat && source && source.y !== null) ? source.y : null,

    initiative: null,
    hasRolledInitiative: false,
    pendingJoinCombat: false,

    ownerId: user.id,
    ownerName: user.name
  };

  // Добавляем в список
  gameState.players.push(p);

  // Если добавили в бою как "призыв"
  if (inCombat) {
    if (inherit && source && source.initiative !== null) {
      // наследуем инициативу призывателя
      p.initiative = source.initiative;
      p.hasRolledInitiative = true;
      p.pendingJoinCombat = false;

      // пересобираем turnOrder, не сбивая текущий ход
      const currentId = gameState.turnOrder?.[gameState.currentTurnIndex] ?? null;

      gameState.turnOrder = [...gameState.players]
        .filter(pl => pl.hasRolledInitiative && !pl.pendingJoinCombat)
        .sort((a, b) => (b.initiative ?? -1) - (a.initiative ?? -1))
        .map(pl => pl.id);

      if (currentId) {
        const idx = gameState.turnOrder.indexOf(currentId);
        if (idx >= 0) gameState.currentTurnIndex = idx;
      }

      logEvent(`${p.name} призван с инициативой ${p.initiative}`);
    } else {
      // требуется бросить инициативу и подтвердить "К бою"
      p.initiative = null;
      p.hasRolledInitiative = false;
      p.pendingJoinCombat = true;

      logEvent(`${p.name} призван: требуется инициатива и "К бою"`);
    }
  }

  logEvent(`Игрок ${p.name} создан пользователем ${user.name}`);
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
  // 2) или своего персонажа, если он ещё не выставлен на поле (x/y null) — чтобы можно было "ввести" нового бойца
  if (gameState.phase === "combat" && !gm) {
  // Если существо ещё не введено в бой ("pending") — можно двигать всегда (для размещения)
  if (p.pendingJoinCombat) {
    // ok
  } else {
    const currentId = gameState.turnOrder[gameState.currentTurnIndex];
    const notPlacedYet = (p.x === null || p.y === null);
    if (p.id !== currentId && !notPlacedYet) return;
  }
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

case "rollInitiative": {
  // Разрешаем бросок инициативы:
  // - в фазе initiative (как раньше)
  // - и в combat, но только для новых/неброшенных персонажей
  if (gameState.phase !== "initiative" && gameState.phase !== "combat") return;

  const user = getUserByWS(ws);
  if (!user) return;

  const beforeCurrentId =
    gameState.turnOrder && gameState.turnOrder.length
      ? gameState.turnOrder[gameState.currentTurnIndex]
      : null;

  let rolledAny = false;

  gameState.players
    .filter(p => p.ownerId === user.id && p.pendingJoinCombat && !p.hasRolledInitiative)
    .forEach(p => {
      p.initiative = Math.floor(Math.random() * 20) + 1;
      p.hasRolledInitiative = true;
      rolledAny = true;
      logEvent(`${p.name} бросил инициативу: ${p.initiative}`);
    });

  if (!rolledAny) {
    broadcast();
    return;
  }

  // Если мы в бою — пересобираем turnOrder с учётом новых инициатив,
  // но сохраняем текущего ходящего (не "прыгаем" на другого)
  if (gameState.phase === "combat") {
    gameState.turnOrder = [...gameState.players]
      .filter(p => p.hasRolledInitiative && !p.pendingJoinCombat)
      .sort((a, b) => b.initiative - a.initiative)
      .map(p => p.id);

    if (beforeCurrentId) {
      const newIndex = gameState.turnOrder.indexOf(beforeCurrentId);
      if (newIndex >= 0) gameState.currentTurnIndex = newIndex;
    }
  }

  broadcast();
  break;
}

case "finishInitiative": {
  if (!isGM(ws)) return;

  const allRolled = gameState.players.every(p => p.hasRolledInitiative);
  if (!allRolled) return;

  gameState.turnOrder = [...gameState.players]
    .sort((a,b) => b.initiative - a.initiative)
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

  // ✅ убираем стены
  gameState.walls = [];

  // ✅ убираем ВСЕХ игроков с поля (но не удаляем их полностью)
  gameState.players.forEach(p => {
    p.x = null;
    p.y = null;
  });

  // также безопасно сбрасываем выделение/ход не трогаем — бой может продолжаться
  logEvent("Поле очищено: стены удалены, все персонажи убраны с поля");
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

function autoPlacePlayers() {
  let x = 0;
  let y = 0;

  gameState.players.forEach(p => {
    // 🔑 НЕ трогаем тех, кто уже выставлен вручную
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





