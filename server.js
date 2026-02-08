// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto"); // уникальные id

const fs = require("fs");
const path = require("path");

// ===== Persist: base sheets storage (multiple saves per account) =====
const BASE_SHEETS_DIR = path.join(__dirname, "data", "baseSheets");
try { fs.mkdirSync(BASE_SHEETS_DIR, { recursive: true }); } catch (e) {}

function safeId(v) {
  return String(v || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function accountDir(accountId) {
  return path.join(BASE_SHEETS_DIR, safeId(accountId));
}

function indexPath(accountId) {
  return path.join(accountDir(accountId), "index.json");
}

function sheetPath(accountId, saveId) {
  return path.join(accountDir(accountId), `${safeId(saveId)}.json`);
}

function ensureAccountDir(accountId) {
  if (!accountId) return false;
  try { fs.mkdirSync(accountDir(accountId), { recursive: true }); return true; } catch (e) { return false; }
}

function readIndex(accountId) {
  if (!accountId) return { items: [], lastUsed: null };
  try {
    const p = indexPath(accountId);
    if (!fs.existsSync(p)) return { items: [], lastUsed: null };
    const raw = fs.readFileSync(p, "utf-8");
    const idx = JSON.parse(raw);
    if (!idx || typeof idx !== "object") return { items: [], lastUsed: null };
    if (!Array.isArray(idx.items)) idx.items = [];
    if (!("lastUsed" in idx)) idx.lastUsed = null;
    return idx;
  } catch (e) {
    console.error("readIndex error:", e);
    return { items: [], lastUsed: null };
  }
}

function writeIndex(accountId, idx) {
  try {
    ensureAccountDir(accountId);
    fs.writeFileSync(indexPath(accountId), JSON.stringify(idx, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("writeIndex error:", e);
    return false;
  }
}

function listBaseSheets(accountId) {
  const idx = readIndex(accountId);
  // newest first
  const items = (idx.items || []).slice().sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  return { items, lastUsed: idx.lastUsed || null };
}

function loadBaseSheet(accountId, saveId) {
  if (!accountId || !saveId) return null;
  try {
    const p = sheetPath(accountId, saveId);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");
    const sheet = JSON.parse(raw);
    return (sheet && typeof sheet === "object") ? sheet : null;
  } catch (e) {
    console.error("loadBaseSheet error:", e);
    return null;
  }
}

function saveBaseSheet(accountId, saveId, name, sheet) {
  if (!accountId || !sheet || typeof sheet !== "object") return null;
  ensureAccountDir(accountId);

  const id = safeId(saveId || uuidv4());
  const now = Date.now();
  const safeName = (typeof name === "string" && name.trim()) ? name.trim() : "Без имени";

  // встраиваем id в сам sheet (чтобы авто-сейв знал, куда писать)
  try {
    sheet._persist = sheet._persist && typeof sheet._persist === "object" ? sheet._persist : {};
    sheet._persist.saveId = id;
    sheet._persist.updatedAt = now;
    sheet._persist.name = safeName;
  } catch (e) {}

  try {
    fs.writeFileSync(sheetPath(accountId, id), JSON.stringify(sheet, null, 2), "utf-8");
  } catch (e) {
    console.error("saveBaseSheet write error:", e);
    return null;
  }

  const idx = readIndex(accountId);
  const items = Array.isArray(idx.items) ? idx.items : [];
  const existing = items.find(x => String(x.id) === String(id));
  if (existing) {
    existing.name = safeName;
    existing.updatedAt = now;
  } else {
    items.push({ id, name: safeName, updatedAt: now });
  }
  idx.items = items;
  idx.lastUsed = id;
  writeIndex(accountId, idx);

  return { id, name: safeName, updatedAt: now };
}

function loadLastUsedBaseSheet(accountId) {
  const { lastUsed } = listBaseSheets(accountId);
  if (!lastUsed) return null;
  return loadBaseSheet(accountId, lastUsed);
}


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
    try { parsed = new URL(url); } catch (e) { return res.status(400).send("Bad url"); }
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
      try { ws.terminate(); } catch (e) {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 15000);


// ================== GAME STATE ==================
    // ================== ROOMS ==================
    function hashPassword(pw) {
      return crypto.createHash("sha256").update(String(pw || ""), "utf8").digest("hex");
    }

    function createInitialGameState() {
      return {
  boardWidth: 10,
  boardHeight: 10,
  phase: "lobby",
  players: [],      // {id, name, color, size, x, y, initiative, ownerId, ownerName, isBase, sheet}
  walls: [],        // {x, y}
  turnOrder: [],    // массив id игроков по инициативе
  currentTurnIndex: 0,
  log: []
};
    }

    // roomId -> { id, name, scenario, passwordHash|null, state, usersById: Map }
    const rooms = new Map();
    const DEFAULT_ROOM_ID = "main";
    rooms.set(DEFAULT_ROOM_ID, {
      id: DEFAULT_ROOM_ID,
      name: "Основная",
      scenario: "",
      passwordHash: null,
      state: createInitialGameState(),
      usersById: new Map()
    });

    let currentRoomId = null;
    function getRoom(id) { return rooms.get(id) || null; }
    function getCurrentRoom() { return currentRoomId ? getRoom(currentRoomId) : null; }


// ================== USERS (stable identities) ==================
// userId -> { id, name, role, connections:Set<ws>, online:boolean, lastSeen:number }
const usersById = new Map();

// если пользователь оффлайн и у него нет персонажей — удалим через 10 минут
const USER_CLEANUP_MS = 10 * 60 * 1000;

// ================== HELPERS ==================
function broadcast() {
  const room = getCurrentRoom();
  if (!room) return;
  const msg = JSON.stringify({ type: "state", state: room.state });
  wss.clients.forEach(c => {
    if (c.readyState !== WebSocket.OPEN) return;
    if (c.roomId !== room.id) return;
    c.send(msg);
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

function makeRoomUsersPayload(room) {
  return Array.from(room.usersById.values()).map(u => ({
    id: u.id,
    name: u.name,
    role: u.role,
    online: !!u.online
  }));
}

function broadcastUsers() {
  const room = getCurrentRoom();
  if (!room) return;
  const msg = JSON.stringify({ type: "users", users: makeRoomUsersPayload(room) });
  wss.clients.forEach(c => {
    if (c.readyState !== WebSocket.OPEN) return;
    if (c.roomId !== room.id) return;
    c.send(msg);
  });
}

function logEvent(text) {
  const room = getCurrentRoom();
  if (!room) return;
  const time = new Date().toLocaleTimeString();
  room.state.log.push(`${time} — ${text}`);
  if (room.state.log.length > 100) room.state.log.shift();
}

// ===== Initiative helpers (Dex mod) =====
function abilityModFromScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return Math.floor((s - 10) / 2);
}

function getDexScore(player) {
  // player.sheet.parsed comes from InfoModal import (Charbox/LSS)
  const s = player?.sheet?.parsed;

  const raw =
    s?.stats?.dex?.score ??
    s?.stats?.dex?.value ??
    s?.stats?.dex ??
    s?.dexterity ??
    s?.dex ??
    null;

  if (raw && typeof raw === "object" && ("value" in raw)) return Number(raw.value) || 10;
  return Number(raw) || 10;
}

function getDexMod(player) {
  return abilityModFromScore(getDexScore(player));
}

function broadcastDiceEvent(ev) {
  const room = getCurrentRoom();
  if (!room) return;
  const msg = JSON.stringify({ type: "diceEvent", event: ev });
  wss.clients.forEach(c => {
    if (c.readyState !== WebSocket.OPEN) return;
    if (c.roomId !== room.id) return;
    c.send(msg);
  });
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
  return !!(u && player && (String(player.ownerId) === String(u.id) || String(player.ownerId) === String(u.accountId) || String(player.ownerId) === String(ws.accountId)));
}

function hasAnyPlayersForUser(userId) {
  // если пользователь владеет персонажами в любой комнате — не удаляем
  for (const r of rooms.values()) {
    if (r.state && Array.isArray(r.state.players) && r.state.players.some(p => p.ownerId === userId)) {
      return true;
    }
  }
  return false;
}
function scheduleUserCleanupIfNeeded(userId) {
  setTimeout(() => {
    const u = usersById.get(userId);
    if (!u) return;
    if (u.online) return;
    if (hasAnyPlayersForUser(userId)) return; // не удаляем владельца, если есть персонажи
    usersById.delete(userId);
    // комнаты сами обновляются через rooms list, но на всякий:
    broadcastRooms();
  }, USER_CLEANUP_MS);
}
// ===== Rooms helpers =====
function listRoomsPayload() {
  return Array.from(rooms.values()).map(r => {
    const onlineUsers = Array.from(r.usersById.values()).filter(u => u && u.online);
    const hasGMOnline = onlineUsers.some(u => u.role === "GM");
    return {
      id: r.id,
      name: r.name,
      scenario: r.scenario || "",
      hasPassword: !!r.passwordHash,
      uniqueUsers: onlineUsers.length,
      hasGMOnline
    };
  });
}
function sendRooms(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "rooms", rooms: listRoomsPayload() }));
}

function broadcastRooms() {
  const msg = JSON.stringify({ type: "rooms", rooms: listRoomsPayload() });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function joinRoom(ws, roomId, password) {
  const room = getRoom(roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: "error", message: "Комната не найдена" }));
    return;
  }

  if (room.passwordHash) {
    const ok = hashPassword(password || "") === room.passwordHash;
    if (!ok) {
      ws.send(JSON.stringify({ type: "error", message: "Неверный пароль комнаты" }));
      return;
    }
  }

  
// ===== правило: в комнате может быть только один GM =====
const u = getUserByWS(ws);
if (u && u.role === "GM") {
  const existingOnlineGM = Array.from(room.usersById.values()).some(x =>
    x && x.role === "GM" && x.online && x.id !== u.id
  );
  if (existingOnlineGM) {
    ws.send(JSON.stringify({ type: "error", message: "В этой комнате уже есть GM" }));
    return;
  }
}

// выйти из предыдущей комнаты
  if (ws.roomId && ws.roomId !== roomId) {
    leaveRoom(ws);
  }

  ws.roomId = roomId;
      if (u) room.usersById.set(u.id, { id: u.id, name: u.name, role: u.role, online: true });

  ws.send(JSON.stringify({ type: "joinedRoom", room: { id: room.id, name: room.name, scenario: room.scenario || "", hasPassword: !!room.passwordHash } }));

  currentRoomId = room.id;
  sendFullSync(ws);
  broadcastUsers();
  broadcast();
  currentRoomId = null;

  broadcastRooms();
}

function leaveRoom(ws) {
  if (!ws.roomId) return;
  const room = getRoom(ws.roomId);
  if (!room) { ws.roomId = null; return; }

  const u = getUserByWS(ws);
  if (u && room.usersById.has(u.id)) {
    const ru = room.usersById.get(u.id);
    ru.online = false;
    room.usersById.set(u.id, ru);
  }

  const oldRoomId = ws.roomId;
  ws.roomId = null;

  currentRoomId = oldRoomId;
  broadcastUsers();
  broadcast();
  currentRoomId = null;

  broadcastRooms();
}


// ================== WS HANDLERS ==================
wss.on("connection", ws => {
  // heartbeat flags
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  // Клиент подключился: сначала лобби комнат
  sendRooms(ws);

  ws.on("message", msg => {
  let data;
  try { data = JSON.parse(msg); } catch (e) { return; }

  const lobbyTypes = new Set(["register","listRooms","createRoom","joinRoom","leaveRoom"]);
  let gameState = null;

  if (!lobbyTypes.has(data.type)) {
    if (!ws.roomId) {
      ws.send(JSON.stringify({ type: "error", message: "Сначала войдите в комнату" }));
      return;
    }
    const room = getRoom(ws.roomId);
    if (!room) {
      ws.send(JSON.stringify({ type: "error", message: "Комната не найдена" }));
      return;
    }
    currentRoomId = room.id;
    gameState = room.state;
  }

  try {
    switch (data.type) {

      // ================= РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ =================
      case "register": {
        const name = String(data.name || "").trim();
        const role = String(data.role || "").trim();
        const requestedId = String(data.userId || "").trim();
        const requestedAccountId = String(data.accountId || "").trim();

        if (!name || !role) {
          ws.send(JSON.stringify({ type: "error", message: "Имя и роль обязательны" }));
          return;
        }

        // если просят существующий id — переподключаем к тому же пользователю
        let user = requestedId ? usersById.get(requestedId) : null;

        if (!user) {
          const id = uuidv4();
          user = {
            id,
            name,
            role,
            connections: new Set(),
            online: true,
            lastSeen: Date.now(),
            accountId: requestedAccountId || uuidv4()
          };
          usersById.set(id, user);
        } else {
          // имя обновляем, роль не меняем (чтобы не ломать права)
          user.name = name;
          user.lastSeen = Date.now();
          user.online = true;
          if (requestedAccountId) user.accountId = requestedAccountId;
          if (!user.accountId) user.accountId = uuidv4();
        }

        ws.userId = user.id;
        ws.accountId = user.accountId;
        user.connections.add(ws);

        ws.send(JSON.stringify({ type: "registered", id: user.id, role: user.role, name: user.name, accountId: user.accountId }));

        // 🔑 ПОЛНАЯ СИНХРОНИЗАЦИЯ ТОЛЬКО ЭТОМУ КЛИЕНТУ
        sendRooms(ws);

        broadcastUsers();
        broadcast();
        logEvent(`${user.name} присоединился как ${user.role}`);
        break;
      }

      

// ================= ROOMS: LOBBY =================
case "listRooms": {
  sendRooms(ws);
  break;
}

case "createRoom": {
  const u = getUserByWS(ws);
  if (!u) {
    ws.send(JSON.stringify({ type: "error", message: "Сначала войдите в игру" }));
    return;
  }

  const name = String(data.name || "").trim();
  const password = String(data.password || "");
  const scenario = String(data.scenario || "").trim();

  if (!name) {
    ws.send(JSON.stringify({ type: "error", message: "Название комнаты обязательно" }));
    return;
  }

  const id = "r_" + uuidv4().slice(0, 8);
  rooms.set(id, {
    id,
    name,
    scenario,
    passwordHash: password ? hashPassword(password) : null,
    state: createInitialGameState(),
    usersById: new Map()
  });

  broadcastRooms();
  // авто-вход создателя
  joinRoom(ws, id, password);
  break;
}

case "joinRoom": {
  const roomId = String(data.roomId || "").trim();
  const password = String(data.password || "");
  if (!roomId) {
    ws.send(JSON.stringify({ type: "error", message: "roomId обязателен" }));
    return;
  }
  joinRoom(ws, roomId, password);
  break;
}

case "leaveRoom": {
  leaveRoom(ws);
  sendRooms(ws);
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

      case "startExploration": {
        if (!isGM(ws)) return;
        gameState.phase = "exploration";
        logEvent("GM начал фазу исследования");
        broadcast();
        break;
      }

      case "addPlayer": {
        const user = getUserByWS(ws);
        if (!user) return;

        const isBase = !!data.player?.isBase;

        // ✅ Persist: автоподгрузка сохранённой "Основы" владельца
        let preloadedSheet = null;
        if (isBase) {
          preloadedSheet = loadLastUsedBaseSheet(ws.accountId || user.accountId || user.id);
        }

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

          // инициатива
          hasRolledInitiative: false,

          // если персонаж создан во время боя — сначала нужно выбрать/бросить инициативу
          pendingInitiativeChoice: (gameState.phase === "combat"),
          willJoinNextRound: false,

          isBase,

          // 🔑 СВЯЗЬ С УНИКАЛЬНЫМ ПОЛЬЗОВАТЕЛЕМ
          ownerId: (isBase ? (ws.accountId || user.accountId || user.id) : user.id),
          ownerName: user.name,

          // ✅ Persist: id сохранённого персонажа (если загружали)
          baseSaveId: (preloadedSheet && preloadedSheet._persist && preloadedSheet._persist.saveId) ? preloadedSheet._persist.saveId : null,

          // ✅ ЛИСТ ПЕРСОНАЖА (автоподгрузка, если есть сохранение)
          sheet: preloadedSheet || null
        });

        // если загрузили sheet — попробуем взять имя из него
        if (isBase && preloadedSheet) {
          const p = gameState.players[gameState.players.length - 1];
          try {
            const parsed = p.sheet?.parsed;
            let nextName = null;
            if (parsed && typeof parsed === "object") {
              if (parsed.name && typeof parsed.name === "object" && ("value" in parsed.name)) nextName = parsed.name.value;
              else if (typeof parsed.name === "string") nextName = parsed.name;
            }
            if (typeof nextName === "string" && nextName.trim()) p.name = nextName.trim();
          } catch (e) {}
        }

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
        } catch (e) {}

        // ✅ Persist: авто-сейв "Основы" (только если уже выбран/создан saveId)
        if (p.isBase) {
          const accountId = String(p.ownerId || ws.accountId || "").trim();
          const saveId = (p.baseSaveId || p.sheet?._persist?.saveId || "").trim();
          if (accountId && saveId) {
            const nm = (p.sheet?.parsed?.name && typeof p.sheet.parsed.name === "object" && ("value" in p.sheet.parsed.name))
              ? p.sheet.parsed.name.value
              : (typeof p.sheet?.parsed?.name === "string" ? p.sheet.parsed.name : p.name);
            const meta = saveBaseSheet(accountId, saveId, nm, p.sheet);
            if (meta && meta.id) p.baseSaveId = meta.id;
          }
        }

        broadcast();
        break;
      }


      // ✅ Persist: сохранить "основу" вручную (кнопка)
      case "saveBaseSheet": {
        const p = gameState.players.find(pl => pl.id === data.id);
        if (!p) return;
        if (!p.isBase) return;

        // права: GM или владелец
        if (!isGM(ws) && !ownsPlayer(ws, p)) return;

        const accountId = String(p.ownerId || ws.accountId || "").trim();
        if (!accountId) {
          ws.send(JSON.stringify({ type: "baseSheetSaved", ok: false, message: "Нет accountId" }));
          return;
        }

        const currentName =
          (p.sheet?.parsed?.name && typeof p.sheet.parsed.name === "object" && ("value" in p.sheet.parsed.name))
            ? p.sheet.parsed.name.value
            : (typeof p.sheet?.parsed?.name === "string" ? p.sheet.parsed.name : p.name);

        const saveId = (p.baseSaveId || p.sheet?._persist?.saveId || "").trim();
        const meta = saveBaseSheet(accountId, saveId || null, currentName, p.sheet || null);
        if (!meta) {
          ws.send(JSON.stringify({ type: "baseSheetSaved", ok: false }));
          return;
        }

        p.baseSaveId = meta.id;
        try {
          p.sheet = p.sheet || {};
          p.sheet._persist = p.sheet._persist && typeof p.sheet._persist === "object" ? p.sheet._persist : {};
          p.sheet._persist.saveId = meta.id;
          p.sheet._persist.name = meta.name;
          p.sheet._persist.updatedAt = meta.updatedAt;
        } catch (e) {}

        ws.send(JSON.stringify({ type: "baseSheetSaved", ok: true, meta }));
        break;
      }

      // ✅ Persist: загрузить "основу" вручную (кнопка)
      case "listBaseSheets": {
        // список сохранённых персонажей для текущего accountId
        const accountId = String(ws.accountId || "").trim();
        if (!accountId) {
          ws.send(JSON.stringify({ type: "baseSheetsList", ok: false, items: [], message: "Нет accountId" }));
          return;
        }
        const { items, lastUsed } = listBaseSheets(accountId);
        ws.send(JSON.stringify({ type: "baseSheetsList", ok: true, items, lastUsed }));
        break;
      }

      case "loadBaseSheetById": {
        const p = gameState.players.find(pl => pl.id === data.id);
        if (!p) return;
        if (!p.isBase) return;

        // права: GM или владелец
        if (!isGM(ws) && !ownsPlayer(ws, p)) return;

        const accountId = String(p.ownerId || ws.accountId || "").trim();
        const saveId = String(data.saveId || "").trim();
        if (!accountId || !saveId) {
          ws.send(JSON.stringify({ type: "baseSheetLoaded", ok: false, message: "Не указан saveId" }));
          return;
        }

        const sheet = loadBaseSheet(accountId, saveId);
        if (!sheet) {
          ws.send(JSON.stringify({ type: "baseSheetLoaded", ok: false, message: "Сохранение не найдено" }));
          return;
        }

        p.sheet = sheet;
        p.baseSaveId = saveId;

        // обновим имя из sheet (если есть)
        try {
          const parsed = p.sheet?.parsed;
          let nextName = null;
          if (parsed && typeof parsed === "object") {
            if (parsed.name && typeof parsed.name === "object" && ("value" in parsed.name)) nextName = parsed.name.value;
            else if (typeof parsed.name === "string") nextName = parsed.name;
          }
          if (typeof nextName === "string" && nextName.trim()) p.name = nextName.trim();
        } catch (e) {}

        ws.send(JSON.stringify({ type: "baseSheetLoaded", ok: true, saveId }));
        broadcast();
        break;
      }

      // legacy: загрузить последнего использованного
      case "loadBaseSheet": {
        const p = gameState.players.find(pl => pl.id === data.id);
        if (!p) return;
        if (!p.isBase) return;

        if (!isGM(ws) && !ownsPlayer(ws, p)) return;

        const accountId = String(p.ownerId || ws.accountId || "").trim();
        const sheet = loadLastUsedBaseSheet(accountId);
        if (!sheet) {
          ws.send(JSON.stringify({ type: "baseSheetLoaded", ok: false, message: "Сохранённая 'Основа' не найдена" }));
          return;
        }

        p.sheet = sheet;
        p.baseSaveId = sheet?._persist?.saveId || null;

        try {
          const parsed = p.sheet?.parsed;
          let nextName = null;
          if (parsed && typeof parsed === "object") {
            if (parsed.name && typeof parsed.name === "object" && ("value" in parsed.name)) nextName = parsed.name.value;
            else if (typeof parsed.name === "string") nextName = parsed.name;
          }
          if (typeof nextName === "string" && nextName.trim()) p.name = nextName.trim();
        } catch (e) {}

        ws.send(JSON.stringify({ type: "baseSheetLoaded", ok: true }));
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

        const size = Number(p.size) || 1;

        const maxX = gameState.boardWidth - size;
        const maxY = gameState.boardHeight - size;
        const nextX = clamp(Number(data.x) || 0, 0, maxX);
        const nextY = clamp(Number(data.y) || 0, 0, maxY);

        // 🔒 нельзя становиться/появляться на занятой клетке (или пересекаться по размеру)
        if (!isAreaFree(gameState, p.id, nextX, nextY, size)) {
          ws.send(JSON.stringify({ type: "error", message: "Эта клетка занята другим персонажем" }));
          return;
        }

        p.x = nextX;
        p.y = nextY;
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

        // если стоит на поле — проверим, что новый размер не пересекается с другими
        if (p.x !== null && p.y !== null) {
          const maxX = gameState.boardWidth - newSize;
          const maxY = gameState.boardHeight - newSize;
          const nx = clamp(p.x, 0, maxX);
          const ny = clamp(p.y, 0, maxY);
          if (!isAreaFree(gameState, p.id, nx, ny, newSize)) {
            ws.send(JSON.stringify({ type: "error", message: "Нельзя увеличить размер: место занято" }));
            return;
          }
          p.x = nx;
          p.y = ny;
        }

        p.size = newSize;

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
            const roll = Math.floor(Math.random() * 20) + 1;
            const dexMod = getDexMod(p);
            const total = roll + dexMod;

            p.initiative = total;
            p.hasRolledInitiative = true;

            // ✅ показываем всем тот же результат, что записали в player.initiative
            broadcastDiceEvent({
              fromId: user.id,
              fromName: p.name,
              kindText: `Инициатива: d20${dexMod >= 0 ? "+" : ""}${dexMod}`,
              sides: 20,
              count: 1,
              bonus: dexMod,
              rolls: [roll],
              total,
              crit: ""
            });

            const sign = dexMod >= 0 ? "+" : "";
            logEvent(`${p.name} бросил инициативу: ${roll}${sign}${dexMod} = ${total}`);
          });

        broadcast();
        break;
      }

      // ===== Новый игрок во время боя: выбор инициативы (только для pending) =====
      case "combatInitChoice": {
        if (gameState.phase !== "combat") return;

        const user = getUserByWS(ws);
        if (!user) return;

        const p = gameState.players.find(pl => pl.id === data.id);
        if (!p) return;

        // только GM или владелец
        if (!isGM(ws) && !ownsPlayer(ws, p)) return;

        if (!p.pendingInitiativeChoice) return;

        const choice = String(data.choice || "");

        if (choice === "roll") {
          const roll = Math.floor(Math.random() * 20) + 1;
          const dexMod = getDexMod(p);
          const total = roll + dexMod;

          p.initiative = total;
          p.hasRolledInitiative = true;

          broadcastDiceEvent({
            fromId: user.id,
            fromName: p.name,
            kindText: `Инициатива (новый): d20${dexMod >= 0 ? "+" : ""}${dexMod}`,
            sides: 20,
            count: 1,
            bonus: dexMod,
            rolls: [roll],
            total,
            crit: ""
          });

          const sign = dexMod >= 0 ? "+" : "";
          logEvent(`${p.name} (новый) бросил инициативу: ${roll}${sign}${dexMod} = ${total}`);
        } else if (choice === "base") {
          // берём инициативу "основы" владельца
          const base = gameState.players.find(pl => pl.isBase && pl.ownerId === p.ownerId);
          const baseInit = (base && base.initiative !== null && base.initiative !== undefined)
            ? Number(base.initiative) || 0
            : 0;

          p.initiative = baseInit;
          p.hasRolledInitiative = true;

          broadcastDiceEvent({
            fromId: user.id,
            fromName: p.name,
            kindText: "Инициатива основы",
            sides: 0,
            count: 1,
            bonus: 0,
            rolls: [baseInit],
            total: baseInit,
            crit: ""
          });

          logEvent(`${p.name} (новый) взял инициативу основы: ${baseInit}`);
        } else {
          return;
        }

        // этот игрок войдёт в порядок хода на СЛЕДУЮЩЕМ круге
        p.pendingInitiativeChoice = false;
        p.willJoinNextRound = true;

        broadcast();
        break;
      }

      case "startCombat": {
        if (!isGM(ws)) return;
        // можно начать бой сразу после инициативы (когда все бросили)
        if (gameState.phase !== "initiative" && gameState.phase !== "placement" && gameState.phase !== "exploration") return;

        const allRolled = (gameState.players || []).length
          ? gameState.players.every(p => p.hasRolledInitiative)
          : false;

        if (!allRolled) {
          ws.send(JSON.stringify({ type: "error", message: "Сначала бросьте инициативу за всех персонажей" }));
          return;
        }

        // порядок хода по инициативе
        gameState.turnOrder = [...gameState.players]
          .sort((a, b) => (Number(b.initiative) || 0) - (Number(a.initiative) || 0))
          .map(p => p.id);

        // авто-размещение тех, кто ещё не на поле (с учётом занятых клеток)
        autoPlacePlayers(gameState);

        gameState.phase = "combat";
        gameState.currentTurnIndex = 0;

        const firstId = gameState.turnOrder[0];
        const first = gameState.players.find(p => p.id === firstId);

        logEvent(`Бой начался. Первый ход: ${first?.name || '-'}`);
        broadcast();
        break;
      }

      case "endTurn": {
        if (gameState.phase !== "combat") return;

        if (!Array.isArray(gameState.turnOrder) || gameState.turnOrder.length === 0) return;

        const currentId = gameState.turnOrder[gameState.currentTurnIndex];
        const current = gameState.players.find(p => p.id === currentId);

        // GM может всегда; игрок — только если это его персонаж
        const canEnd = isGM(ws) || (current && ownsPlayer(ws, current));
        if (!canEnd) return;

        const prevIndex = gameState.currentTurnIndex;
        const nextIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;

        const wrapped = (prevIndex === gameState.turnOrder.length - 1 && nextIndex === 0);

        // если мы прошли последний ход и начинаем новый круг — добавляем тех, кто должен войти в следующий круг
        if (wrapped) {
          const toJoin = (gameState.players || []).filter(p => p && p.willJoinNextRound);
          if (toJoin.length) {
            toJoin.forEach(p => { p.willJoinNextRound = false; });

            // пересортируем порядок хода по инициативе (теперь с новыми персонажами)
            gameState.turnOrder = [...new Set(
              [...gameState.players]
                .filter(p => p && (p.initiative !== null && p.initiative !== undefined))
                .sort((a, b) => (Number(b.initiative) || 0) - (Number(a.initiative) || 0))
                .map(p => p.id)
            )];
          }
        }

        // после возможной пересборки порядка хода выставляем индекс
        gameState.currentTurnIndex = wrapped ? 0 : nextIndex;
        const nextId = gameState.turnOrder[gameState.currentTurnIndex];
        const next = gameState.players.find(p => p.id === nextId);
        logEvent(`Ход игрока ${next?.name || '-'}`);
        broadcast();
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
        gameState.players.forEach(p => {
          p.x = null;
          p.y = null;
        });

        logEvent("Поле очищено: стены удалены, все персонажи убраны с поля");
        broadcast();
        break;
      }
    } finally {
      currentRoomId = null;
    }
  });

  ws.on("close", () => {
  // отметим оффлайн в комнате, если был
  if (ws.roomId) {
    const room = getRoom(ws.roomId);
    const u = getUserByWS(ws);
    if (room && u && room.usersById.has(u.id)) {
      const ru = room.usersById.get(u.id);
      ru.online = false;
      room.usersById.set(u.id, ru);
      currentRoomId = room.id;
      broadcastUsers();
      broadcast();
      currentRoomId = null;
    }
    ws.roomId = null;
  }

  const user = getUserByWS(ws);
  if (user) {
    user.connections.delete(ws);
    user.lastSeen = Date.now();

    if (user.connections.size === 0) {
      user.online = false;
      scheduleUserCleanupIfNeeded(user.id);
    }
  }

  broadcastRooms();
});
});
function sendFullSync(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;

  if (!ws.roomId) {
    sendRooms(ws);
    return;
  }

  const room = getRoom(ws.roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: "error", message: "Комната не найдена" }));
    return;
  }

  ws.send(JSON.stringify({ type: "init", state: room.state }));
  ws.send(JSON.stringify({ type: "users", users: makeRoomUsersPayload(room) }));
  sendRooms(ws);
}

