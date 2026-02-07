// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid"); // уникальные id

// ================== EXPRESS ==================
const app = express();
app.use(express.static("public"));

// ===== Proxy fetch for dnd.su (to bypass browser CORS) =====
// Используется в модалке "Инфа" -> "Заклинания" для добавления описаний по ссылке.
app.get("/api/fetch", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) return res.status(400).send("Missing url");

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).send("Bad url"); }
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) return res.status(400).send("Bad protocol");
    if (!parsed.hostname.endsWith("dnd.su")) return res.status(403).send("Forbidden domain");

    const r = await fetch(parsed.href, {
      headers: {
        "user-agent": "Mozilla/5.0 (DnD-L1GA)",
        "accept": "text/html,application/xhtml+xml"
      }
    });
    if (!r.ok) return res.status(r.status).send(`HTTP ${r.status}`);
    const text = await r.text();
    res.setHeader("content-type", "text/html; charset=utf-8");
    // same-origin for the app, but safe to allow
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(text);
  } catch (err) {
    console.error(err);
    res.status(500).send("Proxy error");
  }
});
const server = http.createServer(app);

// ================== WEBSOCKET ==================
const wss = new WebSocket.Server({ server });

// ===== WS HEARTBEAT (kills dead connections) =====
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 15000);


// ================== GAME STATE ==================
let gameState = {
  boardWidth: 10,
  boardHeight: 10,
  phase: "lobby",
  players: [],      // {id, name, color, size, x, y, initiative, ownerId, ownerName, isBase, sheet}
  walls: [],        // {x, y}
  turnOrder: [],    // массив id игроков по инициативе
  currentTurnIndex: 0,
  log: []
};

// ================== USERS (stable identities) ==================
// userId -> { id, name, role, connections:Set<ws>, online:boolean, lastSeen:number }
const usersById = new Map();

// если пользователь оффлайн и у него нет персонажей — удалим через 10 минут
const USER_CLEANUP_MS = 10 * 60 * 1000;

