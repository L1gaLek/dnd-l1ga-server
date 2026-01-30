// ====================== ЭЛЕМЕНТЫ ======================
const board = document.getElementById('game-board');
const dice = document.getElementById('dice');
const rollBtn = document.getElementById('roll');
const rollResult = document.getElementById('roll-result');
const endTurnBtn = document.getElementById('end-turn');
const addPlayerBtn = document.getElementById('add-player');
const playerNameInput = document.getElementById('player-name');
const playerColorInput = document.getElementById('player-color');
const playerSizeInput = document.getElementById('player-size');
const createBoardBtn = document.getElementById('create-board');
const boardWidthInput = document.getElementById('board-width');
const boardHeightInput = document.getElementById('board-height');
const rollInitiativeBtn = document.getElementById('roll-initiative');
const currentPlayerSpan = document.getElementById('current-player');
const logList = document.getElementById('log-list');
const playerList = document.getElementById('player-list');

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');
const resetGameBtn = document.getElementById('reset-game');
const clearBoardBtn = document.getElementById('clear-board');

// ====================== ПЕРЕМЕННЫЕ ======================
let boardWidth = parseInt(boardWidthInput.value);
let boardHeight = parseInt(boardHeightInput.value);
let players = [];
let selectedPlayer = null;
let editEnvironment = false;
let wallMode = null;
let mouseDown = false;

// DOM-элементы игроков (id -> element)
const playerElements = new Map();

// ====================== WEBSOCKET ======================
const ws = new WebSocket(
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host
);

ws.onopen = () => console.log("🟢 Connected to server");

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'init' || msg.type === 'state') {
    const state = msg.state;

    boardWidth = state.boardWidth || boardWidth;
    boardHeight = state.boardHeight || boardHeight;

// синхронизация игроков и их DOM
    const existingIds = new Set(state.players.map(p => p.id));

    // удаляем DOM элементы игроков, которых уже нет
    playerElements.forEach((el, id) => {
      if (!existingIds.has(id)) {
        el.remove();
        playerElements.delete(id);
      }
    });

    // обновляем массив игроков
    players = state.players.map(p => {
      const el = playerElements.get(p.id);
      return { ...p, element: el || null };
    });

    renderBoard(state);
    updatePlayerList();
    updateCurrentPlayer(state);
    renderLog(state.log || []);
  }
};

// ====================== ВСПОМОГАТЕЛЬНЫЕ ======================
function sendMessage(msg) {
  ws.send(JSON.stringify(msg));
}

function renderLog(logs) {
  logList.innerHTML = '';
  logs.slice(-50).forEach(line => {
    const li = document.createElement('li');
    li.textContent = line;
    logList.appendChild(li);
  });
}

function updateCurrentPlayer(state) {
  if (!state || !state.turnOrder || state.turnOrder.length === 0) {
    currentPlayerSpan.textContent = '-';
    return;
  }
  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p ? p.name : '-';
}

