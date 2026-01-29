const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public")); // раздаём index.html и JS

const server = http.createServer(app); // общий сервер для HTTP и WS
const wss = new WebSocket.Server({ server });

// Игра (игровое состояние)
let gameState = {
  players: [],
  walls: [],
  turnOrder: [],
  currentTurnIndex: 0,
  log: []
};

// Функция отправки всем
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Подключение клиента
wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "init", state: gameState }));

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {
      case "addPlayer":
        gameState.players.push(data.player);
        broadcast({ type: "state", state: gameState });
        break;
      case "movePlayer":
        const p = gameState.players.find(p => p.id === data.id);
        if (p) {
          p.x = data.x;
          p.y = data.y;
          broadcast({ type: "state", state: gameState });
        }
        break;
      // здесь остальные действия...
    }
  });
});

// Render сам задаёт порт через process.env.PORT
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("🟢 Server running on port", PORT);
});