// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// ================== EXPRESS SETUP ==================
const app = express();
app.use(express.static("public")); // раздаём фронтенд

const server = http.createServer(app);

// ================== WEBSOCKET SETUP ==================
const wss = new WebSocket.Server({ server });

// ================== GAME STATE ==================
let gameState = {
  players: [],
  walls: [],
  turnOrder: [],
  currentTurnIndex: 0,
  log: []
};

// ================== UTILS ==================
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function logEvent(text) {
  gameState.log.push(`${new Date().toLocaleTimeString()}: ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

// ================== WEBSOCKET HANDLERS ==================
wss.on("connection", ws => {
  console.log("🟢 Client connected");

  // отправляем текущее состояние новому клиенту
  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      case "addPlayer":
        gameState.players.push(data.player);
        logEvent(`Игрок ${data.player.name} присоединился`);
        broadcast({ type: "state", state: gameState });
        break;

      case "movePlayer":
        const p = gameState.players.find(pl => pl.id === data.id);
        if (p) {
          p.x = data.x;
          p.y = data.y;
          logEvent(`${p.name} переместился`);
          broadcast({ type: "state", state: gameState });
        }
        break;

      case "addWall":
        gameState.walls.push(data.wall);
        logEvent(`Стена добавлена (${data.wall.x}, ${data.wall.y})`);
        broadcast({ type: "state", state: gameState });
        break;

      case "removeWall":
        gameState.walls = gameState.walls.filter(
          w => !(w.x === data.wall.x && w.y === data.wall.y)
        );
        logEvent(`Стена удалена (${data.wall.x}, ${data.wall.y})`);
        broadcast({ type: "state", state: gameState });
        break;

      case "rollInitiative":
        gameState.players.forEach(pl => {
          pl.initiative = Math.floor(Math.random() * 20) + 1;
        });
        gameState.turnOrder = [...gameState.players]
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);
        gameState.currentTurnIndex = 0;
        logEvent("Бросок инициативы");
        broadcast({ type: "state", state: gameState });
        break;

      case "endTurn":
        gameState.currentTurnIndex =
          (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
        logEvent("Конец хода");
        broadcast({ type: "state", state: gameState });
        break;

      case "log":
        logEvent(data.text);
        broadcast({ type: "state", state: gameState });
        break;
    }
  });

  ws.on("close", () => console.log("🔴 Client disconnected"));
});

// ================== SERVER START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server running on port", PORT));
