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

// ================== HELPERS ==================
function broadcast() {
  const msg = JSON.stringify({ type: "state", state: gameState });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function logEvent(text) {
  gameState.log.push(`${new Date().toLocaleTimeString()} — ${text}`);
  if (gameState.log.length > 100) gameState.log.shift();
}

// ================== WS HANDLERS ==================
wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {

      case "resizeBoard":
        gameState.boardWidth = data.width;
        gameState.boardHeight = data.height;
        logEvent("Поле изменено");
        broadcast();
        break;

      case "addPlayer":
        gameState.players.push({
          id: uuidv4(),
          name: data.player.name,
          color: data.player.color,
          size: data.player.size,
          x: 0,
          y: 0,
          initiative: 0
        });
        logEvent(`Игрок ${data.player.name} добавлен`);
        broadcast();
        break;

      case "movePlayer": {
        const p = gameState.players.find(p => p.id === data.id);
        if (!p) return;
        p.x = data.x;
        p.y = data.y;
        logEvent(`${p.name} переместился в (${p.x},${p.y})`);
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
        broadcast();
        break;

      case "clearBoard":
        gameState.walls = [];
        broadcast();
        break;
    }
  });
});

// ================== START ==================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🟢 Server on", PORT));
