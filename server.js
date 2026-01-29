// ===== D&D ONLINE WEBSOCKET SERVER =====
// Работает на Render / Railway / VPS
// npm install ws

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log('🟢 WebSocket сервер запущен на порту', PORT);

// ===== ГЛОБАЛЬНОЕ СОСТОЯНИЕ ИГРЫ =====
let state = {
  boardWidth: 10,
  boardHeight: 10,

  players: [
    // {
    //   id,
    //   name,
    //   color,
    //   size,
    //   x,
    //   y,
    //   initiative
    // }
  ],

  walls: [
    // { x, y }
  ],

  turnIndex: 0,
  log: []
};

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function addLog(text) {
  state.log.push({
    time: new Date().toLocaleTimeString(),
    text
  });

  if (state.log.length > 100) {
    state.log.shift();
  }
}

function broadcast() {
  const payload = JSON.stringify({
    type: 'state',
    state
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ===== ПОДКЛЮЧЕНИЕ КЛИЕНТА =====
wss.on('connection', ws => {
  console.log('🔵 Клиент подключился');

  // Отправляем текущее состояние
  ws.send(JSON.stringify({
    type: 'state',
    state
  }));

  ws.on('message', message => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    switch (data.type) {

      // ===== ДОБАВЛЕНИЕ ИГРОКА =====
      case 'addPlayer': {
        if (state.players.find(p => p.name === data.name)) return;

        state.players.push({
          id: Date.now(),
          name: data.name,
          color: data.color,
          size: data.size || 1,
          x: 0,
          y: 0,
          initiative: 0
        });

        addLog(`Игрок ${data.name} присоединился`);
        break;
      }

      // ===== ПЕРЕМЕЩЕНИЕ ИГРОКА =====
      case 'movePlayer': {
        const player = state.players.find(p => p.name === data.name);
        if (!player) break;

        player.x = data.x;
        player.y = data.y;

        addLog(`Игрок ${player.name} переместился в (${data.x}, ${data.y})`);
        break;
      }

      // ===== СТЕНЫ =====
      case 'setWall': {
        const exists = state.walls.find(
          w => w.x === data.x && w.y === data.y
        );

        if (data.action === 'add' && !exists) {
          state.walls.push({ x: data.x, y: data.y });
          addLog(`Добавлена стена (${data.x}, ${data.y})`);
        }

        if (data.action === 'remove' && exists) {
          state.walls = state.walls.filter(
            w => w.x !== data.x || w.y !== data.y
          );
          addLog(`Удалена стена (${data.x}, ${data.y})`);
        }
        break;
      }

      // ===== БРОСОК ИНИЦИАТИВЫ =====
      case 'rollInitiative': {
        state.players.forEach(p => {
          p.initiative = Math.floor(Math.random() * 20) + 1;
        });

        state.players.sort((a, b) => b.initiative - a.initiative);
        state.turnIndex = 0;

        addLog('Все игроки бросили инициативу');
        break;
      }

      // ===== КОНЕЦ ХОДА =====
      case 'endTurn': {
        if (state.players.length === 0) break;

        state.turnIndex =
          (state.turnIndex + 1) % state.players.length;

        const current = state.players[state.turnIndex];
        addLog(`Ход переходит к ${current.name}`);
        break;
      }

      // ===== ИЗМЕНЕНИЕ РАЗМЕРОВ ПОЛЯ =====
      case 'setBoardSize': {
        state.boardWidth = data.width;
        state.boardHeight = data.height;
        addLog(`Размер поля: ${data.width} x ${data.height}`);
        break;
      }

      // ===== ОЧИСТКА ПОЛЯ (DM) =====
      case 'resetGame': {
        state.players = [];
        state.walls = [];
        state.turnIndex = 0;
        state.log = [];
        addLog('Игра сброшена');
        break;
      }
    }

    broadcast();
  });

  ws.on('close', () => {
    console.log('🔴 Клиент отключился');
  });
});