function autoPlacePlayers(state) {
  if (!state || !Array.isArray(state.players)) return;

  state.players.forEach(p => {
    if (!p) return;
    if (p.x !== null && p.y !== null) return;
    const size = Number(p.size) || 1;
    const spot = findFirstFreeSpot(state, size);
    if (!spot) {
      // места нет — оставим не размещённым
      return;
    }
    p.x = spot.x;
    p.y = spot.y;
  });
}

// ================== PLACEMENT HELPERS ==================
function clamp(v, min, max) {
  return Math.max(min, Math.min(v, max));
}

function rectsOverlap(ax, ay, as, bx, by, bs) {
  // axis-aligned rectangles in grid coordinates
  return ax < (bx + bs) && (ax + as) > bx && ay < (by + bs) && (ay + as) > by;
}

function isAreaFree(state, ignorePlayerId, x, y, size) {
  if (!state) return false;

  const maxX = state.boardWidth - size;
  const maxY = state.boardHeight - size;
  if (x < 0 || y < 0 || x > maxX || y > maxY) return false;

  // no overlap with other placed players
  for (const other of (state.players || [])) {
    if (!other) continue;
    if (ignorePlayerId && other.id === ignorePlayerId) continue;
    if (other.x === null || other.y === null) continue;
    if (rectsOverlap(x, y, size, other.x, other.y, other.size || 1)) return false;
  }

  return true;
}

function findFirstFreeSpot(state, size) {
  if (!state) return null;
  const maxX = state.boardWidth - size;
  const maxY = state.boardHeight - size;

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      if (isAreaFree(state, null, x, y, size)) return { x, y };
    }
  }
  return null;
}

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server on", PORT));


