// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// ================== EXPRESS ==================
const app = express();
app.use(express.static("public"));

const server = http.createServer(app);

// ================== WEBSOCKET ==================
const wss = new WebSocket.Server({ server });

// ================== GAME STATE ==================
const gameState = {
  players: [],        // { id, name, x, y, initiative }
  walls: [],          // { x, y }
  turnOrder: [],      // [playerId]
  currentTurnIndex: 0,
  log: []
};

// ================== HELPERS ==================
function broadcastState() {
  const payload = JSON.stringify({
    type: "state",
    state: gameState
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function addLog(text) {
  gameState.log.push(`${new Date().toLocaleTimeString()} — ${text}`);
  if (gameState.log.length > 100) {
    gameState.log.shift();
  }
}

// ================== WS HANDLER ==================
wss.on("connection", ws => {
  console.log("🟢 Client connected");

  // отправляем ПОЛНОЕ состояние
  ws.send(JSON.stringify({
    type: "init",
    state: gameState
  }));

  ws.on("message", message => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    switch (data.type) {

      case "addPlayer": {
        // защита от дубликатов
        if (gameState.players.some(p => p.id === data.player.id)) return;

        gameState.players.push({
          id: data.player.id,
          name: data.player.name,
          x: data.player.x ?? 0,
          y: data.player.y ?? 0,
          initiative: null
        });

        addLog(`Игрок ${data.player.name} добавлен`);
        broadcastState();
        break;
      }

      case "movePlayer": {
        const player = gameState.players.find(p => p.id === data.id);
        if (!player) return;

        player.x = data.x;
        player.y = data.y;

        addLog(`${player.name} переместился`);
        broadcastState();
        break;
      }

      case "addWall": {
        gameState.walls.push({ x: data.x, y: data.y });
        addLog(`Добавлена стена (${data.x}, ${data.y})`);
        broadcastState();
        break;
      }

      case "removeWall": {
        gameState.walls = gameState.walls.filter(
          w => !(w.x === data.x && w.y === data.y)
        );
        addLog(`Удалена стена (${data.x}, ${data.y})`);
        broadcastState();
        break;
      }

      case "rollInitiative": {
        gameState.players.forEach(p => {
          p.initiative = Math.floor(Math.random() * 20) + 1;
        });

        gameState.turnOrder = [...gameState.players]
          .sort((a, b) => b.initiative - a.initiative)
          .map(p => p.id);

        gameState.currentTurnIndex = 0;
        addLog("Бросок инициативы");
        broadcastState();
        break;
      }

      case "endTurn": {
        if (gameState.turnOrder.length === 0) return;

        gameState.currentTurnIndex =
          (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;

        addLog("Конец хода");
        broadcastState();
        break;
      }

      case "clearField": {
        gameState.walls = [];
        addLog("Поле очищено");
        broadcastState();
        break;
      }

      case "resetGame": {
        gameState.players = [];
        gameState.walls = [];
        gameState.turnOrder = [];
        gameState.currentTurnIndex = 0;
        gameState.log = [];

        broadcastState();
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("🔴 Client disconnected");
  });
});

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
});
