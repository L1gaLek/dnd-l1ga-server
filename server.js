const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log('WebSocket сервер запущен на порту', PORT);

let state = {
  boardWidth: 10,
  boardHeight: 10,
  players: [],
  walls: [],
  turnIndex: 0
};

function broadcast() {
  const data = JSON.stringify({ type: 'state', state });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', state }));

  ws.on('message', msg => {
    const data = JSON.parse(msg);

    switch (data.type) {
      case 'addPlayer':
        state.players.push({
          name: data.name,
          color: data.color,
          size: data.size,
          x: 0,
          y: 0,
          initiative: 0
        });
        break;

      case 'movePlayer':
        const p = state.players.find(p => p.name === data.name);
        if (p) {
          p.x = data.x;
          p.y = data.y;
        }
        break;

      case 'setWall':
        if (data.action === 'add') {
          state.walls.push({ x: data.x, y: data.y });
        } else {
          state.walls = state.walls.filter(
            w => w.x !== data.x || w.y !== data.y
          );
        }
        break;

      case 'rollInitiative':
        state.players.forEach(p => {
          p.initiative = Math.floor(Math.random() * 20) + 1;
        });
        state.players.sort((a, b) => b.initiative - a.initiative);
        state.turnIndex = 0;
        break;

      case 'endTurn':
        state.turnIndex = (state.turnIndex + 1) % state.players.length;
        break;
    }

    broadcast();
  });
});
