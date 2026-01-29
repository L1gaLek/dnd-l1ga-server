// ================== IMPORTS ==================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid"); // для уникальных id игроков

// ================== EXPRESS SETUP ==================
const app = express();
app.use(express.static("public")); // раздаём фронтенд

const server = http.createServer(app);

// ================== WEBSOCKET SETUP ==================
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
        const newPlayer = {
          id: uuidv4(),
          name: data.player.name,
          color: data.player.color,
          size: data.player.size || 1,
          x: 0,
          y: 0,
          initiative: 0
        };
        gameState.players.push(newPlayer);
        logEvent(`Игрок ${newPlayer.name} присоединился`);
        broadcast({ type: "state", state: gameState });
        break;

      case "movePlayer":
        const p = gameState.players.find(pl => pl.id === data.id);
        if (p) {
          p.x = data.x;
          p.y = data.y;
          logEvent(`${p.name} переместился в (${p.x},${p.y})`);
          broadcast({ type: "state", state: gameState });
        }
        break;

      case "addWall":
        if (!gameState.walls.find(w => w.x === data.wall.x && w.y === data.wall.y)) {
          gameState.walls.push({ ...data.wall });
          logEvent(`Стена добавлена (${data.wall.x}, ${data.wall.y})`);
          broadcast({ type: "state", state: gameState });
        }
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
        if (gameState.turnOrder.length > 0) {
          gameState.currentTurnIndex =
            (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
          const currentPlayer = gameState.players.find(
            p => p.id === gameState.turnOrder[gameState.currentTurnIndex]
          );
          logEvent(`Ход игрока ${currentPlayer?.name || '-'}`);
          broadcast({ type: "state", state: gameState });
        }
        break;

      case "rollDice":
        const sides = data.sides || 6;
        const roller = gameState.players.find(p => p.id === data.id);
        if (roller) {
          const result = Math.floor(Math.random() * sides) + 1;
          logEvent(`${roller.name} бросил d${sides}: ${result}`);
          broadcast({ type: "state", state: gameState });
        }
        break;

      case "resizeBoard":
        gameState.boardWidth = data.width || gameState.boardWidth;
        gameState.boardHeight = data.height || gameState.boardHeight;
        logEvent(`Размер поля изменен: ${gameState.boardWidth}x${gameState.boardHeight}`);
        broadcast({ type: "state", state: gameState });
        break;

      case "clearBoard":
        gameState.walls = [];
        gameState.players.forEach(pl => { pl.x = 0; pl.y = 0; });
        logEvent("Поле очищено");
        broadcast({ type: "state", state: gameState });
        break;

      case "resetGame":
        gameState.players = [];
        gameState.walls = [];
        gameState.turnOrder = [];
        gameState.currentTurnIndex = 0;
        gameState.log = ["Игра полностью сброшена"];
        broadcast({ type: "state", state: gameState });
        break;

      case "log":
        if(data.text) {
          logEvent(data.text);
          broadcast({ type: "state", state: gameState });
        }
        break;
    }
  });

  ws.on("close", () => console.log("🔴 Client disconnected"));
});

// ================== SERVER START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server running on port", PORT));