// ====================== СПИСОК ИГРОКОВ ======================
function updatePlayerList() {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.initiative || 0})`;

    // клик по имени → выделение и добавление на поле, если ещё нет
    li.addEventListener('click', () => {
      selectedPlayer = p;
      if (p.x === null || p.y === null) {
        p.x = 0;
        p.y = 0;
        sendMessage({ type: 'movePlayer', id: p.id, x: p.x, y: p.y });
      }
    });

    // кнопка убрать с поля
    const removeFromBoardBtn = document.createElement('button');
    removeFromBoardBtn.textContent = 'С поля';
    removeFromBoardBtn.style.marginLeft = '5px';
    removeFromBoardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessage({ type: 'removePlayerFromBoard', id: p.id });
    });

    // кнопка удалить полностью
    const removeCompletelyBtn = document.createElement('button');
    removeCompletelyBtn.textContent = 'Удалить';
    removeCompletelyBtn.style.marginLeft = '5px';
    removeCompletelyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessage({ type: 'removePlayerCompletely', id: p.id });

      // Удаляем DOM элемент игрока с поля сразу
      const el = playerElements.get(p.id);
      if (el) {
        el.remove();
        playerElements.delete(p.id);
      }
    });

    li.appendChild(removeFromBoardBtn);
    li.appendChild(removeCompletelyBtn);

    playerList.appendChild(li);
  });
}

// ====================== ПОЛЕ ======================
function renderBoard(state) {
  // удаляем старые клетки
  board.querySelectorAll('.cell').forEach(c => c.remove());

  board.style.gridTemplateColumns = `repeat(${boardWidth}, 50px)`;
  board.style.gridTemplateRows = `repeat(${boardHeight}, 50px)`;

  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (state.walls?.find(w => w.x === x && w.y === y)) {
        cell.classList.add('wall');
      }

      board.appendChild(cell);
    }
  }

  // обновляем позиции игроков
  players.forEach(p => setPlayerPosition(p));
}

// изменение размеров поля
createBoardBtn.addEventListener('click', () => {
  const width = parseInt(boardWidthInput.value);
  const height = parseInt(boardHeightInput.value);

  if (isNaN(width) || width < 1 || width > 20) return alert("Введите корректную ширину (1–20)");
  if (isNaN(height) || height < 1 || height > 20) return alert("Введите корректную высоту (1–20)");

  sendMessage({ type: 'resizeBoard', width, height });
});

// ====================== ИГРОКИ ======================
function setPlayerPosition(player) {
  let el = playerElements.get(player.id);

  if (!el) {
    el = document.createElement('div');
    el.classList.add('player');
    el.textContent = player.name[0];
    el.style.backgroundColor = player.color;
    el.style.position = 'absolute';
    el.style.width = `${player.size * 50}px`;
    el.style.height = `${player.size * 50}px`;

    el.addEventListener('mousedown', () => {
      if (!editEnvironment) {
        if (selectedPlayer) {
          const prev = playerElements.get(selectedPlayer.id);
          if (prev) prev.classList.remove('selected');
        }
        selectedPlayer = player;
        el.classList.add('selected');
      }
    });

    board.appendChild(el);
    playerElements.set(player.id, el);
    player.element = el;
  }

  if (player.x === null || player.y === null) {
    el.style.display = 'none';
    return;
  } else {
    el.style.display = 'flex';
  }

  let maxX = boardWidth - player.size;
  let maxY = boardHeight - player.size;

  let x = Math.min(Math.max(player.x, 0), maxX);
  let y = Math.min(Math.max(player.y, 0), maxY);

  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    el.style.left = `${cell.offsetLeft}px`;
    el.style.top = `${cell.offsetTop}px`;
  }
}

// ====================== ПЕРЕМЕЩЕНИЕ ИГРОКА ======================
board.addEventListener('click', e => {
  if (!selectedPlayer) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;

  let x = parseInt(cell.dataset.x);
  let y = parseInt(cell.dataset.y);

  if (x + selectedPlayer.size > boardWidth) x = boardWidth - selectedPlayer.size;
  if (y + selectedPlayer.size > boardHeight) y = boardHeight - selectedPlayer.size;

  sendMessage({ type: 'movePlayer', id: selectedPlayer.id, x, y });

  const el = playerElements.get(selectedPlayer.id);
  if (el) el.classList.remove('selected');
  selectedPlayer = null;
});

// ====================== ДОБАВЛЕНИЕ ИГРОКА ======================
addPlayerBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return alert("Введите имя");

  const player = {
    id: crypto.randomUUID(),
    name,
    color: playerColorInput.value,
    size: parseInt(playerSizeInput.value),
    x: null,
    y: null,
    initiative: 0
  };

  sendMessage({ type: 'addPlayer', player });
  playerNameInput.value = '';
});

// ====================== КУБИК ======================
rollBtn.addEventListener('click', () => {
  const sides = parseInt(dice.value);
  const result = Math.floor(Math.random() * sides) + 1;
  rollResult.textContent = `Результат: ${result}`;
  sendMessage({ type: 'log', text: `Бросок d${sides}: ${result}` });
});

// ====================== ХОД ======================
endTurnBtn.addEventListener('click', () => sendMessage({ type: 'endTurn' }));

// ====================== ИНИЦИАТИВА ======================
rollInitiativeBtn.addEventListener('click', () => sendMessage({ type: 'rollInitiative' }));

// ====================== СТЕНЫ ======================
editEnvBtn.addEventListener('click', () => {
  editEnvironment = !editEnvironment;
  addWallBtn.disabled = !editEnvironment;
  removeWallBtn.disabled = !editEnvironment;
  wallMode = null;

  editEnvBtn.textContent = editEnvironment ? "Редактирование: ВКЛ" : "Редактирование: ВЫКЛ";
});

addWallBtn.addEventListener('click', () => wallMode = 'add');
removeWallBtn.addEventListener('click', () => wallMode = 'remove');

board.addEventListener('mousedown', e => {
  if (!editEnvironment || !wallMode) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  mouseDown = true;
  toggleWall(cell);
});

board.addEventListener('mouseover', e => {
  if (!mouseDown || !editEnvironment || !wallMode) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  toggleWall(cell);
});

board.addEventListener('mouseup', () => mouseDown = false);

function toggleWall(cell) {
  const x = +cell.dataset.x;
  const y = +cell.dataset.y;

  if (wallMode === 'add') {
    sendMessage({ type: 'addWall', wall: { x, y } });
    cell.classList.add('wall');
  } else if (wallMode === 'remove') {
    sendMessage({ type: 'removeWall', wall: { x, y } });
    cell.classList.remove('wall');
  }
}

// ====================== СБРОС ======================
resetGameBtn.addEventListener('click', () => {
  // удаляем DOM элементы игроков у себя
  playerElements.forEach(el => el.remove());
  playerElements.clear();

  sendMessage({ type: 'resetGame' });
});