// ================== HELPERS ==================
function broadcast() {
  const msg = JSON.stringify({ type: "state", state: gameState });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function makeUsersPayload() {
  return Array.from(usersById.values()).map(u => ({
    id: u.id,
    name: u.name,
    role: u.role,
    online: !!u.online
  }));
}

function broadcastUsers() {
  const msg = JSON.stringify({ type: "users", users: makeUsersPayload() });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function logEvent(text) {
  const time = new Date().toLocaleTimeString();
  gameState.log.push(`${time} — ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

function getUserByWS(ws) {
  if (!ws || !ws.userId) return null;
  return usersById.get(ws.userId) || null;
}

function isGM(ws) {
  const u = getUserByWS(ws);
  return !!(u && u.role === "GM");
}

function ownsPlayer(ws, player) {
  const u = getUserByWS(ws);
  return !!(u && player && player.ownerId === u.id);
}

function hasAnyPlayersForUser(userId) {
  return gameState.players.some(p => p.ownerId === userId);
}

function scheduleUserCleanupIfNeeded(userId) {
  setTimeout(() => {
    const u = usersById.get(userId);
    if (!u) return;
    if (u.online) return;
    if (hasAnyPlayersForUser(userId)) return; // не удаляем владельца, если есть персонажи
    usersById.delete(userId);
    broadcastUsers();
  }, USER_CLEANUP_MS);
}

// ================== WS HANDLERS ==================
wss.on("connection", ws => {
  // heartbeat flags
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  // Инициализация у нового клиента
  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      // ================= РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ =================
      case "register": {
        const name = String(data.name || "").trim();
        const role = String(data.role || "").trim();
        const requestedId = String(data.userId || "").trim();

        if (!name || !role) {
          ws.send(JSON.stringify({ type: "error", message: "Имя и роль обязательны" }));
          return;
        }

        // если просят существующий id — переподключаем к тому же пользователю
        let user = requestedId ? usersById.get(requestedId) : null;

        if (!user) {
          // Только один GM (но переподключение к существующему GM разрешено выше)
          const gmExists = Array.from(usersById.values()).some(u => u.role === "GM");
          if (role === "GM" && gmExists) {
            ws.send(JSON.stringify({ type: "error", message: "GM уже существует" }));
            return;
          }

          const id = uuidv4();
          user = {
            id,
            name,
            role,
            connections: new Set(),
            online: true,
            lastSeen: Date.now()
          };
          usersById.set(id, user);
        } else {
          // имя обновляем, роль не меняем (чтобы не ломать права)
          user.name = name;
          user.lastSeen = Date.now();
          user.online = true;
        }

        ws.userId = user.id;
        user.connections.add(ws);

        ws.send(JSON.stringify({ type: "registered", id: user.id, role: user.role, name: user.name }));

        // 🔑 ПОЛНАЯ СИНХРОНИЗАЦИЯ ТОЛЬКО ЭТОМУ КЛИЕНТУ
        sendFullSync(ws);

        broadcastUsers();
        broadcast();
        logEvent(`${user.name} присоединился как ${user.role}`);
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
          ownerName: user.name,

          // ✅ ЛИСТ ПЕРСОНАЖА
          sheet: null
        });

        logEvent(`Игрок ${data.player.name} создан пользователем ${user.name}${isBase ? " (Основа)" : ""}`);
        broadcast();
        break;
      }

      // ✅ НОВОЕ: загрузка/обновление sheet для основы
      case "setPlayerSheet": {
        const p = gameState.players.find(pl => pl.id === data.id);
        if (!p) return;

        // права: GM или владелец
        if (!isGM(ws) && !ownsPlayer(ws, p)) return;

        // только для основы
        if (!p.isBase) {
          ws.send(JSON.stringify({ type: "error", message: "Инфа доступна только для 'Основа'." }));
          return;
        }

        if (!data.sheet || typeof data.sheet !== "object") {
          ws.send(JSON.stringify({ type: "error", message: "Некорректный JSON персонажа." }));
          return;
        }

        // Обновление "Инфы" персонажа НЕ должно попадать в журнал действий.
        // Пользователь может часто менять значения (монеты, хиты, заметки и т.д.).
        p.sheet = data.sheet;

        // Синхронизация имени:
        // - "Имя" в профиле (sheet.parsed.name.value) должно менять имя игрока в списке "Игроки и инициатива".
        // - при создании игрока имя уже задано в p.name, а sheet может быть пустым.
        try {
          const parsed = p.sheet && typeof p.sheet === "object" ? p.sheet.parsed : null;
          let nextName = null;
          if (parsed && typeof parsed === "object") {
            if (parsed.name && typeof parsed.name === "object" && ("value" in parsed.name)) {
              nextName = parsed.name.value;
            } else if (typeof parsed.name === "string") {
              nextName = parsed.name;
            }
          }
          if (typeof nextName === "string") {
            const trimmed = nextName.trim();
            if (trimmed) p.name = trimmed;
          }
        } catch {}
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

      case "updatePlayerSize": {
        const p = gameState.players.find(pl => pl.id === data.id);
        if (!p) return;

        const newSize = parseInt(data.size, 10);
        if (!Number.isFinite(newSize) || newSize < 1 || newSize > 5) return;

        const gm = isGM(ws);
        const owner = ownsPlayer(ws, p);
        if (!gm && !owner) return;

        p.size = newSize;

        if (p.x !== null && p.y !== null) {
          const maxX = gameState.boardWidth - p.size;
          const maxY = gameState.boardHeight - p.size;
          p.x = Math.max(0, Math.min(p.x, maxX));
          p.y = Math.max(0, Math.min(p.y, maxY));
        }

        logEvent(`${p.name} изменил размер на ${p.size}x${p.size}`);
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
case "diceEvent": {
  const user = getUserByWS(ws);
  if (!user) return;

  const event = data.event && typeof data.event === "object" ? data.event : null;
  if (!event) return;

  // минимальная валидация
  const safe = {
    fromId: user.id,
    fromName: user.name,
    kindText: typeof event.kindText === "string" ? event.kindText : "",
    sides: Number(event.sides) || 20,
    count: Number(event.count) || 1,
    bonus: Number(event.bonus) || 0,
    rolls: Array.isArray(event.rolls) ? event.rolls.map(n => Number(n) || 0) : [],
    total: Number(event.total) || 0,
    crit: (event.crit === "crit-fail" || event.crit === "crit-success") ? event.crit : ""
  };

  // рассылаем всем как "живое" событие (не в state)
  const msg = JSON.stringify({ type: "diceEvent", event: safe });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });

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
    const user = getUserByWS(ws);
    if (user) {
      user.connections.delete(ws);
      user.lastSeen = Date.now();
      if (user.connections.size === 0) {
        user.online = false;
        scheduleUserCleanupIfNeeded(user.id);
      }
    }

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
    users: makeUsersPayload()
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


